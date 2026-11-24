import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyEnrichmentResult, isStaleResult } from './useEnrichmentPolling';
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

describe('stale results after an edit or retry', () => {
  const edited: Memory = {
    id: 'mem-2', content: 'Fine print coffee hong kong', timestamp: Date.now(), tags: [],
    enrichmentStatus: 'submitting', isPending: true, enrichmentRequestId: 'req-new',
  };
  const oldResult = { status: 'completed', data: { summary: 'old', suggestedTags: [] } };

  beforeEach(() => {
    vi.clearAllMocks();
    (storageService.getMemory as any).mockResolvedValue(edited);
    (storageService.saveMemory as any).mockResolvedValue(undefined);
  });

  it('ignores a result from an earlier submission', async () => {
    expect(await applyEnrichmentResult(edited, { ...oldResult, requestId: 'req-old' })).toBeNull();
    expect(storageService.saveMemory).not.toHaveBeenCalled();
  });

  it('applies the result for the current submission', async () => {
    const outcome = await applyEnrichmentResult(edited, { status: 'completed', data: { summary: 'new', suggestedTags: [] }, requestId: 'req-new' });
    expect(outcome?.updated.enrichment?.summary).toBe('new');
  });

  it('ignores an old result with no requestId until the server accepts the new submission', async () => {
    expect(await applyEnrichmentResult(edited, oldResult)).toBeNull();
    const accepted = { ...edited, enrichmentStatus: 'processing' as const };
    (storageService.getMemory as any).mockResolvedValue(accepted);
    expect((await applyEnrichmentResult(accepted, oldResult))?.action).toBe('completed');
  });

  it('ignores a failure from an earlier submission', async () => {
    expect(await applyEnrichmentResult(edited, { status: 'failed', requestId: 'req-old' })).toBeNull();
  });

  it('isStaleResult accepts anything for memories without a requestId', () => {
    expect(isStaleResult({ enrichmentStatus: 'submitting' }, { requestId: 'x' })).toBe(false);
    expect(isStaleResult({ enrichmentStatus: 'submitting' }, undefined)).toBe(false);
  });
});
