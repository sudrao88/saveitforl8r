// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAllNotes, fetchNotesByIds } from './googleDrive.js';

// ── helpers ──────────────────────────────────────────────────────────

const TOKEN = 'test-access-token';

const makeNote = (id, overrides = {}) => ({
  id,
  timestamp: Date.now(),
  content: `Content for ${id}`,
  tags: ['tag1'],
  enrichment: {
    summary: 'A summary',
    locationContext: { name: 'Home' },
    entityContext: { title: 'Entity' },
    keyPoints: ['kp1'],
    actionItems: ['ai1'],
    themes: ['theme1'],
  },
  attachments: [{ name: 'photo.jpg', data: 'base64...' }],
  ...overrides,
});

const driveFile = (name, id) => ({ id: id || `drive-${name}`, name });

/** Build a mock fetch that maps URL patterns to responses. */
const buildMockFetch = (handlers) =>
  vi.fn(async (url, _opts) => {
    for (const [pattern, handler] of handlers) {
      if (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)) {
        const body = typeof handler === 'function' ? handler(url) : handler;
        return {
          ok: true,
          json: async () => body,
          text: async () => JSON.stringify(body),
        };
      }
    }
    return { ok: false, status: 404, text: async () => 'Not found' };
  });

const errorResponse = (status, message = 'Error') => ({
  ok: false,
  status,
  text: async () => message,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── fetchAllNotes ────────────────────────────────────────────────────

describe('fetchAllNotes', () => {
  it('should return light memory objects for valid notes', async () => {
    const note = makeNote('note-1');
    const mockFetch = buildMockFetch([
      ['spaces=appDataFolder', { files: [driveFile('note-1.json')], nextPageToken: undefined }],
      ['alt=media', note],
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAllNotes(TOKEN);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'note-1',
      timestamp: note.timestamp,
      content: 'Content for note-1',
      tags: ['tag1'],
      enrichment: {
        summary: 'A summary',
        locationContext: { name: 'Home' },
        entityContext: { title: 'Entity' },
        keyPoints: ['kp1'],
        actionItems: ['ai1'],
        themes: ['theme1'],
      },
      attachments: [{ name: 'photo.jpg' }],
    });
  });

  it('should pass Bearer token in Authorization header', async () => {
    const mockFetch = buildMockFetch([
      ['spaces=appDataFolder', { files: [] }],
    ]);
    vi.stubGlobal('fetch', mockFetch);

    await fetchAllNotes(TOKEN);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
    );
  });

  it('should return empty array when no files exist', async () => {
    const mockFetch = buildMockFetch([
      ['spaces=appDataFolder', { files: [] }],
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAllNotes(TOKEN);
    expect(result).toEqual([]);
  });

  it('should send Drive q parameter to exclude non-note prefixes', async () => {
    const mockFetch = buildMockFetch([
      ['spaces=appDataFolder', { files: [] }],
    ]);
    vi.stubGlobal('fetch', mockFetch);

    await fetchAllNotes(TOKEN);

    const listUrl = decodeURIComponent(mockFetch.mock.calls[0][0]);
    // Verify the q parameter excludes all non-note prefixes
    expect(listUrl).toContain("not name contains 'moment-'");
    expect(listUrl).toContain("not name contains 'event-'");
    expect(listUrl).toContain("not name contains 'todo-'");
    expect(listUrl).toContain("not name contains 'saveitforl8r-key-'");
    expect(listUrl).toContain("name contains '.json'");
  });

  it('should filter out deleted notes after download', async () => {
    const deleted = makeNote('deleted-1', { isDeleted: true });
    const active = makeNote('active-1');
    const mockFetch = buildMockFetch([
      [
        'spaces=appDataFolder',
        { files: [driveFile('deleted-1.json'), driveFile('active-1.json')] },
      ],
      [/files\/drive-deleted-1\.json/, deleted],
      [/files\/drive-active-1\.json/, active],
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAllNotes(TOKEN);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('active-1');
  });

  it('should filter out pending notes after download', async () => {
    const pending = makeNote('pending-1', { isPending: true });
    const active = makeNote('active-1');
    const mockFetch = buildMockFetch([
      [
        'spaces=appDataFolder',
        { files: [driveFile('pending-1.json'), driveFile('active-1.json')] },
      ],
      [/files\/drive-pending-1\.json/, pending],
      [/files\/drive-active-1\.json/, active],
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAllNotes(TOKEN);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('active-1');
  });

  it('should filter out notes with no content after download', async () => {
    const empty = makeNote('empty-1', { content: '' });
    const valid = makeNote('valid-1');
    const mockFetch = buildMockFetch([
      [
        'spaces=appDataFolder',
        { files: [driveFile('empty-1.json'), driveFile('valid-1.json')] },
      ],
      [/files\/drive-empty-1\.json/, empty],
      [/files\/drive-valid-1\.json/, valid],
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAllNotes(TOKEN);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('valid-1');
  });

  it('should handle pagination across multiple pages', async () => {
    const note1 = makeNote('note-1');
    const note2 = makeNote('note-2');
    let callCount = 0;
    const mockFetch = vi.fn(async (url) => {
      if (url.includes('spaces=appDataFolder')) {
        callCount++;
        if (callCount === 1 && !url.includes('pageToken=')) {
          return {
            ok: true,
            json: async () => ({
              files: [driveFile('note-1.json')],
              nextPageToken: 'page2token',
            }),
            text: async () => '',
          };
        }
        // Second page
        return {
          ok: true,
          json: async () => ({
            files: [driveFile('note-2.json')],
          }),
          text: async () => '',
        };
      }
      // Download
      const note = url.includes('drive-note-1') ? note1 : note2;
      return { ok: true, json: async () => note, text: async () => '' };
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAllNotes(TOKEN);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id).sort()).toEqual(['note-1', 'note-2']);
    // Verify pagination param was sent
    const paginatedCall = mockFetch.mock.calls.find(([url]) =>
      url.includes('pageToken=page2token')
    );
    expect(paginatedCall).toBeTruthy();
  });

  it('should throw on Drive API 401 with status property', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(401, 'Unauthorized')));

    await expect(fetchAllNotes(TOKEN)).rejects.toThrow('Drive API error 401');
    try {
      await fetchAllNotes(TOKEN);
    } catch (err) {
      expect(err.status).toBe(401);
    }
  });

  it('should throw on Drive API 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(500, 'Internal')));

    await expect(fetchAllNotes(TOKEN)).rejects.toThrow('Drive API error 500');
  });

  it('should skip failed individual file downloads gracefully', async () => {
    const good = makeNote('good-1');
    const mockFetch = vi.fn(async (url) => {
      if (url.includes('spaces=appDataFolder')) {
        return {
          ok: true,
          json: async () => ({
            files: [driveFile('good-1.json', 'file-good'), driveFile('bad-1.json', 'file-bad')],
          }),
          text: async () => '',
        };
      }
      if (url.includes('file-bad')) {
        return errorResponse(404, 'Not found');
      }
      return { ok: true, json: async () => good, text: async () => '' };
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAllNotes(TOKEN);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('good-1');
  });

  it('should handle notes without enrichment', async () => {
    const note = makeNote('plain', { enrichment: undefined });
    const mockFetch = buildMockFetch([
      ['spaces=appDataFolder', { files: [driveFile('plain.json')] }],
      ['alt=media', note],
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAllNotes(TOKEN);
    expect(result).toHaveLength(1);
    expect(result[0].enrichment).toBeUndefined();
  });

  it('should handle notes without attachments', async () => {
    const note = makeNote('no-att', { attachments: undefined });
    const mockFetch = buildMockFetch([
      ['spaces=appDataFolder', { files: [driveFile('no-att.json')] }],
      ['alt=media', note],
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAllNotes(TOKEN);
    expect(result).toHaveLength(1);
    expect(result[0].attachments).toEqual([]);
  });

  it('should strip attachment data from light memory', async () => {
    const note = makeNote('with-data');
    const mockFetch = buildMockFetch([
      ['spaces=appDataFolder', { files: [driveFile('with-data.json')] }],
      ['alt=media', note],
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAllNotes(TOKEN);
    expect(result[0].attachments[0]).toEqual({ name: 'photo.jpg' });
    expect(result[0].attachments[0].data).toBeUndefined();
  });

  it('should default tags to empty array when missing', async () => {
    const note = makeNote('no-tags', { tags: undefined });
    const mockFetch = buildMockFetch([
      ['spaces=appDataFolder', { files: [driveFile('no-tags.json')] }],
      ['alt=media', note],
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchAllNotes(TOKEN);
    expect(result[0].tags).toEqual([]);
  });
});

// ── fetchNotesByIds ──────────────────────────────────────────────────

describe('fetchNotesByIds', () => {
  it('should return empty array for empty noteIds', async () => {
    const result = await fetchNotesByIds(TOKEN, []);
    expect(result).toEqual([]);
  });

  it('should return empty array for null noteIds', async () => {
    const result = await fetchNotesByIds(TOKEN, null);
    expect(result).toEqual([]);
  });

  it('should send name-based q filter to Drive for requested IDs', async () => {
    const note = makeNote('aaa');
    const mockFetch = buildMockFetch([
      ['spaces=appDataFolder', { files: [driveFile('aaa.json', 'file-aaa')] }],
      ['alt=media', note],
    ]);
    vi.stubGlobal('fetch', mockFetch);

    await fetchNotesByIds(TOKEN, ['aaa', 'bbb']);

    const listUrl = decodeURIComponent(mockFetch.mock.calls[0][0]);
    expect(listUrl).toContain("name = 'aaa.json'");
    expect(listUrl).toContain("name = 'bbb.json'");
    // Should use OR to combine
    expect(listUrl).toMatch(/name = 'aaa\.json' or name = 'bbb\.json'/);
  });

  it('should fetch and return only matched notes', async () => {
    const note1 = makeNote('aaa');
    const note2 = makeNote('bbb');
    const mockFetch = vi.fn(async (url) => {
      if (url.includes('spaces=appDataFolder')) {
        return {
          ok: true,
          json: async () => ({
            files: [
              driveFile('aaa.json', 'file-aaa'),
              driveFile('bbb.json', 'file-bbb'),
            ],
          }),
          text: async () => '',
        };
      }
      const note = url.includes('file-aaa') ? note1 : note2;
      return { ok: true, json: async () => note, text: async () => '' };
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchNotesByIds(TOKEN, ['aaa', 'bbb']);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id).sort()).toEqual(['aaa', 'bbb']);
    const downloadCalls = mockFetch.mock.calls.filter(([u]) => u.includes('alt=media'));
    expect(downloadCalls).toHaveLength(2);
  });

  it('should return empty array when Drive returns no matching files', async () => {
    const mockFetch = buildMockFetch([
      ['spaces=appDataFolder', { files: [] }],
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchNotesByIds(TOKEN, ['nonexistent']);
    expect(result).toEqual([]);
  });

  it('should chunk large noteId lists into multiple Drive queries', async () => {
    // NAME_QUERY_CHUNK_SIZE is 50, so 75 IDs should produce 2 list calls
    const noteIds = Array.from({ length: 75 }, (_, i) => `id-${i}`);
    const mockFetch = vi.fn(async (url) => {
      if (url.includes('spaces=appDataFolder')) {
        return { ok: true, json: async () => ({ files: [] }), text: async () => '' };
      }
      return { ok: false, status: 404, text: async () => 'Not found' };
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchNotesByIds(TOKEN, noteIds);

    const listCalls = mockFetch.mock.calls.filter(([u]) => u.includes('spaces=appDataFolder'));
    expect(listCalls).toHaveLength(2);

    // First chunk should have 50 name filters, second should have 25
    const url1 = decodeURIComponent(listCalls[0][0]);
    const url2 = decodeURIComponent(listCalls[1][0]);
    const count1 = (url1.match(/name = '/g) || []).length;
    const count2 = (url2.match(/name = '/g) || []).length;
    expect(count1).toBe(50);
    expect(count2).toBe(25);
  });

  it('should not filter out deleted/pending notes (explicit ID fetch)', async () => {
    const note = makeNote('del-note', { isDeleted: true });
    const mockFetch = buildMockFetch([
      ['spaces=appDataFolder', { files: [driveFile('del-note.json')] }],
      ['alt=media', note],
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchNotesByIds(TOKEN, ['del-note']);
    expect(result).toHaveLength(1);
  });

  it('should throw on Drive API error during listing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(403, 'Forbidden')));

    await expect(fetchNotesByIds(TOKEN, ['note-1'])).rejects.toThrow('Drive API error 403');
  });

  it('should return light memory format', async () => {
    const note = makeNote('formatted');
    const mockFetch = buildMockFetch([
      ['spaces=appDataFolder', { files: [driveFile('formatted.json')] }],
      ['alt=media', note],
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchNotesByIds(TOKEN, ['formatted']);
    expect(result[0]).toHaveProperty('id');
    expect(result[0]).toHaveProperty('content');
    expect(result[0]).toHaveProperty('tags');
    expect(result[0]).toHaveProperty('enrichment');
    expect(result[0]).toHaveProperty('attachments');
    expect(result[0].attachments[0].data).toBeUndefined();
  });

  it('should also apply non-note prefix exclusion in q filter', async () => {
    const mockFetch = buildMockFetch([
      ['spaces=appDataFolder', { files: [] }],
    ]);
    vi.stubGlobal('fetch', mockFetch);

    await fetchNotesByIds(TOKEN, ['some-id']);

    const listUrl = decodeURIComponent(mockFetch.mock.calls[0][0]);
    // Even for ID-based fetch, the base query excludes non-note prefixes
    expect(listUrl).toContain("not name contains 'moment-'");
    expect(listUrl).toContain("name contains '.json'");
  });
});
