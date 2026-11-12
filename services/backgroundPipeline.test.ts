import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBackgroundPipeline, recoverAllPendingEnrichments } from './backgroundPipeline';
import { fetchPendingEnrichments } from './geminiService';
import { getMemory, saveMemory, getMemories } from './storageService';
import { applyEnrichmentResult } from '../hooks/useEnrichmentPolling';

vi.mock('./geminiService', () => ({
  fetchPendingEnrichments: vi.fn(),
}));

vi.mock('./storageService', () => ({
  getMemory: vi.fn(),
  saveMemory: vi.fn(),
  getMemories: vi.fn(),
}));

vi.mock('../hooks/useEnrichmentPolling', () => ({
  applyEnrichmentResult: vi.fn(),
}));

const mockMemory = {
  id: 'mem-1',
  content: 'test content',
  tags: [],
  timestamp: Date.now(),
  isPending: true,
  attachments: [],
};

describe('backgroundPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('runBackgroundPipeline', () => {
    describe('enrichment-complete', () => {
      it('should fetch result and apply to memory via applyEnrichmentResult', async () => {
        const enrichmentResult = { status: 'completed' as const, data: { summary: 'test', suggestedTags: ['tag1'] } };
        vi.mocked(getMemory).mockResolvedValue({ ...mockMemory });
        vi.mocked(fetchPendingEnrichments).mockResolvedValue({
          'mem-1': enrichmentResult,
        });
        vi.mocked(applyEnrichmentResult).mockResolvedValue({
          updated: { ...mockMemory, isPending: false },
          action: 'completed',
        });

        await runBackgroundPipeline({ type: 'enrichment-complete', memoryId: 'mem-1' });

        expect(getMemory).toHaveBeenCalledWith('mem-1');
        expect(fetchPendingEnrichments).toHaveBeenCalledWith(['mem-1']);
        expect(applyEnrichmentResult).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'mem-1' }),
          enrichmentResult,
        );
      });

      it('should skip if memory not found', async () => {
        vi.mocked(getMemory).mockResolvedValue(undefined as any);

        await runBackgroundPipeline({ type: 'enrichment-complete', memoryId: 'mem-1' });

        expect(fetchPendingEnrichments).not.toHaveBeenCalled();
        expect(applyEnrichmentResult).not.toHaveBeenCalled();
      });

      it('should skip if memory is not pending', async () => {
        vi.mocked(getMemory).mockResolvedValue({ ...mockMemory, isPending: false });

        await runBackgroundPipeline({ type: 'enrichment-complete', memoryId: 'mem-1' });

        expect(fetchPendingEnrichments).not.toHaveBeenCalled();
        expect(applyEnrichmentResult).not.toHaveBeenCalled();
      });

      it('should skip if result is still processing', async () => {
        vi.mocked(getMemory).mockResolvedValue({ ...mockMemory });
        vi.mocked(fetchPendingEnrichments).mockResolvedValue({
          'mem-1': { status: 'processing' },
        });

        await runBackgroundPipeline({ type: 'enrichment-complete', memoryId: 'mem-1' });

        expect(applyEnrichmentResult).not.toHaveBeenCalled();
      });

      it('should no-op if memoryId is missing', async () => {
        await runBackgroundPipeline({ type: 'enrichment-complete' });

        expect(getMemory).not.toHaveBeenCalled();
        expect(fetchPendingEnrichments).not.toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should catch and log errors without throwing', async () => {
        vi.mocked(getMemory).mockRejectedValue(new Error('DB error'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Should not throw
        await runBackgroundPipeline({ type: 'enrichment-complete', memoryId: 'mem-1' });

        expect(consoleSpy).toHaveBeenCalledWith(
          '[BackgroundPipeline] Error:',
          expect.any(Error),
        );
        consoleSpy.mockRestore();
      });
    });
  });

  describe('recoverAllPendingEnrichments', () => {
    it('should return 0 when no pending memories', async () => {
      vi.mocked(getMemories).mockResolvedValue([]);

      const result = await recoverAllPendingEnrichments();

      expect(result).toBe(0);
      expect(fetchPendingEnrichments).not.toHaveBeenCalled();
    });

    it('should process completed enrichments and return count', async () => {
      const pendingMemories = [
        { ...mockMemory, id: 'mem-1' },
        { ...mockMemory, id: 'mem-2' },
      ];
      vi.mocked(getMemories).mockResolvedValue(pendingMemories);
      vi.mocked(fetchPendingEnrichments).mockResolvedValue({
        'mem-1': { status: 'completed' as const, data: { summary: 'test1', suggestedTags: ['tag1'] } },
        'mem-2': { status: 'completed' as const, data: { summary: 'test2', suggestedTags: ['tag2'] } },
      });
      vi.mocked(applyEnrichmentResult).mockResolvedValue({
        updated: { ...mockMemory, isPending: false },
        action: 'completed',
      });

      const result = await recoverAllPendingEnrichments();

      expect(result).toBe(2);
      expect(fetchPendingEnrichments).toHaveBeenCalledWith(['mem-1', 'mem-2']);
      expect(applyEnrichmentResult).toHaveBeenCalledTimes(2);
    });

    it('should skip still-processing enrichments', async () => {
      vi.mocked(getMemories).mockResolvedValue([{ ...mockMemory, id: 'mem-1' }]);
      vi.mocked(fetchPendingEnrichments).mockResolvedValue({
        'mem-1': { status: 'processing' },
      });

      const result = await recoverAllPendingEnrichments();

      expect(result).toBe(0);
      expect(applyEnrichmentResult).not.toHaveBeenCalled();
    });

    it('should handle mixed results (some completed, some processing)', async () => {
      const pendingMemories = [
        { ...mockMemory, id: 'mem-1' },
        { ...mockMemory, id: 'mem-2' },
        { ...mockMemory, id: 'mem-3' },
      ];
      vi.mocked(getMemories).mockResolvedValue(pendingMemories);
      vi.mocked(fetchPendingEnrichments).mockResolvedValue({
        'mem-1': { status: 'completed' as const, data: { summary: 'test1', suggestedTags: ['tag1'] } },
        'mem-2': { status: 'processing' },
        'mem-3': { status: 'completed' as const, data: { summary: 'test3', suggestedTags: ['tag3'] } },
      });
      vi.mocked(applyEnrichmentResult)
        .mockResolvedValueOnce({
          updated: { ...mockMemory, id: 'mem-1', isPending: false },
          action: 'completed',
        })
        .mockResolvedValueOnce({
          updated: { ...mockMemory, id: 'mem-3', isPending: false },
          action: 'completed',
        });

      const result = await recoverAllPendingEnrichments();

      expect(result).toBe(2);
      expect(applyEnrichmentResult).toHaveBeenCalledTimes(2);
    });
  });
});
