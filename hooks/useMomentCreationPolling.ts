/**
 * useMomentCreationPolling.ts
 *
 * Manages polling for async moment creation results.
 * Mirrors the enrichment polling pattern (useEnrichmentPolling.ts)
 * with tiered polling intervals (1s for first 15s, then 2s).
 */

import { useCallback, useEffect, useRef } from 'react';
import { fetchPendingMomentResults, fetchPendingSynthesisResults, CreateMomentResponse } from '../services/geminiService';
import { Moment, Memory, MomentSynthesis, MomentType, SynthesisResponse } from '../types';
import { saveMoment, saveMomentSynthesis } from '../services/storageService';
import { computeInputHash } from '../utils/hash';

const MOMENT_CREATION_TIMEOUT_MS = 180_000; // 3 minutes (3-step pipeline)
/** Drop the pending-synthesis marker if older than this — server doc would have expired anyway. */
const PENDING_SYNTHESIS_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h, matches server's SYNTHESIS_FAILED_TTL_MS
/** Server caps synthesis-results requests at 10 momentIds per call. */
const SYNTHESIS_RESULTS_BATCH_SIZE = 10;

/** Poll every 1s during the initial fast-polling tier. */
const FAST_POLL_INTERVAL_MS = 1_000;
/** Poll every 2s after the fast tier expires. */
const SLOW_POLL_INTERVAL_MS = 2_000;
/** Duration of the fast-polling tier (first 15 seconds). */
const FAST_POLL_TIER_MS = 15_000;

interface UseMomentCreationPollingOptions {
  momentsRef: React.RefObject<Moment[]>;
  memoriesRef: React.RefObject<Memory[]>;
  setMoments: React.Dispatch<React.SetStateAction<Moment[]>>;
  setSynthesesMap: React.Dispatch<React.SetStateAction<Map<string, MomentSynthesis>>>;
  onMomentCreated?: (moment: Moment) => void;
  /**
   * Called when a moment's synthesis is hydrated by the recovery flow. Lets the
   * caller (useMoments) trigger a Drive sync so the freshly-cached synthesis
   * propagates to other devices.
   */
  onMomentResynthesisRecovered?: (moment: Moment) => void;
}

/**
 * Filters synthesis sections/items to only reference notes still in the moment.
 * Mirrors the same guard in useMoments.ts so recovery handles the case where
 * notes were removed locally between submit and recovery.
 */
const filterSynthesisToMoment = (
  raw: SynthesisResponse,
  noteIdSet: Set<string>,
): SynthesisResponse => ({
  ...raw,
  sections: raw.sections
    .map(section => ({
      ...section,
      items: section.items.filter(item => noteIdSet.has(item.sourceNoteId)),
    }))
    .filter(section => section.items.length > 0),
  generatedFrom: raw.generatedFrom.filter(id => noteIdSet.has(id)),
});

/**
 * Applies a moment creation poll result to a pending moment.
 * Returns the updated moment if a change was made, or null otherwise.
 */
const applyMomentResult = async (
  pendingMoment: Moment,
  result: { status: string; data?: CreateMomentResponse } | undefined,
  memoriesRef: React.RefObject<Memory[]>,
  setSynthesesMap: React.Dispatch<React.SetStateAction<Map<string, MomentSynthesis>>>,
): Promise<{ updated: Moment; action: 'completed' | 'failed' } | null> => {
  // Completed
  if (result?.status === 'completed' && result.data) {
    const data = result.data;
    // Merge server-selected noteIds with any noteIds added by enrichment
    // matching while the moment was still pending (race condition fix).
    const mergedNoteIds = Array.from(new Set([
      ...(data.usedNoteIds || []),
      ...pendingMoment.noteIds,
    ]));

    const updatedMoment: Moment = {
      ...pendingMoment,
      title: data.title || pendingMoment.title,
      type: (data.type || 'general') as MomentType,
      emoji: data.emoji || undefined,
      refinedObjective: data.refinedObjective || undefined,
      noteIds: mergedNoteIds,
      isPending: false,
      processingError: false,
      updatedAt: Date.now(),
      lastSynthesizedAt: Date.now(),
    };

    updatedMoment.inputHash = computeInputHash(
      updatedMoment.noteIds,
      memoriesRef.current || []
    );
    updatedMoment.lastSeenInputHash = updatedMoment.inputHash;

    await saveMoment(updatedMoment);

    // Save synthesis
    if (data.synthesis) {
      const stored: MomentSynthesis = {
        momentId: updatedMoment.id,
        inputHash: updatedMoment.inputHash,
        content: data.synthesis,
        generatedAt: Date.now(),
        noteIds: updatedMoment.noteIds,
      };
      await saveMomentSynthesis(stored);
      setSynthesesMap(prev => {
        const next = new Map(prev);
        next.set(updatedMoment.id, stored);
        return next;
      });
    }

    return { updated: updatedMoment, action: 'completed' };
  }

  // Failed
  if (result?.status === 'failed') {
    const failedMoment: Moment = {
      ...pendingMoment,
      isPending: false,
      processingError: true,
    };
    await saveMoment(failedMoment);
    return { updated: failedMoment, action: 'failed' };
  }

  // Timed out (not_found or still processing beyond timeout)
  if (
    (!result || result.status === 'not_found') &&
    Date.now() - pendingMoment.createdAt > MOMENT_CREATION_TIMEOUT_MS
  ) {
    const timedOut: Moment = {
      ...pendingMoment,
      isPending: false,
      processingError: true,
    };
    await saveMoment(timedOut);
    return { updated: timedOut, action: 'failed' };
  }

  return null; // Still processing
};

