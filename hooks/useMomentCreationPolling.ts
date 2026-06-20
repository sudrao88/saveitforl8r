/**
 * useMomentCreationPolling.ts
 *
 * Manages polling for async moment creation results.
 * Mirrors the enrichment polling pattern (useEnrichmentPolling.ts)
 * with tiered polling intervals (1s for first 15s, then 2s).
 */

import { useCallback, useEffect, useRef } from 'react';
import { fetchPendingMomentResults, fetchPendingSynthesisResults, CreateMomentResponse, ProgressStep } from '../services/geminiService';
import { Moment, Memory, MomentSynthesis, MomentType, WebAddition } from '../types';
import { getMoment, saveMoment, saveMomentSynthesis } from '../services/storageService';
import { computeInputHash } from '../utils/hash';
import { filterSynthesisToNotes } from '../utils/synthesisFilter';

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
  /** Updates the live per-moment agent progress trace shown during creation. */
  setMomentProgress?: React.Dispatch<React.SetStateAction<Map<string, ProgressStep[]>>>;
  /** Applies agent-fetched web findings back onto their source notes. */
  applyWebAdditionsRef?: React.RefObject<((id: string, additions: WebAddition[]) => Promise<void>) | undefined>;
  onMomentCreated?: (moment: Moment) => void;
  /**
   * Called when a moment's synthesis is hydrated by the recovery flow. Lets the
   * caller (useMoments) trigger a Drive sync so the freshly-cached synthesis
   * propagates to other devices.
   */
  onMomentResynthesisRecovered?: (moment: Moment) => void;
}

/**
 * Applies a moment creation poll result to a pending moment.
 * Returns the updated moment if a change was made, or null otherwise.
 *
 * Re-reads the latest record from IndexedDB before saving (mirrors the
 * note enrichment polling pattern in useEnrichmentPolling.ts) so a
 * deletion that happened during the network round-trip can't be
 * resurrected by spreading the stale captured object back into IDB.
 */
