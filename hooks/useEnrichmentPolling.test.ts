import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyEnrichmentResult } from './useEnrichmentPolling';
import * as storageService from '../services/storageService';
import { Memory } from '../types';

vi.mock('../services/storageService');

describe('applyEnrichmentResult', () => {
  const baseMemory: Memory = {
    id: 'mem-1',
    content: 'note',
    timestamp: Date.now() - 5 * 60_000, // 5 minutes ago — well past the old 120s client timeout
    tags: [],
    enrichmentStatus: 'processing',
    isPending: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (storageService.getMemory as any).mockResolvedValue(baseMemory);
    (storageService.saveMemory as any).mockResolvedValue(undefined);
  });

  it('does not flip a stale processing memory to failed when server returns not_found', async () => {
    const outcome = await applyEnrichmentResult(baseMemory, { status: 'not_found' });
    expect(outcome).toBeNull();
    expect(storageService.saveMemory).not.toHaveBeenCalled();
  });

  it('does not flip a stale processing memory to failed on undefined result', async () => {
    const outcome = await applyEnrichmentResult(baseMemory, undefined);
    expect(outcome).toBeNull();
    expect(storageService.saveMemory).not.toHaveBeenCalled();
  });

  it('does not flip when server still says processing', async () => {
    const outcome = await applyEnrichmentResult(baseMemory, { status: 'processing' });
    expect(outcome).toBeNull();
    expect(storageService.saveMemory).not.toHaveBeenCalled();
  });

  it('marks failed_server only when server explicitly says failed', async () => {
    const outcome = await applyEnrichmentResult(baseMemory, { status: 'failed' });
    expect(outcome?.action).toBe('failed');
    expect(outcome?.updated.enrichmentStatus).toBe('failed_server');
    expect(outcome?.updated.processingError).toBe(true);
  });

  it('marks completed when server returns completed with data', async () => {
    const outcome = await applyEnrichmentResult(baseMemory, {
      status: 'completed',
      data: { summary: 'enriched', suggestedTags: ['x'] },
    });
    expect(outcome?.action).toBe('completed');
    expect(outcome?.updated.enrichmentStatus).toBe('completed');
    expect(outcome?.updated.enrichment).toEqual({ summary: 'enriched', suggestedTags: ['x'] });
  });

  it('skips already-completed memories', async () => {
    (storageService.getMemory as any).mockResolvedValue({
      ...baseMemory,
      enrichmentStatus: 'completed',
      isPending: false,
    });
    const outcome = await applyEnrichmentResult(baseMemory, { status: 'failed' });
    expect(outcome).toBeNull();
  });
});