export const useMomentCreationPolling = ({
  momentsRef,
  memoriesRef,
  setMoments,
  setSynthesesMap,
  onMomentCreated,
  onMomentResynthesisRecovered,
}: UseMomentCreationPollingOptions) => {
  const pollingActiveRef = useRef(false);
  const isMountedRef = useRef(true);

  // Use refs to avoid stale closures in the polling loop. Without this, if
  // onMomentCreated is recreated, the already-running setTimeout chain
  // captures the old callback.
  const onMomentCreatedRef = useRef(onMomentCreated);
  const onMomentResynthesisRecoveredRef = useRef(onMomentResynthesisRecovered);
  useEffect(() => {
    onMomentCreatedRef.current = onMomentCreated;
    onMomentResynthesisRecoveredRef.current = onMomentResynthesisRecovered;
  }, [onMomentCreated, onMomentResynthesisRecovered]);

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

      const pending = momentsRef.current.filter(m => m.isPending);
      if (pending.length === 0) {
        pollingActiveRef.current = false;
        return;
      }

      try {
        const ids = pending.map(m => m.id);
        const results = await fetchPendingMomentResults(ids);
        if (!isMountedRef.current) return;

        for (const moment of pending) {
          const outcome = await applyMomentResult(
            moment, results[moment.id], memoriesRef, setSynthesesMap
          );
          if (!isMountedRef.current) return;
          if (outcome) {
            setMoments(prev => prev.map(m => m.id === moment.id ? outcome.updated : m));
            if (outcome.action === 'completed') {
              onMomentCreatedRef.current?.(outcome.updated);
            }
          }
        }
      } catch (err) {
        console.error('[MomentPoll] Failed:', err);
      }

      // Re-check pending after processing
      const stillPending = momentsRef.current.filter(m => m.isPending);
      if (stillPending.length > 0 && pollingActiveRef.current) {
        const elapsed = Date.now() - pollingStartTime;
        const nextDelay = elapsed < FAST_POLL_TIER_MS ? FAST_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS;
        setTimeout(poll, nextDelay);
      } else {
        pollingActiveRef.current = false;
      }
    };

    setTimeout(poll, FAST_POLL_INTERVAL_MS);
  }, [momentsRef, memoriesRef, setMoments, setSynthesesMap]);

  const recoverPending = useCallback(async (pendingMoments: Moment[]) => {
    if (pendingMoments.length === 0) return;
    try {
      const ids = pendingMoments.map(m => m.id);
      const results = await fetchPendingMomentResults(ids);
      if (!isMountedRef.current) return;

      for (const moment of pendingMoments) {
        const result = results[moment.id];
        if (result?.status === 'processing') {
          startPolling();
          continue;
        }

        const outcome = await applyMomentResult(
          moment, result, memoriesRef, setSynthesesMap
        );
        if (!isMountedRef.current) return;
        if (outcome) {
          setMoments(prev => prev.map(m => m.id === moment.id ? outcome.updated : m));
          if (outcome.action === 'completed') {
            onMomentCreatedRef.current?.(outcome.updated);
          }
        }
      }
    } catch (err) {
      console.error('[MomentRecovery] Failed:', err);
    }
  }, [memoriesRef, setMoments, setSynthesesMap, startPolling]);

  /**
   * Reconciles user-triggered resynthesis requests that were interrupted in a
   * previous session. Walks moments with a `pendingSynthesisHash` marker and
   * batches them through /api/synthesize/results — hydrating any completed
   * (and still-fresh) result without a fresh Gemini call.
   */
  const recoverPendingResynthesis = useCallback(async (moments: Moment[]) => {
    const now = Date.now();
    const candidates: Moment[] = [];
    const stale: Moment[] = [];

    for (const m of moments) {
      if (m.isPending) continue; // creation flow handles these
      if (!m.pendingSynthesisHash) continue;
      if (m.pendingSynthesisAt && now - m.pendingSynthesisAt > PENDING_SYNTHESIS_MAX_AGE_MS) {
        stale.push(m);
        continue;
      }
      candidates.push(m);
    }

    // Drop expired markers without a network call.
    if (stale.length > 0) {
      for (const m of stale) {
        const cleared: Moment = {
          ...m,
          pendingSynthesisHash: undefined,
          pendingSynthesisAt: undefined,
          updatedAt: now,
        };
        try {
          await saveMoment(cleared);
        } catch (err) {
          console.error('[MomentResyncRecovery] Failed to clear stale marker:', err);
        }
        if (!isMountedRef.current) return;
        setMoments(prev => prev.map(x => x.id === m.id ? cleared : x));
      }
    }

    if (candidates.length === 0) return;

    try {
      const resultsByMomentId: Record<string, Awaited<ReturnType<typeof fetchPendingSynthesisResults>>[string]> = {};
      for (let i = 0; i < candidates.length; i += SYNTHESIS_RESULTS_BATCH_SIZE) {
        const batchIds = candidates.slice(i, i + SYNTHESIS_RESULTS_BATCH_SIZE).map(m => m.id);
        const batch = await fetchPendingSynthesisResults(batchIds);
        if (!isMountedRef.current) return;
        Object.assign(resultsByMomentId, batch);
      }

      for (const moment of candidates) {
        const result = resultsByMomentId[moment.id];

        // Server still working — leave the marker. loadSynthesis will reuse
        // the in-flight server request on next sheet open.
        if (result?.status === 'processing') continue;

        const clearMarker = async () => {
          const cleared: Moment = {
            ...moment,
            pendingSynthesisHash: undefined,
            pendingSynthesisAt: undefined,
            updatedAt: Date.now(),
          };
          await saveMoment(cleared);
          if (!isMountedRef.current) return;
          setMoments(prev => prev.map(x => x.id === moment.id ? cleared : x));
        };

        if (!result || result.status === 'not_found' || result.status === 'failed') {
          await clearMarker();
          continue;
        }

        if (result.status === 'completed' && 'data' in result) {
          // Validate the server's hash matches the hash we sent at submit time
          // AND still matches the current local note set (notes may have been
          // added/removed locally while the app was closed).
          const currentHash = computeInputHash(moment.noteIds, memoriesRef.current || []);
          const serverHashOk = result.inputHash === moment.pendingSynthesisHash;
          const localStillMatches = result.inputHash === currentHash;

          if (!serverHashOk || !localStillMatches) {
            await clearMarker();
            continue;
          }

          const noteIdSet = new Set(moment.noteIds);
          const synthesis = filterSynthesisToMoment(result.data, noteIdSet);
          const stored: MomentSynthesis = {
            momentId: moment.id,
            inputHash: currentHash,
            content: synthesis,
            generatedAt: Date.now(),
            noteIds: moment.noteIds,
          };

          const updatedMoment: Moment = {
            ...moment,
            inputHash: currentHash,
            // Leave lastSeenInputHash untouched so the bubble retains its
            // "unseen" indicator until the user actually opens the sheet.
            lastSynthesizedAt: Date.now(),
            updatedAt: Date.now(),
            processingError: false,
            pendingSynthesisHash: undefined,
            pendingSynthesisAt: undefined,
          };

          try {
            await saveMoment(updatedMoment);
            await saveMomentSynthesis(stored);
          } catch (err) {
            console.error('[MomentResyncRecovery] Persist failed:', err);
            continue;
          }
          if (!isMountedRef.current) return;

          setMoments(prev => prev.map(x => x.id === moment.id ? updatedMoment : x));
          setSynthesesMap(prev => {
            const next = new Map(prev);
            next.set(moment.id, stored);
            return next;
          });
          onMomentResynthesisRecoveredRef.current?.(updatedMoment);
        }
      }
    } catch (err) {
      console.error('[MomentResyncRecovery] Failed:', err);
    }
  }, [memoriesRef, setMoments, setSynthesesMap]);

  return { startPolling, recoverPending, recoverPendingResynthesis };
};
