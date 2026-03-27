/**
 * Background data pipeline for processing enrichment/moment/synthesis results.
 * Shared logic callable from foreground polling, background push handlers,
 * and service worker Background Sync events.
 *
 * Pipeline: fetch result -> apply to IndexedDB -> flag for Drive sync
 *
 * This module is intentionally free of React hooks and DOM access so it can
 * run safely in background contexts (push handlers, service workers).
 */

import { fetchPendingEnrichments, fetchPendingMomentResults, fetchPendingSynthesisResults } from './geminiService';
import { getMemory, saveMemory } from './storageService';
import { applyEnrichmentResult } from '../hooks/useEnrichmentPolling';

export interface PushData {
  type: 'enrichment-complete' | 'moment-complete' | 'synthesis-complete';
  memoryId?: string;
  momentId?: string;
}

/**
 * Run the background pipeline for a specific completion event.
 * Called by push notification handlers and periodic background checks.
 *
 * This function is safe to call multiple times for the same event --
 * applyEnrichmentResult() checks isPending and skips already-processed memories.
 */
export const runBackgroundPipeline = async (data: PushData): Promise<void> => {
  console.log('[BackgroundPipeline] Processing:', data.type, data.memoryId || data.momentId);

  try {
    switch (data.type) {
      case 'enrichment-complete': {
        if (!data.memoryId) return;
        await processEnrichmentCompletion(data.memoryId);
        break;
      }
      case 'moment-complete': {
        if (!data.momentId) return;
        await processMomentCompletion(data.momentId);
        break;
      }
      case 'synthesis-complete': {
        if (!data.momentId) return;
        await processSynthesisCompletion(data.momentId);
        break;
      }
    }
  } catch (err) {
    console.error('[BackgroundPipeline] Error:', err);
  }
};

/**
 * Fetch and apply an enrichment result for a specific memory.
 */
async function processEnrichmentCompletion(memoryId: string): Promise<void> {
  const memory = await getMemory(memoryId);
  if (!memory || !memory.isPending) {
    // Already processed or deleted
    return;
  }

  const results = await fetchPendingEnrichments([memoryId]);
  const result = results[memoryId];

  if (!result || result.status === 'processing') {
    // Not ready yet -- foreground polling or next background cycle will pick it up
    return;
  }

  const outcome = await applyEnrichmentResult(memory, result);
  if (outcome) {
    console.log(`[BackgroundPipeline] Enrichment ${outcome.action} for ${memoryId}`);
    // The modified memory is now in IndexedDB.
    // SyncContext will pick it up on next sync cycle (visibility change, periodic, etc.)
    // We don't trigger Drive sync directly from here to avoid circular dependencies.
  }
}

/**
 * Fetch and apply a moment creation result.
 * Moment results require complex state updates (creating/updating Moment objects),
 * so we flag them for processing by the foreground moments hook.
 */
async function processMomentCompletion(momentId: string): Promise<void> {
  const results = await fetchPendingMomentResults([momentId]);
  const result = results[momentId];

  if (!result || result.status === 'processing') return;

  if (result.status === 'completed' && result.data) {
    // Store a flag in localStorage so the app processes it on next foreground
    try {
      const pending = JSON.parse(localStorage.getItem('bg_pending_moments') || '[]') as string[];
      if (!pending.includes(momentId)) {
        pending.push(momentId);
        localStorage.setItem('bg_pending_moments', JSON.stringify(pending));
      }
    } catch {
      // Best-effort -- localStorage may be unavailable in some contexts
    }
    console.log(`[BackgroundPipeline] Moment ${momentId} completed, flagged for foreground processing`);
  }
}

/**
 * Fetch and apply a synthesis result.
 * Like moments, synthesis results need complex state updates,
 * so we flag them for foreground processing.
 */
async function processSynthesisCompletion(momentId: string): Promise<void> {
  const results = await fetchPendingSynthesisResults([momentId]);
  const result = results[momentId];

  if (!result || result.status === 'processing') return;

  if (result.status === 'completed' && result.data) {
    try {
      const pending = JSON.parse(localStorage.getItem('bg_pending_syntheses') || '[]') as string[];
      if (!pending.includes(momentId)) {
        pending.push(momentId);
        localStorage.setItem('bg_pending_syntheses', JSON.stringify(pending));
      }
    } catch {
      // Best-effort
    }
    console.log(`[BackgroundPipeline] Synthesis ${momentId} completed, flagged for foreground processing`);
  }
}

/**
 * Check for any pending enrichments across all memories and process them.
 * Used by periodic background checks (WorkManager, BGTask, Periodic Background Sync).
 *
 * Returns the number of enrichments that were successfully processed.
 */
export const recoverAllPendingEnrichments = async (): Promise<number> => {
  // Dynamic import to avoid circular dependency with storageService
  const { getMemories } = await import('./storageService');
  const memories = await getMemories();
  const pending = memories.filter(m => m.isPending);

  if (pending.length === 0) return 0;

  let processed = 0;
  const ids = pending.map(m => m.id);
  const results = await fetchPendingEnrichments(ids);

  for (const memory of pending) {
    const result = results[memory.id];
    if (result && result.status !== 'processing') {
      const outcome = await applyEnrichmentResult(memory, result);
      if (outcome) processed++;
    }
  }

  console.log(`[BackgroundPipeline] Recovered ${processed}/${pending.length} pending enrichments`);
  return processed;
};