const applyMomentResult = async (
  pendingMoment: Moment,
  result: { status: string; data?: CreateMomentResponse } | undefined,
  memoriesRef: React.RefObject<Memory[]>,
  setSynthesesMap: React.Dispatch<React.SetStateAction<Map<string, MomentSynthesis>>>,
  applyWebAdditions?: (id: string, additions: WebAddition[]) => Promise<void>,
): Promise<{ updated: Moment; action: 'completed' | 'failed' } | null> => {
  const needsUpdate =
    (result?.status === 'completed' && result.data) ||
    result?.status === 'failed' ||
    ((!result || result.status === 'not_found') &&
      Date.now() - pendingMoment.createdAt > MOMENT_CREATION_TIMEOUT_MS);

  if (!needsUpdate) return null;

  const current = await getMoment(pendingMoment.id);
  if (!current || current.isDeleted) return null;
  if (!current.isPending) return null;

  // Completed
  if (result?.status === 'completed' && result.data) {
    const data = result.data;
    // Merge server-selected noteIds with any noteIds added by enrichment
    // matching while the moment was still pending (race condition fix).
    const mergedNoteIds = Array.from(new Set([
      ...(data.usedNoteIds || []),
      ...current.noteIds,
    ]));

    const updatedMoment: Moment = {
      ...current,
      title: data.title || current.title,
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

    // Save agent-fetched web findings back onto their source notes (best-effort,
    // clearly attributed). Grouped by note so each note is written once.
    if (applyWebAdditions && data.noteEmbellishments?.length) {
      const byNote = new Map<string, WebAddition[]>();
      for (const e of data.noteEmbellishments) {
        if (!e?.noteId || !e?.addition?.trim() || !e?.sourceUrl) continue;
        const addition: WebAddition = {
          text: e.addition,
          sourceUrl: e.sourceUrl,
          addedByMomentId: updatedMoment.id,
          addedAt: Date.now(),
        };
        byNote.set(e.noteId, [...(byNote.get(e.noteId) || []), addition]);
      }
      await Promise.all(
        Array.from(byNote.entries()).map(([noteId, additions]) =>
          applyWebAdditions(noteId, additions).catch(err =>
            console.warn(`[MomentPoll] Failed to apply web additions to ${noteId}:`, err)
          )
        )
      );
    }

    return { updated: updatedMoment, action: 'completed' };
  }

  // Failed or timed out
  const failedMoment: Moment = {
    ...current,
    isPending: false,
    processingError: true,
  };
  await saveMoment(failedMoment);
  return { updated: failedMoment, action: 'failed' };
};

export const useMomentCreationPolling = ({
  momentsRef,
  memoriesRef,
  setMoments,
  setSynthesesMap,
  setMomentProgress,
  applyWebAdditionsRef,
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
          const result = results[moment.id];
          // Surface live agent progress while the moment is still processing.
          if (setMomentProgress && result?.status === 'processing' && result.progress?.length) {
            setMomentProgress(prev => {
              const next = new Map(prev);
              next.set(moment.id, result.progress as ProgressStep[]);
              return next;
            });
          }
          const outcome = await applyMomentResult(
            moment, result, memoriesRef, setSynthesesMap, applyWebAdditionsRef?.current
          );
          if (!isMountedRef.current) return;
          if (outcome) {
            setMoments(prev => prev.map(m => m.id === moment.id ? outcome.updated : m));
            if (setMomentProgress) {
              setMomentProgress(prev => {
                if (!prev.has(moment.id)) return prev;
                const next = new Map(prev);
                next.delete(moment.id);
                return next;
              });
            }
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
  }, [momentsRef, memoriesRef, setMoments, setSynthesesMap, setMomentProgress, applyWebAdditionsRef]);

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
          moment, result, memoriesRef, setSynthesesMap, applyWebAdditionsRef?.current
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
  }, [memoriesRef, setMoments, setSynthesesMap, startPolling, applyWebAdditionsRef]);

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

    // Phase 1: drop expired markers without a network call. Persist each
    // sequentially (IndexedDB writes are cheap) but apply a single setMoments
    // at the end of the phase to avoid one re-render per stale moment.
    const momentUpdates = new Map<string, Moment>();

    if (stale.length > 0) {
      for (const m of stale) {
        try {
          // Re-read latest from IDB so a concurrent deletion isn't reverted.
          const latest = await getMoment(m.id);
          if (!latest || latest.isDeleted) continue;
          const cleared: Moment = {
            ...latest,
            pendingSynthesisHash: undefined,
            pendingSynthesisAt: undefined,
            updatedAt: now,
          };
          await saveMoment(cleared);
          momentUpdates.set(m.id, cleared);
        } catch (err) {
          console.error('[MomentResyncRecovery] Failed to clear stale marker:', err);
        }
      }
      if (!isMountedRef.current) return;
      if (momentUpdates.size > 0) {
        setMoments(prev => prev.map(x => momentUpdates.get(x.id) ?? x));
      }
    }

    if (candidates.length === 0) return;

    try {
      // Phase 2: fetch server results for all candidates in chunked batches,
      // then accumulate updates in maps and apply once at the end of the phase.
      momentUpdates.clear();
      const synthesisUpdates = new Map<string, MomentSynthesis>();
      const recovered: Moment[] = [];

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

        // Re-read the latest record from IndexedDB before persisting (mirrors
        // useEnrichmentPolling's tombstone check). The user may have deleted
        // the moment while the network round-trip was in flight; without this
        // guard we'd resurrect the deleted moment by spreading the captured
        // alive object back into IDB.
        const latest = await getMoment(moment.id);
        if (!latest || latest.isDeleted) continue;

        const queueClear = async () => {
          const cleared: Moment = {
            ...latest,
            pendingSynthesisHash: undefined,
            pendingSynthesisAt: undefined,
            updatedAt: Date.now(),
          };
          await saveMoment(cleared);
          momentUpdates.set(moment.id, cleared);
        };

        // A structure-preserving merge couldn't place a note while we were away.
        // Keep the existing synthesis, clear the marker, and flag for rebuild.
        if (result.status === 'needs_rebuild') {
          const flagged: Moment = {
            ...latest,
            needsAgenticRebuild: true,
            pendingSynthesisHash: undefined,
            pendingSynthesisAt: undefined,
            updatedAt: Date.now(),
          };
          await saveMoment(flagged);
          momentUpdates.set(moment.id, flagged);
          continue;
        }

        if (!result || result.status === 'not_found' || result.status === 'failed') {
          await queueClear();
          continue;
        }

        if (result.status === 'completed' && 'data' in result) {
          // Validate the server's hash matches the hash we sent at submit time
          // AND still matches the current local note set (notes may have been
          // added/removed locally while the app was closed).
          const currentHash = computeInputHash(latest.noteIds, memoriesRef.current || []);
          const serverHashOk = result.inputHash === latest.pendingSynthesisHash;
          const localStillMatches = result.inputHash === currentHash;

          if (!serverHashOk || !localStillMatches) {
            await queueClear();
            continue;
          }

          const noteIdSet = new Set(latest.noteIds);
          const synthesis = filterSynthesisToNotes(result.data, noteIdSet);
          const stored: MomentSynthesis = {
            momentId: latest.id,
            inputHash: currentHash,
            content: synthesis,
            generatedAt: Date.now(),
            noteIds: latest.noteIds,
          };

          const updatedMoment: Moment = {
            ...latest,
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

          momentUpdates.set(moment.id, updatedMoment);
          synthesisUpdates.set(moment.id, stored);
          recovered.push(updatedMoment);
        }
      }

      if (!isMountedRef.current) return;

      if (momentUpdates.size > 0) {
        setMoments(prev => prev.map(x => momentUpdates.get(x.id) ?? x));
      }
      if (synthesisUpdates.size > 0) {
        setSynthesesMap(prev => {
          const next = new Map(prev);
          for (const [id, stored] of synthesisUpdates) {
            next.set(id, stored);
          }
          return next;
        });
      }
      for (const m of recovered) {
        onMomentResynthesisRecoveredRef.current?.(m);
      }
    } catch (err) {
      console.error('[MomentResyncRecovery] Failed:', err);
    }
  }, [memoriesRef, setMoments, setSynthesesMap]);

  return { startPolling, recoverPending, recoverPendingResynthesis };
};
