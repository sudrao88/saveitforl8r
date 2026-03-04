import { useCallback, useRef } from 'react';
import { fetchPendingEnrichments } from '../services/geminiService';
import { getMemory, saveMemory } from '../services/storageService';
import { Memory } from '../types';

const ENRICHMENT_TIMEOUT_MS = 120_000;

/**
 * Applies an enrichment poll result to a single memory.
 * Returns the updated memory if a change was made, or null otherwise.
 *
 * This centralizes the "completed/failed/timeout" logic that was previously
 * duplicated across initial recovery, online recovery, and periodic polling.
 */
export const applyEnrichmentResult = async (
  memory: Memory,
  result: { status: string; data?: any } | undefined
): Promise<{ updated: Memory; action: 'completed' | 'failed' } | null> => {
  const needsUpdate =
    (result?.status === 'completed' && result.data) ||
    result?.status === 'failed' ||
    ((!result || result.status === 'not_found') && Date.now() - memory.timestamp > ENRICHMENT_TIMEOUT_MS);

  if (!needsUpdate) return null; // Still processing, no change

  const current = await getMemory(memory.id);
  if (!current || current.isDeleted) return null;

  if (result?.status === 'completed' && result.data) {
    const allTags = Array.from(new Set([...(current.tags || []), ...(result.data.suggestedTags || [])]));
    const updatedMemory: Memory = {
      ...current,
      enrichment: result.data,
      tags: allTags,
      isPending: false,
      processingError: false,
      timestamp: Date.now(),
    };
    await saveMemory(updatedMemory);
    return { updated: updatedMemory, action: 'completed' };
  }

  // Failed or timed out
  const failedMemory: Memory = { ...current, isPending: false, processingError: true };
  await saveMemory(failedMemory);
  return { updated: failedMemory, action: 'failed' };
};

interface UseEnrichmentPollingOptions {
  memoriesRef: React.RefObject<Memory[]>;
  setMemories: React.Dispatch<React.SetStateAction<Memory[]>>;
  onEnrichmentComplete?: (memory: Memory) => void;
}

/**
 * Manages enrichment polling with Fibonacci backoff.
 * Extracted from useMemories to reduce complexity and eliminate
 * duplicated enrichment result handling logic.
 */
export const useEnrichmentPolling = ({
  memoriesRef,
  setMemories,
  onEnrichmentComplete,
}: UseEnrichmentPollingOptions) => {
  const pollingActiveRef = useRef(false);

  // Use a ref to avoid stale closures in the polling loop.
  // Without this, if onEnrichmentComplete is recreated (e.g. authStatus
  // changes), the already-running setTimeout chain captures the old callback.
  const onEnrichmentCompleteRef = useRef(onEnrichmentComplete);
  onEnrichmentCompleteRef.current = onEnrichmentComplete;

  const startPolling = useCallback(() => {
    if (pollingActiveRef.current) return;
    pollingActiveRef.current = true;

    let prevDelay = 1_000;
    let currDelay = 2_000;

    const poll = async () => {
      if (!pollingActiveRef.current) return;

      const pending = memoriesRef.current.filter(m => m.isPending && !m.isSample);
      if (pending.length === 0) {
        pollingActiveRef.current = false;
        return;
      }

      try {
        const ids = pending.map(m => m.id);
        const results = await fetchPendingEnrichments(ids);

        for (const memory of pending) {
          const outcome = await applyEnrichmentResult(memory, results[memory.id]);
          if (outcome) {
            setMemories(prev => prev.map(m => m.id === memory.id ? outcome.updated : m));
            if (outcome.action === 'completed') {
              onEnrichmentCompleteRef.current?.(outcome.updated);
            }
          }
        }
      } catch (err) {
        console.error('[Poll] Failed to poll for enrichment results:', err);
      }

      // Re-check pending after processing
      const stillPending = memoriesRef.current.filter(m => m.isPending && !m.isSample);
      if (stillPending.length > 0 && pollingActiveRef.current) {
        const nextDelay = prevDelay + currDelay;
        prevDelay = currDelay;
        currDelay = nextDelay;
        setTimeout(poll, nextDelay);
      } else {
        pollingActiveRef.current = false;
      }
    };

    setTimeout(poll, 2_000);
  }, [memoriesRef, setMemories]);

  /**
   * Recovers enrichment results for pending memories.
   * Used on initial load and when coming back online.
   */
  const recoverPending = useCallback(async (pendingMemories: Memory[]) => {
    if (pendingMemories.length === 0) return;

    try {
      const ids = pendingMemories.map(m => m.id);
      const results = await fetchPendingEnrichments(ids);

      for (const memory of pendingMemories) {
        const result = results[memory.id];
        if (result?.status === 'processing') {
          // Still processing — polling will pick it up
          startPolling();
          continue;
        }

        const outcome = await applyEnrichmentResult(memory, result);
        if (outcome) {
          setMemories(prev => prev.map(m => m.id === memory.id ? outcome.updated : m));
          if (outcome.action === 'completed') {
            onEnrichmentComplete?.(outcome.updated);
          }
        }
      }
    } catch (err) {
      console.error('[Recovery] Enrichment recovery failed:', err);
    }
  }, [setMemories, startPolling]);

  return {
    startPolling,
    recoverPending,
    isPolling: pollingActiveRef,
  };
};
