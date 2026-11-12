import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useMoments } from './useMoments';
import * as storageService from '../services/storageService';
import * as geminiService from '../services/geminiService';
import { Memory, Moment, EMBEDDING_MODEL_ID } from '../types';

vi.mock('../services/storageService');
vi.mock('../services/geminiService');

// 3-dim unit vectors keep the similarity math readable.
const X = [1, 0, 0];
const Y = [0, 1, 0];
const Z = [0, 0, 1];

const makeMemory = (id: string, embedding?: number[]): Memory => ({
  id,
  content: `note ${id}`,
  timestamp: 1000,
  tags: [],
  ...(embedding
    ? { enrichment: { summary: '', suggestedTags: [], embedding, embeddingModel: EMBEDDING_MODEL_ID } as Memory['enrichment'] }
    : {}),
});

const makeMoment = (id: string, overrides: Partial<Moment> = {}): Moment => ({
  id,
  title: 'Test',
  terms: ['Test'],
  termVectors: [X],
  intentVector: X,
  embeddingModel: EMBEDDING_MODEL_ID,
  emoji: '🧪',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

// Back saveMoment/getMoment/getMoments with a Map so re-reads see writes.
const wireMomentStorage = (initial: Moment[]) => {
  const store = new Map<string, Moment>(initial.map(m => [m.id, m]));
  (storageService.getMoments as any).mockImplementation(async () =>
    Array.from(store.values()).filter(m => !m.isDeleted)
  );
  (storageService.getMoment as any).mockImplementation(async (id: string) => store.get(id) ?? null);
  (storageService.saveMoment as any).mockImplementation(async (m: Moment) => { store.set(m.id, m); });
  return store;
};

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

const setOnline = (online: boolean) =>
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });

