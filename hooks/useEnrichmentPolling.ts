import { useCallback, useEffect, useRef } from 'react';
import { fetchPendingEnrichments } from '../services/geminiService';
import { getMemory, saveMemory } from '../services/storageService';
import { Attachment, isMemoryInFlight, LinkPreview, Memory } from '../types';

/** Poll every 1s during the initial fast-polling tier. */
const FAST_POLL_INTERVAL_MS = 1_000;
/** Poll every 2s after the fast tier expires. */
const SLOW_POLL_INTERVAL_MS = 2_000;
/** Duration of the fast-polling tier (first 15 seconds). */
const FAST_POLL_TIER_MS = 15_000;

/**
 * Applies an enrichment poll result to a single memory.
 * Returns the updated memory if a change was made, or null otherwise.
 *
 * Server is the source of truth: only act on explicit `completed` or
 * `failed` server responses. `processing` and `not_found` mean "keep
 * waiting" — never client-side-timeout an in-flight job into a failure
 * state, since the server may still be working or the Firestore record
 * just hasn't been written yet.
 */
export const applyEnrichmentResult = async (
  memory: Memory,
  result: { status: string; data?: any } | undefined
): Promise<{ updated: Memory; action: 'completed' | 'failed' } | null> => {
  const needsUpdate =
    (result?.status === 'completed' && result.data) ||
    result?.status === 'failed';

  if (!needsUpdate) return null; // Still processing or not_found — keep waiting

  const current = await getMemory(memory.id);
  if (!current || current.isDeleted) return null;

  // Skip if the memory was already enriched (prevents double-processing
  // when the polling loop fires again with a stale memoriesRef).
  if (!isMemoryInFlight(current)) return null;

  if (result?.status === 'completed' && result.data) {
    const allTags = Array.from(new Set([...(current.tags || []), ...(result.data.suggestedTags || [])]));
    const updatedMemory: Memory = {
      ...current,
      enrichment: result.data,
      tags: allTags,
      enrichmentStatus: 'completed',
      isPending: false,
      processingError: false,
      timestamp: Date.now(),
    };

    // Convert link preview images into attachments so they display in the memory card
    const linkPreviews: LinkPreview[] | undefined = result.data.linkPreviews;
    if (linkPreviews?.length) {
      const existingAttachments = current.attachments || [];
      const previewAttachments: Attachment[] = linkPreviews
        .filter((p: LinkPreview) => p.imageData && p.imageMimeType)
        .map((preview: LinkPreview) => ({
          id: `og-${encodeURIComponent(preview.url).substring(0, 80)}`,
          type: 'image' as const,
          mimeType: preview.imageMimeType,
          data: preview.imageData,
          name: preview.title || 'Link Preview',
        }));

      // Deduplicate: skip previews whose ID already exists in attachments
      // or that duplicate another preview in the same batch
      const existingIds = new Set(existingAttachments.map(a => a.id));
      const newPreviews = previewAttachments.reduce<Attachment[]>((acc, a) => {
        if (!existingIds.has(a.id)) {
          existingIds.add(a.id);
          acc.push(a);
        }
        return acc;
      }, []);

      if (newPreviews.length > 0) {
        updatedMemory.attachments = [...existingAttachments, ...newPreviews];
      }
    }

    await saveMemory(updatedMemory);
    return { updated: updatedMemory, action: 'completed' };
  }

  // Server-confirmed failure
  const failedMemory: Memory = {
    ...current,
    enrichmentStatus: 'failed_server',
    isPending: false,
    processingError: true,
  };
  await saveMemory(failedMemory);
  return { updated: failedMemory, action: 'failed' };
};

interface UseEnrichmentPollingOptions {
  memoriesRef: React.RefObject<Memory[]>;
  setMemories: React.Dispatch<React.SetStateAction<Memory[]>>;
  onEnrichmentComplete?: (memory: Memory) => void;
}

/**
 * Manages enrichment polling with tiered intervals.
 * Polls every 1s for the first 15s, then every 2s until timeout.
 * Extracted from useMemories to reduce complexity and eliminate
 * duplicated enrichment result handling logic.
 */
export const useEnrichmentPolling = ({
  memoriesRef,
  setMemories,
  onEnrichmentComplete,
}: UseEnrichmentPollingOptions) => {
  const pollingActiveRef = useRef(false);
  const isMountedRef = useRef(true);

  // Use a ref to avoid stale closures in the polling loop.
  // Without this, if onEnrichmentComplete is recreated (e.g. authStatus
  // changes), the already-running setTimeout chain captures the old callback.
  const onEnrichmentCompleteRef = useRef(onEnrichmentComplete);
  onEnrichmentCompleteRef.current = onEnrichmentComplete;

  useEffect(() => () => {
    isMountedRef.current = false;
    pollingActiveRef.current = false;
  }, []);

  const startPolling = useCallback(() => {
    if (pollingActiveRef.current) return;
    pollingActiveRef.current = true;

    const pollingStartTime = Date.now();

    const poll = async () => {
      if (!pollingActiveRef.current) return;

      const pending = memoriesRef.current.filter(isMemoryInFlight);
      if (pending.length === 0) {
        pollingActiveRef.current = false;
        return;
      }

      try {
        const ids = pending.map(m => m.id);
        const results = await fetchPendingEnrichments(ids);
        if (!isMountedRef.current) return;

        for (const memory of pending) {
          const outcome = await applyEnrichmentResult(memory, results[memory.id]);
          if (!isMountedRef.current) return;
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
      const stillPending = memoriesRef.current.filter(isMemoryInFlight);
      if (stillPending.length > 0 && pollingActiveRef.current) {
        const elapsed = Date.now() - pollingStartTime;
        const nextDelay = elapsed < FAST_POLL_TIER_MS ? FAST_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS;
        setTimeout(poll, nextDelay);
      } else {
        pollingActiveRef.current = false;
      }
    };

    setTimeout(poll, FAST_POLL_INTERVAL_MS);
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
      if (!isMountedRef.current) return;

      for (const memory of pendingMemories) {
        const result = results[memory.id];
        if (result?.status === 'processing') {
          // Still processing — polling will pick it up
          startPolling();
          continue;
        }

        const outcome = await applyEnrichmentResult(memory, result);
        if (!isMountedRef.current) return;
        if (outcome) {
          setMemories(prev => prev.map(m => m.id === memory.id ? outcome.updated : m));
          if (outcome.action === 'completed') {
            onEnrichmentCompleteRef.current?.(outcome.updated);
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
