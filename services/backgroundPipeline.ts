/**
 * Background data pipeline for processing enrichment results.
 * Shared logic callable from foreground polling, background push handlers,
 * and service worker Background Sync events.
 *
 * Pipeline: fetch result -> apply to IndexedDB -> flag for Drive sync
 *
 * This module is intentionally free of React hooks and DOM access so it can
 * run safely in background contexts (push handlers, service workers).
 */

import { fetchPendingEnrichments } from './geminiService';
import { getMemory, saveMemory } from './storageService';
import { applyEnrichmentResult } from '../hooks/useEnrichmentPolling';
import { isMemoryInFlight } from '../types';

export interface PushData {
  type: 'enrichment-complete';
  memoryId?: string;
}

/**
 * Run the background pipeline for a specific completion event.
 * Called by push notification handlers and periodic background checks.
 *
 * This function is safe to call multiple times for the same event --
 * applyEnrichmentResult() checks isPending and skips already-processed memories.
 */
export const runBackgroundPipeline = async (data: PushData): Promise<void> => {
  console.log('[BackgroundPipeline] Processing:', data.type, data.memoryId);

  try {
    switch (data.type) {
      case 'enrichment-complete': {
        if (!data.memoryId) return;
        await processEnrichmentCompletion(data.memoryId);
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
  if (!memory || !isMemoryInFlight(memory)) {
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
 * Check for any pending enrichments across all memories and process them.
 * Used by periodic background checks (WorkManager, BGTask, Periodic Background Sync).
 *
 * Returns the number of enrichments that were successfully processed.
 */
export const recoverAllPendingEnrichments = async (): Promise<number> => {
  // Dynamic import to avoid circular dependency with storageService
  const { getMemories } = await import('./storageService');
  const memories = await getMemories();
  const pending = memories.filter(isMemoryInFlight);

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