describe('useMoments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOnline(true);
    wireMomentStorage([]);
    (geminiService.embedMomentTerms as any).mockImplementation(async (terms: string[]) => ({
      vectors: terms.map(() => Y),
      intentVector: Y,
      emoji: '🇸🇬',
      model: EMBEDDING_MODEL_ID,
    }));
  });

  afterEach(() => setOnline(true));

  it('loads moments on mount', async () => {
    wireMomentStorage([makeMoment('m1')]);
    const { result } = renderHook(() => useMoments([]));
    await waitFor(() => expect(result.current.moments).toHaveLength(1));
  });

  describe('matching', () => {
    it('ranks by the moment\'s overall intent, not by any single term', async () => {
      wireMomentStorage([
        makeMoment('m1', { terms: ['a', 'b'], termVectors: [X, Y], intentVector: X }),
      ]);
      const memories = [
        makeMemory('close-to-x', [0.95, 0.05, 0].map(v => v / Math.hypot(0.95, 0.05))),
        makeMemory('exact-x', X),
        makeMemory('only-term-y', Y), // matches term "b" perfectly but not the intent
        makeMemory('unrelated', Z),
        makeMemory('no-vector'),
      ];

      const { result } = renderHook(() => useMoments(memories));
      await flush();

      const ids = result.current.matchesByMoment.get('m1')!.map(m => m.id);
      expect(ids).toEqual(['exact-x', 'close-to-x']);
    });

    it('matches an older term-only moment by its terms until it is re-embedded', async () => {
      setOnline(false); // keep it from being re-embedded during the test
      wireMomentStorage([
        makeMoment('m1', { terms: ['a', 'b'], termVectors: [X, Y], intentVector: undefined }),
      ]);
      const { result } = renderHook(() => useMoments([makeMemory('x', X), makeMemory('y', Y), makeMemory('z', Z)]));
      await flush();

      expect(result.current.matchesByMoment.get('m1')!.map(m => m.id).sort()).toEqual(['x', 'y']);
      expect(geminiService.embedMomentTerms).not.toHaveBeenCalled();
    });

    it('ignores note vectors from a different embedding model', async () => {
      wireMomentStorage([makeMoment('m1')]);
      const stale = makeMemory('stale', X);
      stale.enrichment!.embeddingModel = 'some-old-model';

      const { result } = renderHook(() => useMoments([stale, makeMemory('fresh', X)]));
      await flush();

      expect(result.current.matchesByMoment.get('m1')!.map(m => m.id)).toEqual(['fresh']);
    });

    it('updates live when a matching note is added', async () => {
      wireMomentStorage([makeMoment('m1')]);
      const { result, rerender } = renderHook(({ mems }) => useMoments(mems), {
        initialProps: { mems: [] as Memory[] },
      });
      await flush();
      expect(result.current.matchesByMoment.get('m1')).toEqual([]);

      rerender({ mems: [makeMemory('n1', X)] });
      expect(result.current.matchesByMoment.get('m1')!.map(m => m.id)).toEqual(['n1']);
    });
  });

  describe('createNewMoment', () => {
    it('embeds the terms, stores vectors + emoji, and syncs once', async () => {
      const store = wireMomentStorage([]);
      const onChanged = vi.fn();
      const { result } = renderHook(() => useMoments([makeMemory('n1', Y)]));
      await flush();
      act(() => result.current.setOnMomentChanged(onChanged));

      let created: Moment | null = null;
      await act(async () => {
        created = await result.current.createNewMoment(['Singapore', 'hawker food']);
      });

      expect(geminiService.embedMomentTerms).toHaveBeenCalledWith(['Singapore', 'hawker food']);
      expect(created!.title).toBe('Singapore, hawker food');
      expect(created!.termVectors).toEqual([Y, Y]);
      expect(created!.emoji).toBe('🇸🇬');
      expect(store.get(created!.id)!.termVectors).toHaveLength(2);
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(result.current.matchesByMoment.get(created!.id)!.map(m => m.id)).toEqual(['n1']);
    });

    it('saves a waiting moment when offline and embeds it when back online', async () => {
      setOnline(false);
      const store = wireMomentStorage([]);
      const onChanged = vi.fn();
      const { result } = renderHook(() => useMoments([]));
      await flush();
      act(() => result.current.setOnMomentChanged(onChanged));

      let created: Moment | null = null;
      await act(async () => {
        created = await result.current.createNewMoment(['Tokyo']);
      });

      expect(geminiService.embedMomentTerms).not.toHaveBeenCalled();
      expect(created!.termVectors).toBeUndefined();
      expect(onChanged).toHaveBeenCalledTimes(1); // the waiting moment still syncs

      setOnline(true);
      await act(async () => {
        window.dispatchEvent(new Event('online'));
        await new Promise(r => setTimeout(r, 0));
      });

      await waitFor(() => expect(store.get(created!.id)!.termVectors).toEqual([Y]));
      expect(onChanged).toHaveBeenCalledTimes(2);
    });

    it('keeps the moment (waiting) when the embed request fails', async () => {
      (geminiService.embedMomentTerms as any).mockRejectedValue(new Error('502'));
      const store = wireMomentStorage([]);
      const { result } = renderHook(() => useMoments([]));
      await flush();

      let created: Moment | null = null;
      await act(async () => {
        created = await result.current.createNewMoment(['Tokyo']);
      });

      expect(created).not.toBeNull();
      expect(store.get(created!.id)).toBeDefined();
      expect(store.get(created!.id)!.termVectors).toBeUndefined();
      expect(result.current.embeddingIds.size).toBe(0);
    });
  });

  it('embeds legacy/waiting moments found on load', async () => {
    const store = wireMomentStorage([
      makeMoment('legacy', { terms: ['Build an itinerary for Singapore'], termVectors: undefined, embeddingModel: undefined, emoji: undefined }),
    ]);
    renderHook(() => useMoments([]));

    await waitFor(() => expect(store.get('legacy')!.termVectors).toEqual([Y]));
    expect(store.get('legacy')!.intentVector).toEqual(Y);
    expect(store.get('legacy')!.emoji).toBe('🇸🇬');
  });

  it('re-embeds a term-only moment to add its intent vector, keeping its emoji, and syncs it', async () => {
    const store = wireMomentStorage([
      makeMoment('old', { terms: ['a'], termVectors: [X], intentVector: undefined, emoji: '🍜' }),
    ]);
    const { result } = renderHook(() => useMoments([]));
    const onChanged = vi.fn();
    act(() => result.current.setOnMomentChanged(onChanged));

    await waitFor(() => expect(store.get('old')!.intentVector).toEqual(Y));
    expect(store.get('old')!.emoji).toBe('🍜');
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ id: 'old', intentVector: Y }));
  });

  it('does not re-embed a moment that already has an intent vector', async () => {
    wireMomentStorage([makeMoment('m1')]);
    renderHook(() => useMoments([]));
    await flush();
    expect(geminiService.embedMomentTerms).not.toHaveBeenCalled();
  });

  it('keeps term vectors and backs off when an older proxy returns no intent vector', async () => {
    const store = wireMomentStorage([
      makeMoment('m1', { termVectors: undefined, intentVector: undefined, embeddingModel: undefined }),
    ]);
    (geminiService.embedMomentTerms as any).mockImplementation(async (terms: string[]) => ({
      vectors: terms.map(() => Y), emoji: '✨', model: EMBEDDING_MODEL_ID,
    }));
    const { result } = renderHook(() => useMoments([]));
    await waitFor(() => expect(store.get('m1')!.termVectors).toEqual([Y]));
    expect(store.get('m1')!.intentVector).toBeUndefined();

    await act(async () => { await result.current.refreshMoments(); });
    await flush();
    expect(geminiService.embedMomentTerms).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect a moment deleted while its embed was in flight', async () => {
    const store = wireMomentStorage([
      makeMoment('m1', { termVectors: undefined, embeddingModel: undefined }),
    ]);
    let resolveEmbed: (v: unknown) => void = () => {};
    (geminiService.embedMomentTerms as any).mockImplementation(
      () => new Promise(r => { resolveEmbed = r; })
    );

    renderHook(() => useMoments([]));
    await flush();

    store.set('m1', { ...store.get('m1')!, isDeleted: true });
    await act(async () => {
      resolveEmbed({ vectors: [Y], emoji: '✨', model: EMBEDDING_MODEL_ID });
      await new Promise(r => setTimeout(r, 0));
    });

    expect(store.get('m1')!.isDeleted).toBe(true);
    expect(store.get('m1')!.termVectors).toBeUndefined();
  });

  describe('hideNoteInMoment', () => {
    it('drops the note from the matches and syncs the exclusion', async () => {
      const store = wireMomentStorage([makeMoment('m1')]);
      const onChanged = vi.fn();
      const memories = [makeMemory('n1', X), makeMemory('n2', X)];
      const { result } = renderHook(() => useMoments(memories));
      await flush();
      act(() => result.current.setOnMomentChanged(onChanged));

      await act(async () => {
        await result.current.hideNoteInMoment('m1', 'n1');
      });

      expect(store.get('m1')!.excludedNoteIds).toEqual(['n1']);
      expect(result.current.matchesByMoment.get('m1')!.map(m => m.id)).toEqual(['n2']);
      expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1', excludedNoteIds: ['n1'] }));
    });

    it('is a no-op for a note that is already hidden', async () => {
      wireMomentStorage([makeMoment('m1', { excludedNoteIds: ['n1'] })]);
      const { result } = renderHook(() => useMoments([]));
      await flush();
      (storageService.saveMoment as any).mockClear();

      await act(async () => {
        await result.current.hideNoteInMoment('m1', 'n1');
      });

      expect(storageService.saveMoment).not.toHaveBeenCalled();
    });
  });

  describe('deleteMoment', () => {
    it('persists a tombstone, removes it from the list, and syncs it', async () => {
      const store = wireMomentStorage([makeMoment('m1'), makeMoment('m2')]);
      const onChanged = vi.fn();
      const { result } = renderHook(() => useMoments([]));
      await flush();
      act(() => result.current.setOnMomentChanged(onChanged));

      await act(async () => {
        await result.current.deleteMoment('m1');
      });

      expect(store.get('m1')!.isDeleted).toBe(true);
      expect(result.current.moments.map(m => m.id)).toEqual(['m2']);
      expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1', isDeleted: true }));
    });
  });
});
