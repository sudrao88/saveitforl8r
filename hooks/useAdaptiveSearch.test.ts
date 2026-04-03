import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAdaptiveSearch, ModelStatus } from './useAdaptiveSearch';

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-query-id'),
}));

// Mock geminiService
vi.mock('../services/geminiService', () => ({
  queryBrain: vi.fn().mockResolvedValue({ answer: 'online result' }),
}));

// Create a mock Worker class that simulates embedding.worker behavior
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  private messageHandlers: Array<(data: any) => void> = [];

  postMessage(data: any) {
    // Simulate worker responses based on message type
    setTimeout(() => {
      this.handleMessage(data);
    }, 0);
  }

  terminate() {}

  private handleMessage(data: any) {
    const { type, payload } = data;

    if (type === 'SET_ONLINE_STATUS') {
      // Worker acknowledges online status - no response needed
    } else if (type === 'CHECK_MODEL_CACHE') {
      this.respond({ type: 'MODEL_CACHE_STATUS', payload: { isCached: true } });
    } else if (type === 'CHECK_MODEL_STATUS') {
      this.respond({ type: 'MODEL_STATUS', payload: 'ready' });
    } else if (type === 'START_PROCESSING') {
      // Worker starts processing - no response needed
    } else if (type === 'SEARCH') {
      const { queryId } = payload;
      // Simulate search results
      this.respond({
        type: 'SEARCH_RESULTS',
        queryId,
        payload: [
          {
            id: 'note1_0',
            text: 'This is a matched chunk from an offline search',
            score: 0.85,
            metadata: { originalId: 'note1', chunkIndex: 0 },
          },
          {
            id: 'note2_0',
            text: 'Another relevant result found locally',
            score: 0.72,
            metadata: { originalId: 'note2', chunkIndex: 0 },
          },
        ],
      });
    } else if (type === 'GET_STATS') {
      this.respond({
        type: 'STATS_UPDATE',
        payload: { pending: 0, failed: 0, completed: 5 },
      });
    } else if (type === 'DELETE_NOTE') {
      this.respond({
        type: 'STATS_UPDATE',
        payload: { pending: 0, failed: 0, completed: 4 },
      });
    } else if (type === 'REBUILD_INDEX') {
      this.respond({ type: 'INDEX_REBUILT' });
    } else if (type === 'CLOSE_DB') {
      this.respond({ type: 'DB_CLOSED' });
    } else if (type === 'RETRY_FAILED') {
      // Worker retries - no immediate response
    }
  }

  respond(data: any) {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }
}

// Store mock worker instance for test manipulation
let mockWorkerInstance: MockWorker;

// Mock the Worker constructor
vi.stubGlobal('Worker', class {
  constructor() {
    mockWorkerInstance = new MockWorker();
    return mockWorkerInstance as any;
  }
});

