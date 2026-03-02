
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMemories } from './useMemories';
import * as storageService from '../services/storageService';
import * as geminiService from '../services/geminiService';

// Mock the services
vi.mock('../services/storageService');
vi.mock('../services/geminiService');

// Mock platform storage to prevent sample seeding in tests
vi.mock('../services/platform', () => ({
  storage: {
    get: vi.fn().mockResolvedValue('true'), // samples_initialized = true
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  isNative: vi.fn().mockReturnValue(false),
}));

// Mock useSync hook
vi.mock('../hooks/useSync', () => ({
  useSync: () => ({
    sync: vi.fn(),
    syncFile: vi.fn().mockResolvedValue(undefined),
    isLinked: vi.fn().mockReturnValue(false),
  })
}));

// Mock useAuth hook
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    authStatus: 'unlinked',
  })
}));

describe('useMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for fetchPendingEnrichments (recovery effect calls this for pending memories)
    (geminiService.fetchPendingEnrichments as any).mockResolvedValue({});
  });

  it('should load memories on mount', async () => {
    const mockMemories = [{ id: '1', content: 'test', timestamp: 123, tags: [] }];
    (storageService.getMemories as any).mockResolvedValue(mockMemories);

    const { result } = renderHook(() => useMemories());

    // Initially empty
    expect(result.current.memories).toEqual([]);

    // Wait for the effect to run
    await waitFor(() => {
        expect(result.current.memories).toEqual(mockMemories);
    });

    expect(storageService.getMemories).toHaveBeenCalled();
  });

  it('should refresh memories', async () => {
    const mockMemories1 = [{ id: '1', content: 'test', timestamp: 123, tags: [] }];
    const mockMemories2 = [{ id: '2', content: 'test2', timestamp: 124, tags: [] }];

    (storageService.getMemories as any)
        .mockResolvedValueOnce(mockMemories1)
        .mockResolvedValueOnce(mockMemories2);

    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
        expect(result.current.memories).toEqual(mockMemories1);
    });

    await act(async () => {
        await result.current.refreshMemories();
    });

    expect(result.current.memories).toEqual(mockMemories2);
  });

  it('should handle delete memory', async () => {
    const mockMemories = [{ id: '1', content: 'test', timestamp: 123, tags: [] }];
    (storageService.getMemories as any).mockResolvedValue(mockMemories);
    (storageService.deleteMemory as any).mockResolvedValue(undefined);
    (storageService.saveMemory as any).mockResolvedValue(undefined); // handle delete uses saveMemory for soft delete or deleteMemory for hard

    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
        expect(result.current.memories).toEqual(mockMemories);
    });

    await act(async () => {
        await result.current.handleDelete('1');
    });

    // We can't strictly check for deleteMemory here because the logic might handle soft delete (update with isDeleted=true)
    // or hard delete. But we expect memories to be empty.
    expect(result.current.memories).toEqual([]);
  });

  it('should handle retry memory — set isPending after server accepts', async () => {
    const mockMemories = [{ id: '1', content: 'test', timestamp: 123, tags: [], processingError: true }];

    (storageService.getMemories as any).mockResolvedValue(mockMemories);
    (geminiService.submitEnrichment as any).mockResolvedValue(undefined);
    (storageService.saveMemory as any).mockResolvedValue(undefined);

    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
        expect(result.current.memories).toEqual(mockMemories);
    });

    await act(async () => {
        await result.current.handleRetry('1');
    });

    // submitEnrichment should have been called (not enrichInput)
    expect(geminiService.submitEnrichment).toHaveBeenCalled();
    expect(storageService.saveMemory).toHaveBeenCalled();

    // After server accepted, memory should be in isPending state (waiting for polling to resolve)
    const updatedMemory = result.current.memories.find(m => m.id === '1');
    expect(updatedMemory?.isPending).toBe(true);
    expect(updatedMemory?.processingError).toBe(false);
  });

  it('should not set isPending when retry submission fails', async () => {
    const mockMemories = [{ id: '1', content: 'test', timestamp: 123, tags: [], processingError: true }];

    (storageService.getMemories as any).mockResolvedValue(mockMemories);
    (geminiService.submitEnrichment as any).mockRejectedValue(new Error('Auth failed'));
    (storageService.saveMemory as any).mockResolvedValue(undefined);

    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
        expect(result.current.memories).toEqual(mockMemories);
    });

    await act(async () => {
        await result.current.handleRetry('1');
    });

    // Memory should remain in error state, NOT show "Enriching..."
    const updatedMemory = result.current.memories.find(m => m.id === '1');
    expect(updatedMemory?.isPending).toBe(false);
    expect(updatedMemory?.processingError).toBe(true);
  });

  it('should retry failed memories when back online', async () => {
    const mockMemories = [{ id: '1', content: 'test', timestamp: 123, tags: [], processingError: true }];

    (storageService.getMemories as any).mockResolvedValue(mockMemories);
    (geminiService.submitEnrichment as any).mockResolvedValue(undefined);
    (storageService.saveMemory as any).mockResolvedValue(undefined);

    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
        expect(result.current.memories).toEqual(mockMemories);
    });

    // Simulate online event
    await act(async () => {
        window.dispatchEvent(new Event('online'));
    });

    // The online handler calls handleRetry for failed memories,
    // which calls submitEnrichment
    await waitFor(() => {
        expect(geminiService.submitEnrichment).toHaveBeenCalled();
    });
  });

  describe('create → enrich → poll → display pipeline', () => {
    // Helper: flush pending microtasks (promise .then/.catch chains) without
    // running all timers, which would trigger the infinite polling loop.
    // Advancing by 1ms fires only immediate/0ms timers and lets the event
    // loop process queued microtasks from resolved promises.
    const flushMicrotasks = async () => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
    };

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should persist memory to IndexedDB before submitting enrichment', async () => {
      (storageService.getMemories as any).mockResolvedValue([]);
      (storageService.saveMemory as any).mockResolvedValue(undefined);
      (storageService.getMemory as any).mockImplementation(async (id: string) => ({
        id, content: 'Buy groceries', timestamp: Date.now(), tags: ['todo'], isPending: false, processingError: false,
      }));
      // Keep enrichment pending (never resolves during this test)
      (geminiService.submitEnrichment as any).mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useMemories());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.createMemory('Buy groceries', [], ['todo']);
      });

      // saveMemory must be called BEFORE submitEnrichment — verify ordering
      const saveOrder = (storageService.saveMemory as any).mock.invocationCallOrder[0];
      const enrichOrder = (geminiService.submitEnrichment as any).mock.invocationCallOrder[0];
      expect(saveOrder).toBeLessThan(enrichOrder);

      // Memory should appear in the list immediately
      expect(result.current.memories).toHaveLength(1);
      expect(result.current.memories[0].content).toBe('Buy groceries');
      expect(result.current.memories[0].tags).toEqual(['todo']);

      // Initial save should NOT have isPending
      const savedArg = (storageService.saveMemory as any).mock.calls[0][0];
      expect(savedArg.isPending).toBe(false);
      expect(savedArg.content).toBe('Buy groceries');
    });

    it('should transition to isPending after server accepts enrichment', async () => {
      (storageService.getMemories as any).mockResolvedValue([]);
      (storageService.saveMemory as any).mockResolvedValue(undefined);
      (storageService.getMemory as any).mockImplementation(async (id: string) => ({
        id, content: 'Meeting notes', timestamp: Date.now(), tags: [], isPending: false, processingError: false,
      }));
      (geminiService.submitEnrichment as any).mockResolvedValue(undefined);
      (geminiService.fetchPendingEnrichments as any).mockResolvedValue({});

      const { result } = renderHook(() => useMemories());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.createMemory('Meeting notes', [], []);
      });

      // Flush the .then() microtask chain from submitEnrichment without
      // triggering the infinite polling setTimeout loop.
      await flushMicrotasks();

      // Memory should now be in "Enriching..." state
      await waitFor(() => {
        const memory = result.current.memories[0];
        expect(memory.isPending).toBe(true);
      });

      // saveMemory should have been called twice: initial save + pending update
      expect(storageService.saveMemory).toHaveBeenCalledTimes(2);
      const pendingSaveArg = (storageService.saveMemory as any).mock.calls[1][0];
      expect(pendingSaveArg.isPending).toBe(true);
    });

    it('should set processingError when enrichment submission fails', async () => {
      (storageService.getMemories as any).mockResolvedValue([]);
      (storageService.saveMemory as any).mockResolvedValue(undefined);
      (storageService.getMemory as any).mockImplementation(async (id: string) => ({
        id, content: 'Will fail', timestamp: Date.now(), tags: [], isPending: false, processingError: false,
      }));
      (geminiService.submitEnrichment as any).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useMemories());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.createMemory('Will fail', [], []);
      });

      // Flush the .catch() microtask chain
      await flushMicrotasks();

      await waitFor(() => {
        const memory = result.current.memories[0];
        expect(memory.processingError).toBe(true);
        expect(memory.isPending).toBe(false);
      });
    });

    it('should complete enrichment when polling returns completed result', async () => {
      const enrichmentData = {
        summary: 'A reminder to buy groceries',
        suggestedTags: ['shopping', 'errands'],
      };

      (storageService.getMemories as any).mockResolvedValue([]);
      (storageService.saveMemory as any).mockResolvedValue(undefined);
      (storageService.getMemory as any).mockImplementation(async (id: string) => ({
        id, content: 'Buy groceries', timestamp: Date.now(), tags: ['todo'],
        isPending: true, processingError: false,
      }));
      (geminiService.submitEnrichment as any).mockResolvedValue(undefined);

      // First poll returns "processing", second returns "completed"
      let pollCount = 0;
      (geminiService.fetchPendingEnrichments as any).mockImplementation(async (ids: string[]) => {
        pollCount++;
        const id = ids[0];
        if (pollCount <= 1) {
          return { [id]: { status: 'processing' } };
        }
        return { [id]: { status: 'completed', data: enrichmentData } };
      });

      const { result } = renderHook(() => useMemories());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Create the memory
      await act(async () => {
        await result.current.createMemory('Buy groceries', [], ['todo']);
      });

      // Flush enrichment submission .then() — sets isPending and starts polling
      await flushMicrotasks();

      await waitFor(() => {
        expect(result.current.memories[0]?.isPending).toBe(true);
      });

      // Advance past the initial 2s polling delay to trigger first poll
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_500);
      });

      // First poll returns "processing" — still pending.
      // Advance past the next Fibonacci delay (3s = 1s + 2s)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_500);
      });

      // Second poll returns "completed" — memory should have enrichment data.
      // The poll also re-schedules once (stale memoriesRef), so advance a
      // bit more to let the third poll see no pending items and stop.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });

      await waitFor(() => {
        const memory = result.current.memories[0];
        expect(memory.isPending).toBe(false);
        expect(memory.enrichment).toBeDefined();
        expect(memory.enrichment?.summary).toBe('A reminder to buy groceries');
      });

      // Tags should be merged (user tags + suggested tags, deduplicated)
      const memory = result.current.memories[0];
      expect(memory.tags).toContain('todo');
      expect(memory.tags).toContain('shopping');
      expect(memory.tags).toContain('errands');
    });

    it('should mark memory as failed when polling returns failed status', async () => {
      (storageService.getMemories as any).mockResolvedValue([]);
      (storageService.saveMemory as any).mockResolvedValue(undefined);
      (storageService.getMemory as any).mockImplementation(async (id: string) => ({
        id, content: 'Test', timestamp: Date.now(), tags: [],
        isPending: true, processingError: false,
      }));
      (geminiService.submitEnrichment as any).mockResolvedValue(undefined);
      (geminiService.fetchPendingEnrichments as any).mockImplementation(async (ids: string[]) => {
        return { [ids[0]]: { status: 'failed' } };
      });

      const { result } = renderHook(() => useMemories());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.createMemory('Test', [], []);
      });

      // Flush enrichment .then()
      await flushMicrotasks();

      await waitFor(() => {
        expect(result.current.memories[0]?.isPending).toBe(true);
      });

      // Advance past the 2s initial polling delay
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_500);
      });

      // Poll returns "failed" — memory should show error state
      await waitFor(() => {
        const memory = result.current.memories[0];
        expect(memory.isPending).toBe(false);
        expect(memory.processingError).toBe(true);
      });
    });

    it('should not enter enriching state if memory was deleted before server response', async () => {
      (storageService.getMemories as any).mockResolvedValue([]);
      (storageService.saveMemory as any).mockResolvedValue(undefined);
      (storageService.deleteMemory as any).mockResolvedValue(undefined);

      // getMemory returns null (deleted) when checked after enrichment response
      (storageService.getMemory as any).mockResolvedValue(null);
      (geminiService.submitEnrichment as any).mockResolvedValue(undefined);

      const { result } = renderHook(() => useMemories());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.createMemory('Delete me', [], []);
      });

      // Delete the memory before the enrichment .then() runs
      await act(async () => {
        const memoryId = result.current.memories[0].id;
        await result.current.handleDelete(memoryId);
      });

      // Flush the enrichment .then() — getMemory returns null so it should bail out
      await flushMicrotasks();

      // Memory should be gone, not re-added with isPending
      expect(result.current.memories).toHaveLength(0);
    });

    it('should handle the full update → re-enrich pipeline', async () => {
      const existingMemory = {
        id: 'existing-1', content: 'Old content', timestamp: 100, tags: ['work'],
        isPending: false, processingError: false,
      };
      const enrichmentData = {
        summary: 'Updated meeting notes summary',
        suggestedTags: ['meetings'],
      };

      (storageService.getMemories as any).mockResolvedValue([existingMemory]);
      (storageService.saveMemory as any).mockResolvedValue(undefined);
      (storageService.getMemory as any).mockImplementation(async (id: string) => ({
        ...existingMemory,
        id,
        content: 'Updated content',
        tags: ['work'],
        isPending: true,
        processingError: false,
      }));
      (geminiService.submitEnrichment as any).mockResolvedValue(undefined);
      (geminiService.fetchPendingEnrichments as any).mockImplementation(async (ids: string[]) => {
        return { [ids[0]]: { status: 'completed', data: enrichmentData } };
      });

      const { result } = renderHook(() => useMemories());
      await waitFor(() => expect(result.current.memories).toHaveLength(1));

      // Update the memory
      await act(async () => {
        await result.current.updateMemory('existing-1', 'Updated content', [], ['work']);
      });

      // Content should update immediately
      expect(result.current.memories[0].content).toBe('Updated content');

      // Flush enrichment .then() to set isPending
      await flushMicrotasks();

      await waitFor(() => {
        expect(result.current.memories[0].isPending).toBe(true);
      });

      // Advance timers for polling (2s initial + extra for stale ref cycle)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_500);
      });

      // Advance a bit more to let the stale-ref re-poll see no pending
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });

      // Enrichment completes
      await waitFor(() => {
        const memory = result.current.memories[0];
        expect(memory.isPending).toBe(false);
        expect(memory.enrichment?.summary).toBe('Updated meeting notes summary');
        expect(memory.tags).toContain('meetings');
      });
    });

    it('should recover pending memories on app load and complete enrichment', async () => {
      const pendingMemory = {
        id: 'pending-1', content: 'Recovering', timestamp: Date.now(), tags: [],
        isPending: true, processingError: false,
      };
      const enrichmentData = {
        summary: 'Recovered summary',
        suggestedTags: ['recovered'],
      };

      (storageService.getMemories as any).mockResolvedValue([pendingMemory]);
      (storageService.saveMemory as any).mockResolvedValue(undefined);
      (storageService.getMemory as any).mockImplementation(async () => pendingMemory);

      // Recovery fetch returns completed
      (geminiService.fetchPendingEnrichments as any).mockResolvedValue({
        'pending-1': { status: 'completed', data: enrichmentData },
      });

      const { result } = renderHook(() => useMemories());

      // Wait for initial load + recovery effect to run
      await waitFor(() => {
        const memory = result.current.memories.find(m => m.id === 'pending-1');
        expect(memory?.isPending).toBe(false);
        expect(memory?.enrichment?.summary).toBe('Recovered summary');
      });

      expect(geminiService.fetchPendingEnrichments).toHaveBeenCalledWith(['pending-1']);
    });
  });
});
