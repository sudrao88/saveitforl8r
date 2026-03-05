/**
 * useMomentCreationPolling.ts
 *
 * Manages polling for async moment creation results.
 * Mirrors the enrichment polling pattern (useEnrichmentPolling.ts)
 * with Fibonacci backoff.
 */

import { useCallback, useRef } from 'react';
import { fetchPendingMomentResults, CreateMomentResponse } from '../services/geminiService';
import { Moment, Memory, MomentSynthesis, MomentType } from '../types';
import { saveMoment, saveMomentSynthesis } from '../services/storageService';
import { computeInputHash } from '../utils/hash';

const MOMENT_CREATION_TIMEOUT_MS = 180_000; // 3 minutes (3-step pipeline)

interface UseMomentCreationPollingOptions {
  momentsRef: React.RefObject<Moment[]>;
  memoriesRef: React.RefObject<Memory[]>;
  setMoments: React.Dispatch<React.SetStateAction<Moment[]>>;
  setSynthesesMap: React.Dispatch<React.SetStateAction<Map<string, MomentSynthesis>>>;
  onMomentCreated?: (moment: Moment) => void;
}

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
}: UseMomentCreationPollingOptions) => {
  const pollingActiveRef = useRef(false);

  const startPolling = useCallback(() => {
    if (pollingActiveRef.current) return;
    pollingActiveRef.current = true;

    let prevDelay = 1_000;
    let currDelay = 2_000;

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

        for (const moment of pending) {
          const outcome = await applyMomentResult(
            moment, results[moment.id], memoriesRef, setSynthesesMap
          );
          if (outcome) {
            setMoments(prev => prev.map(m => m.id === moment.id ? outcome.updated : m));
            if (outcome.action === 'completed') {
              onMomentCreated?.(outcome.updated);
            }
          }
        }
      } catch (err) {
        console.error('[MomentPoll] Failed:', err);
      }

      // Re-check pending after processing
      const stillPending = momentsRef.current.filter(m => m.isPending);
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
  }, [momentsRef, memoriesRef, setMoments, setSynthesesMap, onMomentCreated]);

  const recoverPending = useCallback(async (pendingMoments: Moment[]) => {
    if (pendingMoments.length === 0) return;
    try {
      const ids = pendingMoments.map(m => m.id);
      const results = await fetchPendingMomentResults(ids);

      for (const moment of pendingMoments) {
        const result = results[moment.id];
        if (result?.status === 'processing') {
          startPolling();
          continue;
        }

        const outcome = await applyMomentResult(
          moment, result, memoriesRef, setSynthesesMap
        );
        if (outcome) {
          setMoments(prev => prev.map(m => m.id === moment.id ? outcome.updated : m));
          if (outcome.action === 'completed') {
            onMomentCreated?.(outcome.updated);
          }
        }
      }
    } catch (err) {
      console.error('[MomentRecovery] Failed:', err);
    }
  }, [memoriesRef, setMoments, setSynthesesMap, startPolling, onMomentCreated]);

  return { startPolling, recoverPending };
};
