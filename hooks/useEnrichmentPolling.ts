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
  if (result?.status === 'completed' && result.data) {
    const current = await getMemory(memory.id);
    if (!current || current.isDeleted) return null;

    const allTags = Array.from(new Set([...current.tags, ...result.data.suggestedTags]));
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

  if (result?.status === 'failed') {
    const current = await getMemory(memory.id);
    if (!current || current.isDeleted) return null;

    const failedMemory: Memory = { ...current, isPending: false, processingError: true };
    await saveMemory(failedMemory);
    return { updated: failedMemory, action: 'failed' };
  }

  // Timeout check — mark as failed if waiting too long
  if (!result || result.status === 'not_found') {
    if (Date.now() - memory.timestamp > ENRICHMENT_TIMEOUT_MS) {
      const current = await getMemory(memory.id);
      if (!current || current.isDeleted) return null;

      const failedMemory: Memory = { ...current, isPending: false, processingError: true };
      await saveMemory(failedMemory);
      return { updated: failedMemory, action: 'failed' };
    }
  }

  return null; // Still processing, no change
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
              onEnrichmentComplete?.(outcome.updated);
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
  }, [memoriesRef, setMemories, onEnrichmentComplete]);

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
  }, [setMemories, startPolling, onEnrichmentComplete]);

  return {
    startPolling,
    recoverPending,
    isPolling: pollingActiveRef,
  };
};
