import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMoments } from './useMoments';
import * as storageService from '../services/storageService';
import * as geminiService from '../services/geminiService';
import { Memory, Moment } from '../types';
import { computeInputHash } from '../utils/hash';

// Mock the services
vi.mock('../services/storageService');
vi.mock('../services/geminiService');

// Mock the moment creation polling hook
vi.mock('./useMomentCreationPolling', () => ({
  useMomentCreationPolling: () => ({
    startPolling: vi.fn(),
    recoverPending: vi.fn(),
    recoverPendingResynthesis: vi.fn(),
  }),
}));

const makeMemory = (id: string, content = 'test'): Memory => ({
  id,
  content,
  timestamp: Date.now(),
  tags: [],
});

const makeMoment = (id: string, noteIds: string[]): Moment => ({
  id,
  objective: 'Test objective',
  title: 'Test Moment',
  type: 'general',
  noteIds,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

/**
 * Hook saveMoment up to a Map and back through getMoment so the
 * persistResult re-read inside loadSynthesis sees the noteIds that the
 * caller (addNoteToMoment / removeNoteFromMoments) just wrote. Without this,
 * the default mock returns the original moments and persistResult silently
 * reverts the noteIds.
 */
const wireMomentStorage = (initial: Moment[]) => {
  const store = new Map<string, Moment>(initial.map(m => [m.id, m]));
  (storageService.getMoments as any).mockImplementation(async () =>
    Array.from(store.values())
  );
  (storageService.getMoment as any).mockImplementation(async (id: string) =>
    store.get(id) ?? null
  );
  (storageService.saveMoment as any).mockImplementation(async (m: Moment) => {
    store.set(m.id, m);
  });
  return store;
};

/**
 * Make the background loadSynthesis triggered by addNoteToMoment /
 * removeNoteFromMoments harmless: submitResynthesis resolves, but
 * pollSynthesisResult hangs forever so the test observes the
 * immediately-post-removal state without persistResult / catch-block
 * side effects.
 */
const stubBackgroundResynthesis = () => {
  (geminiService.submitResynthesis as any).mockResolvedValue({ momentId: 'noop' });
  (geminiService.pollSynthesisResult as any).mockImplementation(
    () => new Promise(() => {})
  );
};

describe('useMoments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageService.getMoments as any).mockResolvedValue([]);
    (storageService.saveMoment as any).mockResolvedValue(undefined);
    (storageService.getMomentSynthesis as any).mockResolvedValue(null);
    (storageService.saveMomentSynthesis as any).mockResolvedValue(undefined);
    (storageService.deleteMomentSynthesis as any).mockResolvedValue(undefined);
    // getMoment(id) is used by the tombstone-aware re-read pattern in
    // loadSynthesis and the polling/recovery hooks. Default to returning
    // whatever getMoments() returns so tests that only mock getMoments
    // continue to work without explicitly mocking getMoment.
    (storageService.getMoment as any).mockImplementation(async (id: string) => {
      const all = await (storageService.getMoments as any)();
      return Array.isArray(all) ? all.find((m: Moment) => m.id === id) ?? null : null;
    });
    // Default: server has no result, so loadSynthesis falls through to submit.
    (geminiService.fetchPendingSynthesisResults as any).mockResolvedValue({});
  });

  it('should load moments on mount', async () => {
    const moments = [makeMoment('m1', ['note-1'])];
    (storageService.getMoments as any).mockResolvedValue(moments);

    const memories = [makeMemory('note-1')];
    const { result } = renderHook(() => useMoments(memories));

    await waitFor(() => {
      expect(result.current.moments).toHaveLength(1);
    });
  });

  describe('removeNoteFromMoments', () => {
    it('should remove a note ID from all moments that reference it', async () => {
      wireMomentStorage([
        makeMoment('m1', ['note-1', 'note-2', 'note-3']),
        makeMoment('m2', ['note-2', 'note-4']),
        makeMoment('m3', ['note-5']),
      ]);
      stubBackgroundResynthesis();

      const memories: Memory[] = [
        makeMemory('note-1'),
        makeMemory('note-2'),
        makeMemory('note-3'),
        makeMemory('note-4'),
        makeMemory('note-5'),
      ];

      const { result } = renderHook(() => useMoments(memories));

      // Flush the async useEffect that loads moments
      await act(async () => {
        await new Promise(r => setTimeout(r, 0));
      });

      expect(result.current.moments.length).toBe(3);

      // Clear any saveMoment calls from loading phase
      (storageService.saveMoment as any).mockClear();

      await act(async () => {
        await result.current.removeNoteFromMoments('note-2');
      });

      // m1 should have note-2 removed
      const m1 = result.current.moments.find(m => m.id === 'm1');
      expect(m1?.noteIds).toEqual(['note-1', 'note-3']);

      // m2 should have note-2 removed
      const m2 = result.current.moments.find(m => m.id === 'm2');
      expect(m2?.noteIds).toEqual(['note-4']);

      // m3 should be unchanged
      const m3 = result.current.moments.find(m => m.id === 'm3');
      expect(m3?.noteIds).toEqual(['note-5']);

      // The deletion path must persist m1 and m2 with their reduced noteIds.
      // (Background re-synthesis kicked off by removeNoteFromMoments may
      // issue additional saveMoment calls — covered by a separate test.)
      const saveCalls = (storageService.saveMoment as any).mock.calls.map((c: any[]) => c[0]);
      const m1Save = saveCalls.find((m: Moment) => m.id === 'm1' && m.noteIds.length === 2);
      const m2Save = saveCalls.find((m: Moment) => m.id === 'm2' && m.noteIds.length === 1);
      const m3Save = saveCalls.find((m: Moment) => m.id === 'm3');
      expect(m1Save?.noteIds).toEqual(['note-1', 'note-3']);
      expect(m2Save?.noteIds).toEqual(['note-4']);
      expect(m3Save).toBeUndefined();
    });

    it('should not modify moments that do not reference the deleted note', async () => {
      const moments = [
        makeMoment('m1', ['note-1', 'note-3']),
      ];
      (storageService.getMoments as any).mockResolvedValue(moments);

      const memories = [makeMemory('note-1'), makeMemory('note-3')];

      const { result } = renderHook(() => useMoments(memories));

      await waitFor(() => {
        expect(result.current.moments).toHaveLength(1);
      });

      await act(async () => {
        await result.current.removeNoteFromMoments('note-99');
      });

      // No changes expected
      const m1 = result.current.moments.find(m => m.id === 'm1');
      expect(m1?.noteIds).toEqual(['note-1', 'note-3']);
      expect(storageService.saveMoment).not.toHaveBeenCalled();
    });

    it('should update the updatedAt timestamp on affected moments', async () => {
      const oldTime = Date.now() - 10000;
      wireMomentStorage([
        { ...makeMoment('m1', ['note-1', 'note-2']), updatedAt: oldTime },
      ]);
      stubBackgroundResynthesis();

      const memories = [makeMemory('note-1'), makeMemory('note-2')];

      const { result } = renderHook(() => useMoments(memories));

      await waitFor(() => {
        expect(result.current.moments).toHaveLength(1);
      });

      await act(async () => {
        await result.current.removeNoteFromMoments('note-1');
      });

      const m1 = result.current.moments.find(m => m.id === 'm1');
      expect(m1?.updatedAt).toBeGreaterThan(oldTime);
    });

    it('should clear inputHash to invalidate synthesis cache for affected moments', async () => {
      wireMomentStorage([
        { ...makeMoment('m1', ['note-1', 'note-2']), inputHash: 'old-hash' },
      ]);
      // Hang the background re-synthesis triggered by removeNoteFromMoments
      // so the immediately-post-removal state is observable without
      // persistResult writing a fresh inputHash.
      stubBackgroundResynthesis();

      const memories = [makeMemory('note-1'), makeMemory('note-2')];

      const { result } = renderHook(() => useMoments(memories));

      await waitFor(() => {
        expect(result.current.moments).toHaveLength(1);
      });

      // Verify moment has an inputHash before removal
      expect(result.current.moments[0].inputHash).toBe('old-hash');

      await act(async () => {
        await result.current.removeNoteFromMoments('note-1');
      });

      // After removal, inputHash should be cleared so MomentBubble shows
      // the stale indicator until the background re-synthesis completes.
      const m1 = result.current.moments.find(m => m.id === 'm1');
      expect(m1?.inputHash).toBeUndefined();
    });

    it('should not modify deleted moments', async () => {
      const moments = [
        { ...makeMoment('m1', ['note-1', 'note-2']), isDeleted: true },
      ];
      (storageService.getMoments as any).mockResolvedValue(moments);

      const memories = [makeMemory('note-1'), makeMemory('note-2')];

      const { result } = renderHook(() => useMoments(memories));

      // Deleted moments are filtered out of the active list
      await waitFor(() => {
        expect(result.current.moments).toHaveLength(0);
      });

      await act(async () => {
        await result.current.removeNoteFromMoments('note-1');
      });

      // saveMoment should NOT have been called for the deleted moment
      expect(storageService.saveMoment).not.toHaveBeenCalled();
    });

    it('should soft-delete a moment when its last source note is removed', async () => {
      wireMomentStorage([
        makeMoment('m1', ['note-1']),
        makeMoment('m2', ['note-1', 'note-2']),
      ]);
      stubBackgroundResynthesis();

      const memories = [makeMemory('note-1'), makeMemory('note-2')];
      const { result } = renderHook(() => useMoments(memories));

      await waitFor(() => {
        expect(result.current.moments).toHaveLength(2);
      });

      await act(async () => {
        await result.current.removeNoteFromMoments('note-1');
      });

      // m1 lost its only source note → should be soft-deleted and disappear from `moments`.
      // m2 still has note-2 → should remain visible.
      expect(result.current.moments).toHaveLength(1);
      expect(result.current.moments[0].id).toBe('m2');

      // m1 should be persisted with isDeleted: true so the deletion syncs.
      const m1Save = (storageService.saveMoment as any).mock.calls.find(
        (call: any[]) => call[0].id === 'm1'
      );
      expect(m1Save).toBeDefined();
      expect(m1Save[0].isDeleted).toBe(true);
    });

    it('should not soft-delete a pending moment whose noteIds is emptied', async () => {
      // A pending moment legitimately has noteIds: [] during creation, so we must
      // not interpret a removal-induced empty array on a pending moment as orphaning.
      const moments = [
        { ...makeMoment('m-pending', ['note-1']), isPending: true },
      ];
      (storageService.getMoments as any).mockResolvedValue(moments);

      const memories = [makeMemory('note-1')];
      const { result } = renderHook(() => useMoments(memories));

      await waitFor(() => {
        expect(result.current.moments).toHaveLength(1);
      });

      await act(async () => {
        await result.current.removeNoteFromMoments('note-1');
      });

      // The pending moment should still be present (not soft-deleted).
      expect(result.current.moments).toHaveLength(1);
      expect(result.current.moments[0].isDeleted).toBeFalsy();
    });

    it('should clear in-memory synthesis cache for affected moments', async () => {
      wireMomentStorage([
        { ...makeMoment('m1', ['note-1', 'note-2']), inputHash: 'old-hash' },
      ]);
      stubBackgroundResynthesis();

      const memories = [makeMemory('note-1'), makeMemory('note-2')];

      const { result } = renderHook(() => useMoments(memories));

      await waitFor(() => {
        expect(result.current.moments).toHaveLength(1);
      });

      await act(async () => {
        await result.current.removeNoteFromMoments('note-1');
      });

      // The in-memory synthesis cache should no longer have an entry for m1
      expect(result.current.synthesesMap.has('m1')).toBe(false);
    });

    it('should filter stale items from resynthesis referencing notes no longer in moment', async () => {
      const moments = [
        makeMoment('m1', ['note-1', 'note-2']),
      ];
      (storageService.getMoments as any).mockResolvedValue(moments);

      const memories = [makeMemory('note-1'), makeMemory('note-2')];

      // Mock submitResynthesis and pollSynthesisResult to return a stale
      // result that references a deleted note ('note-3' is not in moment)
      (geminiService.submitResynthesis as any).mockResolvedValue({ momentId: 'm1' });
      (geminiService.pollSynthesisResult as any).mockResolvedValue({
        format: 'general',
        title: 'Test',
        sections: [
          {
            heading: 'Section A',
            items: [
              { label: 'Valid item', sourceNoteId: 'note-1' },
              { label: 'Stale item', sourceNoteId: 'note-3' },
            ],
          },
          {
            heading: 'Section B (all stale)',
            items: [
              { label: 'Another stale item', sourceNoteId: 'note-3' },
            ],
          },
        ],
        generatedFrom: ['note-1', 'note-3'],
      });

      const { result } = renderHook(() => useMoments(memories));

      await waitFor(() => {
        expect(result.current.moments).toHaveLength(1);
      });

      let synthesis: any;
      await act(async () => {
        synthesis = await result.current.loadSynthesis(
          result.current.moments[0],
          memories
        );
      });

      // The stale item referencing 'note-3' should be filtered out
      expect(synthesis).not.toBeNull();
      expect(synthesis.sections).toHaveLength(1); // Section B removed entirely
      expect(synthesis.sections[0].heading).toBe('Section A');
      expect(synthesis.sections[0].items).toHaveLength(1);
      expect(synthesis.sections[0].items[0].label).toBe('Valid item');
      expect(synthesis.generatedFrom).toEqual(['note-1']);
    });

    it('should delete persisted synthesis cache for affected moments', async () => {
      (storageService.deleteMomentSynthesis as any).mockResolvedValue(undefined);

      wireMomentStorage([
        { ...makeMoment('m1', ['note-1', 'note-2']), inputHash: 'old-hash' },
        makeMoment('m2', ['note-1', 'note-3']),
      ]);
      stubBackgroundResynthesis();

      const memories = [makeMemory('note-1'), makeMemory('note-2'), makeMemory('note-3')];

      const { result } = renderHook(() => useMoments(memories));

      await waitFor(() => {
        expect(result.current.moments).toHaveLength(2);
      });

      (storageService.saveMoment as any).mockClear();

      await act(async () => {
        await result.current.removeNoteFromMoments('note-1');
      });

      // deleteMomentSynthesis should have been called for both affected moments
      expect(storageService.deleteMomentSynthesis).toHaveBeenCalledWith('m1');
      expect(storageService.deleteMomentSynthesis).toHaveBeenCalledWith('m2');
    });

    it('triggers a background submitResynthesis for each surviving affected moment', async () => {
      wireMomentStorage([
        makeMoment('m1', ['note-1', 'note-2']),
        makeMoment('m2', ['note-2', 'note-3']),
        makeMoment('m3', ['note-4']), // unaffected — should not be resynthesized
      ]);
      const memories = [
        makeMemory('note-1'),
        makeMemory('note-2'),
        makeMemory('note-3'),
        makeMemory('note-4'),
      ];

      (geminiService.fetchPendingSynthesisResults as any).mockResolvedValue({});
      (geminiService.submitResynthesis as any).mockResolvedValue({ momentId: 'noop' });
      (geminiService.pollSynthesisResult as any).mockImplementation(
        () => new Promise(() => {})
      );

      const { result } = renderHook(() => useMoments(memories));
      await waitFor(() => expect(result.current.moments).toHaveLength(3));

      await act(async () => {
        await result.current.removeNoteFromMoments('note-2');
      });

      // m1 and m2 each lost note-2 but still have a remaining note, so each
      // should kick off a background re-synthesis. m3 was unaffected.
      await waitFor(() => {
        expect(geminiService.submitResynthesis).toHaveBeenCalledTimes(2);
      });
      const submittedMomentIds = (geminiService.submitResynthesis as any).mock.calls.map(
        (c: any[]) => c[0]?.id
      );
      expect(submittedMomentIds).toContain('m1');
      expect(submittedMomentIds).toContain('m2');
      expect(submittedMomentIds).not.toContain('m3');
    });

    it('does not trigger background re-synthesis for a moment that became orphan', async () => {
      // m1 has a single source note — removing it should soft-delete m1
      // rather than re-synthesize an empty moment.
      wireMomentStorage([makeMoment('m1', ['note-1'])]);
      const memories = [makeMemory('note-1')];

      (geminiService.fetchPendingSynthesisResults as any).mockResolvedValue({});
      (geminiService.submitResynthesis as any).mockResolvedValue({ momentId: 'm1' });
      (geminiService.pollSynthesisResult as any).mockImplementation(
        () => new Promise(() => {})
      );

      const { result } = renderHook(() => useMoments(memories));
      await waitFor(() => expect(result.current.moments).toHaveLength(1));

      await act(async () => {
        await result.current.removeNoteFromMoments('note-1');
      });

      // Give the background promise (if any) a chance to run.
      await act(async () => {
        await new Promise(r => setTimeout(r, 0));
      });

      expect(geminiService.submitResynthesis).not.toHaveBeenCalled();
      expect(geminiService.fetchPendingSynthesisResults).not.toHaveBeenCalled();
    });

    it('does not trigger background re-synthesis for a pending moment', async () => {
      wireMomentStorage([
        { ...makeMoment('m1', ['note-1', 'note-2']), isPending: true },
      ]);
      const memories = [makeMemory('note-1'), makeMemory('note-2')];

      (geminiService.fetchPendingSynthesisResults as any).mockResolvedValue({});
      (geminiService.submitResynthesis as any).mockResolvedValue({ momentId: 'm1' });
      (geminiService.pollSynthesisResult as any).mockImplementation(
        () => new Promise(() => {})
      );

      const { result } = renderHook(() => useMoments(memories));
      await waitFor(() => expect(result.current.moments).toHaveLength(1));

      await act(async () => {
        await result.current.removeNoteFromMoments('note-1');
      });

      await act(async () => {
        await new Promise(r => setTimeout(r, 0));
      });

      expect(geminiService.submitResynthesis).not.toHaveBeenCalled();
      expect(geminiService.fetchPendingSynthesisResults).not.toHaveBeenCalled();
    });
  });

  describe('loadSynthesis poll-before-submit', () => {
    it('uses server-cached result with matching hash without calling submitResynthesis', async () => {
      const moments = [makeMoment('m1', ['note-1'])];
      (storageService.getMoments as any).mockResolvedValue(moments);
      const memories = [makeMemory('note-1')];
      const expectedHash = computeInputHash(['note-1'], memories);

      const cachedSynthesis = {
        format: 'general' as const,
        title: 'Cached',
        sections: [
          {
            heading: 'S',
            items: [{ label: 'item', sourceNoteId: 'note-1' }],
          },
        ],
        generatedFrom: ['note-1'],
      };

      (geminiService.fetchPendingSynthesisResults as any).mockResolvedValue({
        m1: { status: 'completed', data: cachedSynthesis, inputHash: expectedHash },
      });

      const { result } = renderHook(() => useMoments(memories));
      await waitFor(() => expect(result.current.moments).toHaveLength(1));

      let synthesis: any;
      await act(async () => {
        synthesis = await result.current.loadSynthesis(result.current.moments[0], memories);
      });

      expect(synthesis).not.toBeNull();
      expect(synthesis.title).toBe('Cached');
      expect(geminiService.submitResynthesis).not.toHaveBeenCalled();
      expect(geminiService.pollSynthesisResult).not.toHaveBeenCalled();
      expect(storageService.saveMomentSynthesis).toHaveBeenCalled();
    });

    it('falls through to submitResynthesis when server hash differs from current', async () => {
      const moments = [makeMoment('m1', ['note-1'])];
      (storageService.getMoments as any).mockResolvedValue(moments);
      const memories = [makeMemory('note-1')];

      (geminiService.fetchPendingSynthesisResults as any).mockResolvedValue({
        m1: {
          status: 'completed',
          data: { format: 'general', title: 'Stale', sections: [], generatedFrom: [] },
          inputHash: 'mh_stale',
        },
      });
      (geminiService.submitResynthesis as any).mockResolvedValue({ momentId: 'm1' });
      (geminiService.pollSynthesisResult as any).mockResolvedValue({
        format: 'general',
        title: 'Fresh',
        sections: [{ heading: 'S', items: [{ label: 'i', sourceNoteId: 'note-1' }] }],
        generatedFrom: ['note-1'],
      });

      const { result } = renderHook(() => useMoments(memories));
      await waitFor(() => expect(result.current.moments).toHaveLength(1));

      let synthesis: any;
      await act(async () => {
        synthesis = await result.current.loadSynthesis(result.current.moments[0], memories);
      });

      expect(synthesis?.title).toBe('Fresh');
      expect(geminiService.submitResynthesis).toHaveBeenCalledTimes(1);
    });

    it('skips submitResynthesis when server reports processing for the same hash', async () => {
      const moments = [makeMoment('m1', ['note-1'])];
      (storageService.getMoments as any).mockResolvedValue(moments);
      const memories = [makeMemory('note-1')];
      const expectedHash = computeInputHash(['note-1'], memories);

      (geminiService.fetchPendingSynthesisResults as any).mockResolvedValue({
        m1: { status: 'processing', inputHash: expectedHash },
      });
      (geminiService.pollSynthesisResult as any).mockResolvedValue({
        format: 'general',
        title: 'Polled',
        sections: [{ heading: 'S', items: [{ label: 'i', sourceNoteId: 'note-1' }] }],
        generatedFrom: ['note-1'],
      });

      const { result } = renderHook(() => useMoments(memories));
      await waitFor(() => expect(result.current.moments).toHaveLength(1));

      await act(async () => {
        await result.current.loadSynthesis(result.current.moments[0], memories);
      });

      expect(geminiService.submitResynthesis).not.toHaveBeenCalled();
      expect(geminiService.pollSynthesisResult).toHaveBeenCalledWith('m1', expect.any(AbortSignal));
    });

    it('writes a recovery marker before submitting and clears it on completion', async () => {
      const moments = [makeMoment('m1', ['note-1'])];
      (storageService.getMoments as any).mockResolvedValue(moments);
      const memories = [makeMemory('note-1')];
      const expectedHash = computeInputHash(['note-1'], memories);

      (geminiService.fetchPendingSynthesisResults as any).mockResolvedValue({
        m1: { status: 'not_found' },
      });
      (geminiService.submitResynthesis as any).mockResolvedValue({ momentId: 'm1' });
      (geminiService.pollSynthesisResult as any).mockResolvedValue({
        format: 'general',
        title: 'Done',
        sections: [{ heading: 'S', items: [{ label: 'i', sourceNoteId: 'note-1' }] }],
        generatedFrom: ['note-1'],
      });

      const { result } = renderHook(() => useMoments(memories));
      await waitFor(() => expect(result.current.moments).toHaveLength(1));

      (storageService.saveMoment as any).mockClear();

      await act(async () => {
        await result.current.loadSynthesis(result.current.moments[0], memories);
      });

      const saveMomentCalls = (storageService.saveMoment as any).mock.calls;
      // At least two calls: one writing the marker, one clearing it on completion.
      const markerWrite = saveMomentCalls.find(
        (c: any[]) => c[0]?.pendingSynthesisHash === expectedHash,
      );
      expect(markerWrite).toBeDefined();

      const finalMoment = result.current.moments.find(m => m.id === 'm1')!;
      expect(finalMoment.pendingSynthesisHash).toBeUndefined();
      expect(finalMoment.pendingSynthesisAt).toBeUndefined();
      expect(finalMoment.inputHash).toBe(expectedHash);
      expect(geminiService.submitResynthesis).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'm1' }),
        memories,
        expectedHash,
        undefined, // no cached synthesis → full regenerate (no merge)
      );
    });

    it('clears processingError when entering the cache-miss path', async () => {
      const moments = [
        { ...makeMoment('m1', ['note-1']), processingError: true },
      ];
      (storageService.getMoments as any).mockResolvedValue(moments);
      const memories = [makeMemory('note-1')];

      (geminiService.fetchPendingSynthesisResults as any).mockResolvedValue({
        m1: { status: 'not_found' },
      });
      (geminiService.submitResynthesis as any).mockResolvedValue({ momentId: 'm1' });
      (geminiService.pollSynthesisResult as any).mockResolvedValue({
        format: 'general',
        title: 'Done',
        sections: [{ heading: 'S', items: [{ label: 'i', sourceNoteId: 'note-1' }] }],
        generatedFrom: ['note-1'],
      });

      const { result } = renderHook(() => useMoments(memories));
      await waitFor(() => expect(result.current.moments).toHaveLength(1));
      expect(result.current.moments[0].processingError).toBe(true);

      await act(async () => {
        await result.current.loadSynthesis(result.current.moments[0], memories);
      });

      const finalMoment = result.current.moments.find(m => m.id === 'm1')!;
      expect(finalMoment.processingError).toBe(false);
    });

    it('does not resurrect a moment deleted while loadSynthesis is in flight', async () => {
      // Reproduces the user-reported bug: user opens a moment (triggers
      // loadSynthesis), deletes it before the network result arrives.
      // Without the tombstone re-read in persistResult, the captured
      // workingMoment is spread into saveMoment() and resurrects the
      // deleted moment in IndexedDB; the next refresh re-renders it.
      const moments = [makeMoment('m1', ['note-1'])];
      const memories = [makeMemory('note-1')];

      (storageService.getMoments as any).mockResolvedValue(moments);
      // First read returns the alive moment (loadSynthesis startup);
      // after the user "deletes", subsequent reads return a tombstone.
      let isDeleted = false;
      (storageService.getMoment as any).mockImplementation(async (id: string) => {
        if (id !== 'm1') return null;
        const base = moments[0];
        return isDeleted ? { ...base, isDeleted: true } : base;
      });

      // The "delete" happens during the polling network round-trip.
      (geminiService.fetchPendingSynthesisResults as any).mockResolvedValue({
        m1: { status: 'not_found' },
      });
      (geminiService.submitResynthesis as any).mockResolvedValue({ momentId: 'm1' });
      (geminiService.pollSynthesisResult as any).mockImplementation(async () => {
        isDeleted = true;
        return {
          format: 'general',
          title: 'Resurrected',
          sections: [{ heading: 'S', items: [{ label: 'i', sourceNoteId: 'note-1' }] }],
          generatedFrom: ['note-1'],
        };
      });

      const { result } = renderHook(() => useMoments(memories));
      await waitFor(() => expect(result.current.moments).toHaveLength(1));

      let synthesis: any;
      await act(async () => {
        synthesis = await result.current.loadSynthesis(result.current.moments[0], memories);
      });

      // persistResult should bail out because the moment is now tombstoned.
      expect(synthesis).toBeNull();
      // Critically, no alive moment should have been written back to IDB.
      const aliveSaves = (storageService.saveMoment as any).mock.calls.filter(
        (c: any[]) => c[0]?.id === 'm1' && !c[0]?.isDeleted,
      );
      const resurrectedSave = aliveSaves.find(
        (c: any[]) => c[0]?.lastSynthesizedAt !== undefined,
      );
      expect(resurrectedSave).toBeUndefined();
      expect(storageService.saveMomentSynthesis).not.toHaveBeenCalled();
    });
  });

  describe('addNoteToMoment background re-synthesis', () => {
    it('triggers a background submitResynthesis after a note matches', async () => {
      wireMomentStorage([makeMoment('m1', ['note-1'])]);
      const memories = [makeMemory('note-1'), makeMemory('note-2')];

      (geminiService.fetchPendingSynthesisResults as any).mockResolvedValue({
        m1: { status: 'not_found' },
      });
      (geminiService.submitResynthesis as any).mockResolvedValue({ momentId: 'm1' });
      (geminiService.pollSynthesisResult as any).mockResolvedValue({
        format: 'general',
        title: 'Done',
        sections: [{ heading: 'S', items: [{ label: 'i', sourceNoteId: 'note-1' }] }],
        generatedFrom: ['note-1'],
      });

      const { result } = renderHook(() => useMoments(memories));
      await waitFor(() => expect(result.current.moments).toHaveLength(1));

      await act(async () => {
        await result.current.addNoteToMoment('m1', 'note-2');
      });

      // Wait for the fire-and-forget loadSynthesis to drive submitResynthesis.
      await waitFor(() => {
        expect(geminiService.submitResynthesis).toHaveBeenCalledTimes(1);
      });

      const m1 = result.current.moments.find(m => m.id === 'm1');
      expect(m1?.noteIds).toEqual(['note-1', 'note-2']);
    });

    it('does not trigger background re-synthesis for a pending moment', async () => {
      wireMomentStorage([{ ...makeMoment('m1', ['note-1']), isPending: true }]);
      const memories = [makeMemory('note-1'), makeMemory('note-2')];

      const { result } = renderHook(() => useMoments(memories));
      await waitFor(() => expect(result.current.moments).toHaveLength(1));

      await act(async () => {
        await result.current.addNoteToMoment('m1', 'note-2');
      });

      // Give any background promise a chance to run before asserting.
      await act(async () => {
        await new Promise(r => setTimeout(r, 0));
      });

      expect(geminiService.submitResynthesis).not.toHaveBeenCalled();
      expect(geminiService.fetchPendingSynthesisResults).not.toHaveBeenCalled();
    });

    it('aborts the in-flight poll and submits fresh when a second match arrives mid-flight', async () => {
      wireMomentStorage([makeMoment('m1', ['note-1'])]);
      const memories = [makeMemory('note-1'), makeMemory('note-2'), makeMemory('note-3')];

      (geminiService.fetchPendingSynthesisResults as any).mockResolvedValue({
        m1: { status: 'not_found' },
      });
      (geminiService.submitResynthesis as any).mockResolvedValue({ momentId: 'm1' });

      // First poll: hangs until aborted, then rejects with AbortError.
      // Second poll: resolves with the fresh result.
      let pollCallCount = 0;
      (geminiService.pollSynthesisResult as any).mockImplementation(
        (_id: string, signal?: AbortSignal) => {
          pollCallCount++;
          if (pollCallCount === 1) {
            return new Promise((_, reject) => {
              const onAbort = () => reject(
                new DOMException('Synthesis polling aborted', 'AbortError')
              );
              if (signal?.aborted) onAbort();
              else signal?.addEventListener('abort', onAbort, { once: true });
            });
          }
          return Promise.resolve({
            format: 'general',
            title: 'Fresh (n=3)',
            sections: [{ heading: 'S', items: [{ label: 'i', sourceNoteId: 'note-1' }] }],
            generatedFrom: ['note-1'],
          });
        }
      );

      const { result } = renderHook(() => useMoments(memories));
      await waitFor(() => expect(result.current.moments).toHaveLength(1));

      // First match — kicks off in-flight poll for [note-1, note-2].
      await act(async () => {
        await result.current.addNoteToMoment('m1', 'note-2');
      });
      await waitFor(() => expect(pollCallCount).toBe(1));

      // Second match — should abort the first poll and submit a fresh
      // resynthesis for [note-1, note-2, note-3].
      await act(async () => {
        await result.current.addNoteToMoment('m1', 'note-3');
      });

      await waitFor(() => {
        expect(geminiService.submitResynthesis).toHaveBeenCalledTimes(2);
      });
      await waitFor(() => expect(pollCallCount).toBe(2));

      // Only the second submission's result is persisted (the first poll's
      // AbortError causes its loadSynthesis caller to bail before persist).
      await waitFor(() => {
        expect(storageService.saveMomentSynthesis).toHaveBeenCalled();
      });
      const synthesisCalls = (storageService.saveMomentSynthesis as any).mock.calls;
      const persistedTitles = synthesisCalls.map((c: any[]) => c[0]?.content?.title);
      expect(persistedTitles).toContain('Fresh (n=3)');
      // The aborted call did not persist anything for the n=2 set.
      expect(persistedTitles.filter((t: string | undefined) => t === undefined)).toHaveLength(0);

      const m1 = result.current.moments.find(m => m.id === 'm1');
      expect(m1?.noteIds).toEqual(['note-1', 'note-2', 'note-3']);
    });
  });

  describe('agentic moments', () => {
    it('keeps web-sourced items (no sourceNoteId) while dropping stale note items', async () => {
      (storageService.getMoments as any).mockResolvedValue([makeMoment('m1', ['note-1'])]);
      const memories = [makeMemory('note-1')];

      (geminiService.submitResynthesis as any).mockResolvedValue({ momentId: 'm1' });
      (geminiService.pollSynthesisResult as any).mockResolvedValue({
        format: 'general',
        title: 'Test',
        sections: [
          {
            heading: 'Mixed',
            items: [
              { label: 'From note', sourceType: 'note', sourceNoteId: 'note-1' },
              { label: 'From the web', sourceType: 'web', sourceUrl: 'https://example.com/x' },
              { label: 'Stale note', sourceType: 'note', sourceNoteId: 'gone' },
            ],
          },
        ],
        generatedFrom: ['note-1'],
      });

      const { result } = renderHook(() => useMoments(memories));
      await waitFor(() => expect(result.current.moments).toHaveLength(1));

      let synthesis: any;
      await act(async () => {
        synthesis = await result.current.loadSynthesis(result.current.moments[0], memories);
      });

      const labels = synthesis.sections[0].items.map((i: any) => i.label);
      expect(labels).toContain('From note');
      expect(labels).toContain('From the web'); // kept despite no sourceNoteId
      expect(labels).not.toContain('Stale note'); // dropped — note left the moment
    });

    it('passes the cached synthesis to submitResynthesis so the server merges', async () => {
      wireMomentStorage([makeMoment('m1', ['note-1'])]);
      const memories = [makeMemory('note-1'), makeMemory('note-2')];

      // Persisted synthesis fresh for the ['note-1'] set, containing a web item.
      const cached = {
        momentId: 'm1',
        inputHash: computeInputHash(['note-1'], memories),
        content: {
          format: 'general', title: 'Cached', sections: [
            { heading: 'S', items: [{ label: 'web fact', sourceType: 'web', sourceUrl: 'https://example.com/a' }] },
          ], generatedFrom: [],
        },
        generatedAt: Date.now(),
        noteIds: ['note-1'],
      };
      (storageService.getMomentSynthesis as any).mockResolvedValue(cached);
      (geminiService.submitResynthesis as any).mockResolvedValue({ momentId: 'm1' });
      (geminiService.pollSynthesisResult as any).mockImplementation(() => new Promise(() => {}));

      const { result } = renderHook(() => useMoments(memories));
      await waitFor(() => expect(result.current.moments).toHaveLength(1));

      // Prime the in-memory cache (cache hit for the ['note-1'] set, no submit).
      await act(async () => {
        await result.current.loadSynthesis(result.current.moments[0], memories);
      });
      expect(geminiService.submitResynthesis).not.toHaveBeenCalled();

      // Now load with note-2 added → hash changes → cache miss → merge submit,
      // forwarding the previously-cached content (with its web item) as 4th arg.
      const withAddedNote = { ...result.current.moments[0], noteIds: ['note-1', 'note-2'] };
      await act(async () => {
        result.current.loadSynthesis(withAddedNote as any, memories);
      });

      await waitFor(() => expect(geminiService.submitResynthesis).toHaveBeenCalled());
      const lastCall = (geminiService.submitResynthesis as any).mock.calls.at(-1);
      expect(lastCall[3]?.sections?.[0]?.items?.[0]?.sourceType).toBe('web');
    });

    it('flags needsAgenticRebuild and preserves synthesis when merge is unplaceable', async () => {
      wireMomentStorage([makeMoment('m1', ['note-1'])]);
      const memories = [makeMemory('note-1')];

      (geminiService.fetchPendingSynthesisResults as any).mockResolvedValue({});
      (geminiService.submitResynthesis as any).mockResolvedValue({ momentId: 'm1' });
      (geminiService.pollSynthesisResult as any).mockRejectedValue(
        new geminiService.MomentNeedsRebuildError()
      );

      const { result } = renderHook(() => useMoments(memories));
      await waitFor(() => expect(result.current.moments).toHaveLength(1));

      (storageService.saveMomentSynthesis as any).mockClear();

      await act(async () => {
        // force a submit → poll rejects with needs-rebuild
        await result.current.loadSynthesis(result.current.moments[0], memories, undefined, true);
      });

      await waitFor(() => {
        const m1 = result.current.moments.find(m => m.id === 'm1');
        expect(m1?.needsAgenticRebuild).toBe(true);
      });
      // The existing synthesis was NOT overwritten.
      expect(storageService.saveMomentSynthesis).not.toHaveBeenCalled();
    });

    it('rebuildMomentWithAgent re-submits creation with the moment notes and sets pending', async () => {
      wireMomentStorage([
        { ...makeMoment('m1', ['note-1', 'note-2']), needsAgenticRebuild: true },
      ]);
      const memories = [makeMemory('note-1'), makeMemory('note-2')];
      (geminiService.submitMomentCreation as any).mockResolvedValue({ momentId: 'm1' });

      const { result } = renderHook(() => useMoments(memories));
      await waitFor(() => expect(result.current.moments).toHaveLength(1));

      await act(async () => {
        await result.current.rebuildMomentWithAgent('m1');
      });

      expect(geminiService.submitMomentCreation).toHaveBeenCalledWith(
        'Test objective',
        expect.arrayContaining([
          expect.objectContaining({ id: 'note-1' }),
          expect.objectContaining({ id: 'note-2' }),
        ]),
        'm1',
      );
      const m1 = result.current.moments.find(m => m.id === 'm1');
      expect(m1?.isPending).toBe(true);
      expect(m1?.needsAgenticRebuild).toBe(false);
    });
  });
});