describe('useAdaptiveSearch - Offline Vector DB Reading', () => {
  let originalNavigator: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Default: offline mode
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Offline search via local vector DB', () => {
    it('should initialize worker on mount', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());

      // Worker should be created and initial messages sent
      await vi.advanceTimersByTimeAsync(10);

      // Model status should update to ready after CHECK_MODEL_STATUS response
      await waitFor(() => {
        expect(result.current.modelStatus).toBe('ready');
      });
    });

    it('should report offline status when navigator.onLine is false', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      expect(result.current.isOnline).toBe(false);
    });

    it('should perform offline search and return local vector results', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      // Wait for model to be ready
      await waitFor(() => {
        expect(result.current.modelStatus).toBe('ready');
      });

      let searchResult: any;
      await act(async () => {
        searchResult = await result.current.search('test query');
      });

      expect(searchResult.mode).toBe('offline');
      expect(searchResult.result).toHaveLength(2);
      expect(searchResult.result[0].text).toBe('This is a matched chunk from an offline search');
      expect(searchResult.result[0].score).toBe(0.85);
      expect(searchResult.result[0].metadata.originalId).toBe('note1');
    });

    it('should return empty result for empty query', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      let searchResult: any;
      await act(async () => {
        searchResult = await result.current.search('');
      });

      expect(searchResult.mode).toBe('empty');
      expect(searchResult.result).toEqual([]);
    });

    it('should return empty result for whitespace-only query', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      let searchResult: any;
      await act(async () => {
        searchResult = await result.current.search('   ');
      });

      expect(searchResult.mode).toBe('empty');
      expect(searchResult.result).toEqual([]);
    });

    it('should return offline_model_error when model status is error', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      // Simulate model error
      act(() => {
        mockWorkerInstance.respond({
          type: 'MODEL_STATUS',
          payload: 'error',
          error: 'Model not available offline',
        });
      });

      await waitFor(() => {
        expect(result.current.modelStatus).toBe('error');
      });

      let searchResult: any;
      await act(async () => {
        searchResult = await result.current.search('test query');
      });

      expect(searchResult.mode).toBe('offline_model_error');
      expect(searchResult.result).toEqual([]);
      expect(searchResult.error).toContain('Model not available offline');
    });

    it('should track isSearching state during offline search', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      await waitFor(() => {
        expect(result.current.modelStatus).toBe('ready');
      });

      // Before search
      expect(result.current.isSearching).toBe(false);

      await act(async () => {
        await result.current.search('test query');
      });

      // After search completes
      expect(result.current.isSearching).toBe(false);
    });

    it('should handle search timeout gracefully', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      await waitFor(() => {
        expect(result.current.modelStatus).toBe('ready');
      });

      // Override the mock worker to NOT respond to SEARCH messages (simulate timeout)
      const originalHandleMessage = (mockWorkerInstance as any).handleMessage.bind(mockWorkerInstance);
      (mockWorkerInstance as any).handleMessage = (data: any) => {
        if (data.type === 'SEARCH') {
          // Don't respond - simulate worker hang
          return;
        }
        originalHandleMessage(data);
      };

      let searchResult: any;
      const searchPromise = act(async () => {
        searchResult = await result.current.search('timeout test');
      });

      // Advance past the 30-second timeout
      await vi.advanceTimersByTimeAsync(31_000);
      await searchPromise;

      expect(searchResult.mode).toBe('offline');
      expect(searchResult.result).toEqual([]);
    });
  });

  describe('Model cache status', () => {
    it('should check model cache on initialization', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      await waitFor(() => {
        expect(result.current.isModelCached).toBe(true);
      });
    });

    it('should expose checkModelCache function', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      expect(typeof result.current.checkModelCache).toBe('function');
    });

    it('should report model status transitions', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());

      // Initially idle
      expect(result.current.modelStatus).toBe('idle');

      await vi.advanceTimersByTimeAsync(10);

      // After CHECK_MODEL_STATUS, should be ready
      await waitFor(() => {
        expect(result.current.modelStatus).toBe('ready');
      });
    });

    it('should handle model downloading status', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      act(() => {
        mockWorkerInstance.respond({ type: 'MODEL_STATUS', payload: 'downloading' });
      });

      await waitFor(() => {
        expect(result.current.modelStatus).toBe('downloading');
      });
    });

    it('should track download progress', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      act(() => {
        mockWorkerInstance.respond({
          type: 'MODEL_DOWNLOAD_PROGRESS',
          payload: { status: 'progress', progress: 50, loaded: 16500000, total: 33000000 },
        });
      });

      await waitFor(() => {
        expect(result.current.downloadProgress).toBeDefined();
        expect(result.current.downloadProgress.progress).toBe(50);
      });
    });
  });

  describe('Embedding stats', () => {
    it('should receive stats updates from worker', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      act(() => {
        mockWorkerInstance.respond({
          type: 'STATS_UPDATE',
          payload: { pending: 3, failed: 1, completed: 10 },
        });
      });

      await waitFor(() => {
        expect(result.current.embeddingStats.pending).toBe(3);
        expect(result.current.embeddingStats.failed).toBe(1);
        expect(result.current.embeddingStats.completed).toBe(10);
      });
    });

    it('should initialize with zero stats', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      expect(result.current.embeddingStats).toEqual({ pending: 0, failed: 0, completed: 0 });
    });
  });

  describe('Index management (offline)', () => {
    it('should expose deleteNoteFromIndex', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      expect(typeof result.current.deleteNoteFromIndex).toBe('function');

      // Should not throw
      act(() => {
        result.current.deleteNoteFromIndex('note1');
      });
    });

    it('should expose rebuildIndex', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      expect(typeof result.current.rebuildIndex).toBe('function');

      act(() => {
        result.current.rebuildIndex();
      });
    });

    it('should expose retryFailedEmbeddings', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      expect(typeof result.current.retryFailedEmbeddings).toBe('function');

      act(() => {
        result.current.retryFailedEmbeddings();
      });
    });

    it('should expose closeWorkerDB', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      expect(typeof result.current.closeWorkerDB).toBe('function');

      act(() => {
        result.current.closeWorkerDB();
      });
    });
  });

  describe('Retry on model error', () => {
    it('should clear lastError and retry on retryDownload', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      // Simulate error
      act(() => {
        mockWorkerInstance.respond({
          type: 'MODEL_STATUS',
          payload: 'error',
          error: 'Failed to load',
        });
      });

      await waitFor(() => {
        expect(result.current.lastError).toBe('Failed to load');
      });

      // Retry
      act(() => {
        result.current.retryDownload();
      });

      // lastError should be cleared
      expect(result.current.lastError).toBeNull();

      // Worker should receive CHECK_MODEL_STATUS and respond with ready
      await vi.advanceTimersByTimeAsync(10);
      await waitFor(() => {
        expect(result.current.modelStatus).toBe('ready');
      });
    });
  });

  describe('Online/Offline transitions', () => {
    it('should update isOnline when going online', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      expect(result.current.isOnline).toBe(false);

      // Simulate going online
      act(() => {
        Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
        window.dispatchEvent(new Event('online'));
      });

      await waitFor(() => {
        expect(result.current.isOnline).toBe(true);
      });
    });

    it('should update isOnline when going offline', async () => {
      // Start online
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });

      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      expect(result.current.isOnline).toBe(true);

      // Go offline
      act(() => {
        Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
        window.dispatchEvent(new Event('offline'));
      });

      await waitFor(() => {
        expect(result.current.isOnline).toBe(false);
      });
    });

    it('should use online search when online', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });

      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      let searchResult: any;
      await act(async () => {
        searchResult = await result.current.search('test query', [], []);
      });

      expect(searchResult.mode).toBe('online');
    });
  });

  describe('Worker error handling', () => {
    it('should handle worker search error by returning empty results', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      await waitFor(() => {
        expect(result.current.modelStatus).toBe('ready');
      });

      // Override worker to return SEARCH_ERROR
      const originalHandleMessage = (mockWorkerInstance as any).handleMessage.bind(mockWorkerInstance);
      (mockWorkerInstance as any).handleMessage = (data: any) => {
        if (data.type === 'SEARCH') {
          mockWorkerInstance.respond({
            type: 'SEARCH_ERROR',
            queryId: data.payload.queryId,
            error: 'Orama search failed',
          });
          return;
        }
        originalHandleMessage(data);
      };

      let searchResult: any;
      await act(async () => {
        searchResult = await result.current.search('error query');
      });

      expect(searchResult.mode).toBe('offline');
      expect(searchResult.result).toEqual([]);
    });

    it('should set model status to error on worker onerror', async () => {
      const { result } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      // Simulate worker error
      act(() => {
        if (mockWorkerInstance.onerror) {
          mockWorkerInstance.onerror({ message: 'Worker crashed' } as ErrorEvent);
        }
      });

      await waitFor(() => {
        expect(result.current.modelStatus).toBe('error');
        expect(result.current.lastError).toBe('Worker crashed');
      });
    });
  });

  describe('Cleanup on unmount', () => {
    it('should terminate worker on unmount', async () => {
      const terminateSpy = vi.spyOn(mockWorkerInstance || MockWorker.prototype, 'terminate');

      const { unmount } = renderHook(() => useAdaptiveSearch());
      await vi.advanceTimersByTimeAsync(10);

      // Get reference to the actual worker instance after hook mounts
      const workerTerminate = vi.spyOn(mockWorkerInstance, 'terminate');

      unmount();

      expect(workerTerminate).toHaveBeenCalled();
    });
  });
});
