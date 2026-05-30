import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the auth boundary so we don't have to deal with tokens. Each
// `driveFetch` call goes through `getAuthorizedFetch`, so this is the only
// dependency the listAllFiles sharding logic needs.
// googleAuth + tokenService are both behind the @l8r/shared/auth barrel now,
// so their mocks are merged into a single factory.
vi.mock('@l8r/shared/auth', () => ({
  getAuthorizedFetch: vi.fn(),
  getValidToken: vi.fn(),
  initiateLogin: vi.fn(),
  handleAuthCallback: vi.fn(),
  clearTokens: vi.fn(),
}));

vi.mock('@l8r/shared/platform', () => ({
  storage: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

import { listAllFiles } from './googleDriveService';
import { getAuthorizedFetch } from '@l8r/shared/auth';

const mockResponse = (body: any) =>
  ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) } as Response);

// Parse the encoded `q` parameter out of a Drive files.list URL so each test
// can assert on what predicate the shard sent without coupling to encoding.
const decodeQ = (url: string): string => {
  const parsed = new URL(url);
  return parsed.searchParams.get('q') ?? '';
};

describe('googleDriveService.listAllFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('issues four parallel shard queries — one per filename namespace plus a negated catch-all', async () => {
    (getAuthorizedFetch as any).mockResolvedValue(mockResponse({ files: [] }));

    await listAllFiles();

    expect(getAuthorizedFetch).toHaveBeenCalledTimes(4);
    const queries = (getAuthorizedFetch as any).mock.calls.map(
      (call: any[]) => decodeQ(call[0])
    );

    expect(queries).toEqual(
      expect.arrayContaining([
        `trashed=false and name contains 'moment-'`,
        `trashed=false and name contains 'event-'`,
        `trashed=false and name contains 'todo-'`,
        `trashed=false and not name contains 'moment-' and not name contains 'event-' and not name contains 'todo-'`,
      ])
    );
  });

  it('runs all shards concurrently rather than sequentially', async () => {
    // Hold every shard open until we explicitly release them; if the
    // implementation awaited each shard in turn this assertion would deadlock.
    const released: Array<() => void> = [];
    (getAuthorizedFetch as any).mockImplementation(() =>
      new Promise<Response>((resolve) => {
        released.push(() => resolve(mockResponse({ files: [] })));
      })
    );

    const listPromise = listAllFiles();

    // Spin a microtask round so the four shard calls register before we
    // inspect the in-flight count.
    await Promise.resolve();
    await Promise.resolve();

    expect(released).toHaveLength(4);
    released.forEach((release) => release());
    await listPromise;
  });

  it('merges results from every shard into a single flat array', async () => {
    (getAuthorizedFetch as any).mockImplementation(async (url: string) => {
      const q = decodeQ(url);
      if (q.includes(`name contains 'moment-'`) && !q.includes('not')) {
        return mockResponse({
          files: [{ id: 'd-mom', name: 'moment-1.json', modifiedTime: '2024-01-01T00:00:00Z' }],
        });
      }
      if (q.includes(`name contains 'event-'`) && !q.includes('not')) {
        return mockResponse({
          files: [{ id: 'd-evt', name: 'event-1.json', modifiedTime: '2024-01-02T00:00:00Z' }],
        });
      }
      if (q.includes(`name contains 'todo-'`) && !q.includes('not')) {
        return mockResponse({
          files: [{ id: 'd-todo', name: 'todo-1.json', modifiedTime: '2024-01-03T00:00:00Z' }],
        });
      }
      // Negated catch-all bucket: raw memories + config files.
      return mockResponse({
        files: [
          { id: 'd-mem', name: 'mem-uuid.json', modifiedTime: '2024-01-04T00:00:00Z' },
          { id: 'd-cfg', name: 'settings.json', modifiedTime: '2024-01-05T00:00:00Z' },
        ],
      });
    });

    const files = await listAllFiles();

    expect(files).toHaveLength(5);
    expect(files.map(f => f.id).sort()).toEqual(
      ['d-cfg', 'd-evt', 'd-mem', 'd-mom', 'd-todo']
    );
  });

  it('paginates within a shard via nextPageToken until exhausted', async () => {
    // Drive's pageToken is opaque, so a single shard can still need multiple
    // round trips. Only the negated "rest" shard returns pages here; the
    // others return empty.
    let restCall = 0;
    (getAuthorizedFetch as any).mockImplementation(async (url: string) => {
      const q = decodeQ(url);
      if (q.startsWith('trashed=false and not')) {
        restCall++;
        const parsed = new URL(url);
        const pageToken = parsed.searchParams.get('pageToken');
        if (restCall === 1) {
          expect(pageToken).toBeNull();
          return mockResponse({
            files: [{ id: 'a', name: 'a.json', modifiedTime: '2024-01-01T00:00:00Z' }],
            nextPageToken: 'tok-2',
          });
        }
        if (restCall === 2) {
          expect(pageToken).toBe('tok-2');
          return mockResponse({
            files: [{ id: 'b', name: 'b.json', modifiedTime: '2024-01-02T00:00:00Z' }],
            nextPageToken: 'tok-3',
          });
        }
        expect(pageToken).toBe('tok-3');
        return mockResponse({
          files: [{ id: 'c', name: 'c.json', modifiedTime: '2024-01-03T00:00:00Z' }],
        });
      }
      return mockResponse({ files: [] });
    });

    const files = await listAllFiles();

    expect(restCall).toBe(3);
    expect(files.map(f => f.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it("returns moment-synthesis-* files through the 'moment-' shard (substring match)", async () => {
    // `name contains 'moment-'` is a substring match, so it catches both
    // `moment-X.json` and `moment-synthesis-X.json`. The negated shard must
    // not double-count them.
    const seenByShard: Record<string, string[]> = {};
    (getAuthorizedFetch as any).mockImplementation(async (url: string) => {
      const q = decodeQ(url);
      let bucket = 'unknown';
      if (q.includes(`name contains 'moment-'`) && !q.includes('not')) bucket = 'moment';
      else if (q.includes(`name contains 'event-'`) && !q.includes('not')) bucket = 'event';
      else if (q.includes(`name contains 'todo-'`) && !q.includes('not')) bucket = 'todo';
      else bucket = 'rest';

      seenByShard[bucket] = seenByShard[bucket] || [];

      if (bucket === 'moment') {
        const names = [
          { id: 'mom-meta', name: 'moment-abc.json', modifiedTime: '2024-01-01T00:00:00Z' },
          { id: 'mom-syn', name: 'moment-synthesis-abc.json', modifiedTime: '2024-01-02T00:00:00Z' },
        ];
        names.forEach(n => seenByShard[bucket].push(n.name));
        return mockResponse({ files: names });
      }
      return mockResponse({ files: [] });
    });

    const files = await listAllFiles();

    expect(files.map(f => f.name).sort()).toEqual([
      'moment-abc.json',
      'moment-synthesis-abc.json',
    ]);
    // Synthesis lands in the moment shard, not in rest — proving the negated
    // predicate correctly excludes both moment- variants.
    expect(seenByShard.moment).toContain('moment-synthesis-abc.json');
    expect(seenByShard.rest ?? []).toHaveLength(0);
  });

  it('returns an empty array when every shard is empty', async () => {
    (getAuthorizedFetch as any).mockResolvedValue(mockResponse({ files: [] }));

    const files = await listAllFiles();

    expect(files).toEqual([]);
    expect(getAuthorizedFetch).toHaveBeenCalledTimes(4);
  });

  it('requests only id, name, and modifiedTime fields (keeps DriveFile shape stable)', async () => {
    (getAuthorizedFetch as any).mockResolvedValue(mockResponse({ files: [] }));

    await listAllFiles();

    for (const call of (getAuthorizedFetch as any).mock.calls) {
      const url: string = call[0];
      const parsed = new URL(url);
      expect(parsed.searchParams.get('fields')).toBe(
        'nextPageToken,files(id, name, modifiedTime)'
      );
      expect(parsed.searchParams.get('spaces')).toBe('appDataFolder');
      expect(parsed.searchParams.get('pageSize')).toBe('1000');
    }
  });

  it('propagates a shard failure rather than silently returning a partial list', async () => {
    // If any shard's response is not ok, driveFetch throws — listAllFiles
    // must surface that instead of pretending sync saw a complete index
    // (which would corrupt the snapshot).
    (getAuthorizedFetch as any).mockImplementation(async (url: string) => {
      const q = decodeQ(url);
      if (q.includes(`name contains 'event-'`)) {
        return { ok: false, status: 500, text: async () => 'boom' } as Response;
      }
      return mockResponse({ files: [] });
    });

    await expect(listAllFiles()).rejects.toThrow();
  });
});
