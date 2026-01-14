
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMemories } from './useMemories';
import * as storageService from '../services/storageService';
import * as geminiService from '../services/geminiService';

// Mock the services
vi.mock('../services/storageService');
vi.mock('../services/geminiService');

describe('useMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
        expect(result.current.memories).toEqual(mockMemories);
    });

    await act(async () => {
        await result.current.handleDelete('1');
    });

    expect(storageService.deleteMemory).toHaveBeenCalledWith('1');
    expect(result.current.memories).toEqual([]);
  });

  it('should handle retry memory', async () => {
    const mockMemories = [{ id: '1', content: 'test', timestamp: 123, tags: [], isPending: true }];
    // We need to return valid object for test to pass
    const mockEnrichment = { suggestedTags: ['new'], locationIsRelevant: false };

    (storageService.getMemories as any).mockResolvedValue(mockMemories);
    (geminiService.enrichInput as any).mockResolvedValue(mockEnrichment);
    (storageService.saveMemory as any).mockResolvedValue(undefined);

    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
        expect(result.current.memories).toEqual(mockMemories);
    });

    await act(async () => {
        await result.current.handleRetry('1');
    });

    expect(geminiService.enrichInput).toHaveBeenCalled();
    expect(storageService.saveMemory).toHaveBeenCalled();
    
    const updatedMemory = result.current.memories.find(m => m.id === '1');
    expect(updatedMemory?.isPending).toBe(false);
    expect(updatedMemory?.tags).toContain('new');
  });
});
