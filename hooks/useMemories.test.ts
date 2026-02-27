
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
});
