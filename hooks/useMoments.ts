/**
 * useMoments.ts
 *
 * React hook for managing user-created moments.
 * Moments are explicit synthesis objectives created by the user.
 * Notes are matched to moments during enrichment, and synthesis
 * is regenerated on-demand when new notes are added.
 *
 * Moment creation is async: a pending placeholder appears immediately,
 * the server runs a 3-step AI pipeline in the background, and the
 * client polls for results.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { logEvent } from '../services/analytics';
import { ANALYTICS_EVENTS } from '../constants';
import {
  Memory,
  Moment,
  MomentSynthesis,
  SynthesisResponse,
} from '../types';
import {
  getMoments,
  getMoment,
  saveMoment,
  getMomentSynthesis,
  saveMomentSynthesis,
  deleteMomentSynthesis,
} from '../services/storageService';
import { submitMomentCreation, submitResynthesis, pollSynthesisResult, fetchPendingSynthesisResults } from '../services/geminiService';
import { useMomentCreationPolling } from './useMomentCreationPolling';
import { computeInputHash } from '../utils/hash';

interface UseMomentsReturn {
  /** All active moments */
  moments: Moment[];
  /** Create a new moment from an objective (returns immediately with pending placeholder) */
  createNewMoment: (objective: string, memories: Memory[]) => Promise<Moment | null>;
  /** Load synthesis for a moment (cache-aware, triggers re-synthesis if new notes).
   *  Pass `force: true` to bypass caches and always submit a fresh resynthesis. */
  loadSynthesis: (moment: Moment, memories: Memory[], signal?: AbortSignal, force?: boolean) => Promise<SynthesisResponse | null>;
  /** Set of moment IDs currently loading synthesis */
  synthesisLoading: Set<string>;
  /** Current moment creation loading state */
  creating: boolean;
  /** Add a note to a moment (called when enrichment matches) */
  addNoteToMoment: (momentId: string, noteId: string) => Promise<void>;
  /** Remove a note from all moments that reference it (on note deletion) */
  removeNoteFromMoments: (noteId: string) => Promise<void>;
  /** Soft-delete a moment */
  deleteMoment: (momentId: string) => Promise<void>;
  /** Cached synthesis map for UI state */
  synthesesMap: Map<string, MomentSynthesis>;
  /** Callback to sync a moment to Drive */
  onMomentChanged?: (moment: Moment) => void;
  /** Set the sync callback */
  setOnMomentChanged: (cb: (moment: Moment) => void) => void;
  /** Reload moments from IndexedDB (e.g. after sync) */
  refreshMoments: () => Promise<void>;
  /** Mark a moment as seen (updates lastSeenInputHash to current inputHash) */
  markMomentSeen: (momentId: string) => Promise<void>;
}

export const useMoments = (memories: Memory[]): UseMomentsReturn => {
  const [momentsList, setMomentsList] = useState<Moment[]>([]);
  const [synthesesMap, setSynthesesMap] = useState<Map<string, MomentSynthesis>>(new Map());
  const [synthesisLoading, setSynthesisLoading] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const loaded = useRef(false);
  const onMomentChangedRef = useRef<((moment: Moment) => void) | undefined>(undefined);

  // Track in-flight synthesis polling so concurrent calls for the same moment
  // can either reuse (same input hash) or supersede (different hash, e.g. a
  // fresh note matched while polling). The AbortController cancels the older
  // poll when a newer call submits a fresh resynthesis for an updated note set.
  type InFlightPoll = {
    hash: string;
    promise: Promise<SynthesisResponse>;
    abort: AbortController;
  };
  const inFlightPolling = useRef<Map<string, InFlightPoll>>(new Map());

  // Keep refs for polling access
  const momentsListRef = useRef<Moment[]>([]);
  const memoriesRef = useRef<Memory[]>(memories);
  useEffect(() => { momentsListRef.current = momentsList; }, [momentsList]);
  useEffect(() => { memoriesRef.current = memories; }, [memories]);

  const setOnMomentChanged = useCallback((cb: (moment: Moment) => void) => {
    onMomentChangedRef.current = cb;
  }, []);

  // Stable callback for moment creation polling
  const handleMomentCreated = useCallback((moment: Moment) => {
    onMomentChangedRef.current?.(moment);
  }, []);

  // Integrate moment creation polling
  const { startPolling, recoverPending, recoverPendingResynthesis } = useMomentCreationPolling({
    momentsRef: momentsListRef,
    memoriesRef,
    setMoments: setMomentsList,
    setSynthesesMap,
    onMomentCreated: handleMomentCreated,
    onMomentResynthesisRecovered: handleMomentCreated,
  });

  const refreshMoments = useCallback(async () => {
    try {
      const loadedMoments = await getMoments();
      setMomentsList(loadedMoments);

      // Recover any pending moments that were downloaded during sync
      const pending = loadedMoments.filter(m => m.isPending);
      if (pending.length > 0) {
        recoverPending(pending);
      }
      // Recover interrupted resynthesis requests too — the synthesis may have
      // completed server-side while we were offline.
      recoverPendingResynthesis(loadedMoments);
    } catch (err) {
      console.error('[Moments] Failed to refresh moments:', err);
    }
  }, [recoverPending, recoverPendingResynthesis]);

  // Load persisted moments on mount + recover any pending from previous session
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    const loadData = async () => {
      try {
        const loadedMoments = await getMoments();
        setMomentsList(loadedMoments);

        // Recover pending moments from a previous session
        const pending = loadedMoments.filter(m => m.isPending);
        if (pending.length > 0) {
          recoverPending(pending);
        }
        // Recover interrupted user-triggered resynthesis requests.
        recoverPendingResynthesis(loadedMoments);
      } catch (err) {
        console.error('[Moments] Failed to load persisted data:', err);
      }
    };
    loadData();
  }, [recoverPending, recoverPendingResynthesis]);

  // Create a new moment (async — returns pending placeholder immediately)
  const createNewMoment = useCallback(
    async (objective: string, currentMemories: Memory[]): Promise<Moment | null> => {
      setCreating(true);
      try {
        const momentId = crypto.randomUUID();

        // Create pending placeholder immediately
        const pendingMoment: Moment = {
          id: momentId,
          objective,
          title: objective.substring(0, 40),
          type: 'general',
          noteIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isPending: true,
        };

        // Save to IndexedDB and update state immediately
        await saveMoment(pendingMoment);
        setMomentsList(prev => [...prev, pendingMoment]);
        logEvent(ANALYTICS_EVENTS.MOMENT.CATEGORY, ANALYTICS_EVENTS.MOMENT.ACTION_CREATED);

        // Submit to server (fire-and-forget with error handling)
        try {
          await submitMomentCreation(objective, currentMemories, momentId);
          startPolling();
        } catch (submitErr) {
          console.error('[Moments] Submit failed:', submitErr);
          const failedMoment: Moment = {
            ...pendingMoment,
            isPending: false,
            processingError: true,
          };
          await saveMoment(failedMoment);
          setMomentsList(prev => prev.map(m => m.id === momentId ? failedMoment : m));
          return failedMoment;
        }

        // Trigger sync for the pending moment
        onMomentChangedRef.current?.(pendingMoment);

        return pendingMoment;
      } catch (err) {
        console.error('[Moments] Failed to create moment:', err);
        return null;
      } finally {
        setCreating(false);
      }
    },
    [startPolling]
  );

  // Load synthesis (cache-aware; re-synthesizes if notes have changed).
  // `force` bypasses every cache/server-result check and always submits a
  // fresh resynthesis — used by the "Re-synthesize" button so the user can
  // regenerate even when nothing about the input has changed.
  const loadSynthesis = useCallback(
    async (moment: Moment, currentMemories: Memory[], signal?: AbortSignal, force?: boolean): Promise<SynthesisResponse | null> => {
      const currentHash = computeInputHash(moment.noteIds, currentMemories);
      const currentNoteIdSet = new Set(moment.noteIds);

      // Safety check: verify cached synthesis noteIds match current moment noteIds.
      // This catches stale synthesis that survived cache invalidation (e.g. from
      // a Drive sync downloading an old synthesis after a note was deleted).
      const isSynthesisFresh = (cached: MomentSynthesis): boolean => {
        if (cached.inputHash !== currentHash) return false;
        // If the cached synthesis tracked which noteIds it was built from,
        // verify they match the current set exactly.
        if (cached.noteIds) {
          if (cached.noteIds.length !== moment.noteIds.length) return false;
          for (const id of cached.noteIds) {
            if (!currentNoteIdSet.has(id)) return false;
          }
        }
        return true;
      };

      if (!force) {
        // Check in-memory cache first
        const cached = synthesesMap.get(moment.id);
        if (cached && isSynthesisFresh(cached)) {
          return cached.content;
        }

        // Check IndexedDB
        const persisted = await getMomentSynthesis(moment.id);
        if (persisted && isSynthesisFresh(persisted)) {
          setSynthesesMap(prev => {
            const next = new Map(prev);
            next.set(moment.id, persisted);
            return next;
          });
          return persisted.content;
        }
      }

      // Cache miss — first check the server's Firestore-backed result store
      // for a completed synthesis from a previous session (e.g. one that was
      // submitted before the user exited mid-polling). Only submit a new
      // request if no usable result exists.
      //
      // Polling is decoupled from the caller's AbortSignal so that navigating
      // away from a MomentSheet doesn't cancel background polling — the result
      // is cached and ready when the user returns.
      //
      // If a poll is already in flight for this moment from an earlier call in
      // this session (e.g. user reopens the sheet while polling continues), we
      // either reuse it (same input hash → same result) or supersede it
      // (different hash → the older poll's result is now stale).
      const existingPoll = inFlightPolling.current.get(moment.id);
      // When forcing, never reuse an existing poll — the user wants a fresh
      // synthesis, even if a same-hash poll is already in flight.
      const reusableExistingPoll = !force && existingPoll && existingPoll.hash === currentHash
        ? existingPoll
        : undefined;
      if (existingPoll && !reusableExistingPoll) {
        // Newer note set (or forced) — abort the older poll. Its caller's
        // `await` throws AbortError and the catch-block bails without
        // persisting stale data.
        existingPoll.abort.abort();
        inFlightPolling.current.delete(moment.id);
      }

      setSynthesisLoading(prev => prev.has(moment.id) ? prev : new Set(prev).add(moment.id));

      // Snapshot the moment with processingError cleared (issue 2). We hold
      // this so subsequent persistence writes layer on a clean slate.
      let workingMoment: Moment = moment;
      if (!reusableExistingPoll && moment.processingError) {
        workingMoment = { ...moment, processingError: false, updatedAt: Date.now() };
        await saveMoment(workingMoment);
        setMomentsList(prev => prev.map(m => m.id === moment.id ? workingMoment : m));
      }

      const filterSynthesis = (raw: SynthesisResponse): SynthesisResponse => ({
        ...raw,
        sections: raw.sections
          .map(section => ({
            ...section,
            items: section.items.filter(item => currentNoteIdSet.has(item.sourceNoteId)),
          }))
          .filter(section => section.items.length > 0),
        generatedFrom: raw.generatedFrom.filter(id => currentNoteIdSet.has(id)),
      });

      const persistResult = async (raw: SynthesisResponse): Promise<SynthesisResponse | null> => {
        const synthesis = filterSynthesis(raw);
        // Re-read latest from IDB before persisting (mirrors the note
        // enrichment polling pattern). The user may have deleted the moment
        // while the synthesis network round-trip was in flight; without this
        // guard we'd resurrect the deleted moment by spreading the captured
        // alive workingMoment back into IDB.
        const latest = await getMoment(moment.id);
        if (!latest || latest.isDeleted) return null;

        const stored: MomentSynthesis = {
          momentId: moment.id,
          inputHash: currentHash,
          content: synthesis,
          generatedAt: Date.now(),
          noteIds: latest.noteIds,
        };
        const updatedMoment: Moment = {
          ...latest,
          inputHash: currentHash,
          lastSeenInputHash: currentHash,
          lastSynthesizedAt: Date.now(),
          updatedAt: Date.now(),
          processingError: false,
          pendingSynthesisHash: undefined,
          pendingSynthesisAt: undefined,
        };
        await saveMoment(updatedMoment);
        setMomentsList(prev => prev.map(m => m.id === moment.id ? updatedMoment : m));
        await saveMomentSynthesis(stored);
        setSynthesesMap(prev => {
          const next = new Map(prev);
          next.set(moment.id, stored);
          return next;
        });
        onMomentChangedRef.current?.(updatedMoment);
        return synthesis;
      };

      // Hoisted out of the try so the catch block can use promise identity
      // (rather than hash equality) to decide whether to clear the in-flight
      // entry — same approach as the success path at line ~388. This avoids a
      // failing call wiping a *concurrent* call's entry when both share the
      // same hash but each created its own polling promise during the
      // narrow setup-phase race window.
      let pollingPromise: Promise<SynthesisResponse> | undefined = reusableExistingPoll?.promise;

      try {
        if (!pollingPromise) {
          // Step 1: check if the server already has a result for this moment.
          // When forcing, skip this check entirely — the user wants a new
          // synthesis, not the previously-cached server result.
          const existing = force ? {} : await fetchPendingSynthesisResults([moment.id]);
          const serverEntry = existing[moment.id];

          if (
            serverEntry?.status === 'completed' &&
            'data' in serverEntry &&
            serverEntry.inputHash === currentHash
          ) {
            // Server already has a fresh result — use it without resubmitting.
            const synthesis = await persistResult(serverEntry.data);
            return signal?.aborted ? null : synthesis;
          }

          // Each fresh poll gets its own AbortController so a later
          // supersede-call can cancel it without affecting unrelated polls.
          const abort = new AbortController();

          if (
            serverEntry?.status === 'processing' &&
            (!serverEntry.inputHash || serverEntry.inputHash === currentHash)
          ) {
            // Server is still synthesizing for the same input — just poll.
            pollingPromise = pollSynthesisResult(moment.id, abort.signal);
            inFlightPolling.current.set(moment.id, { hash: currentHash, promise: pollingPromise, abort });
          } else {
            // No usable server result — submit a fresh resynthesis. Persist a
            // recovery marker so that if this session is interrupted, the next
            // session can resume polling instead of resubmitting (issue 5).
            // Re-read latest from IDB so a deletion that happened while we
            // were checking the server can't be reverted.
            const latest = await getMoment(moment.id);
            if (!latest || latest.isDeleted) return null;

            workingMoment = {
              ...latest,
              pendingSynthesisHash: currentHash,
              pendingSynthesisAt: Date.now(),
              updatedAt: Date.now(),
            };
            await saveMoment(workingMoment);
            setMomentsList(prev => prev.map(m => m.id === moment.id ? workingMoment : m));

            await submitResynthesis(moment, currentMemories, currentHash);
            pollingPromise = pollSynthesisResult(moment.id, abort.signal);
            inFlightPolling.current.set(moment.id, { hash: currentHash, promise: pollingPromise, abort });
          }
        }

        const rawSynthesis = await pollingPromise;
        // Only clear the in-flight entry if it's still ours — a superseding
        // call may have already replaced it with a fresh poll.
        const stillOurs = inFlightPolling.current.get(moment.id);
        if (stillOurs && stillOurs.promise === pollingPromise) {
          inFlightPolling.current.delete(moment.id);
        }

        const synthesis = await persistResult(rawSynthesis);

        // If the caller was aborted (e.g. MomentSheet unmounted), the result
        // is still cached above — the caller just won't use the return value.
        if (signal?.aborted) {
          return null;
        }

        return synthesis;
      } catch (err) {
        // Only clear the in-flight entry if it still references our promise.
        // Using promise identity (not hash) avoids wiping a concurrent
        // same-hash call's entry, and naturally leaves any superseding entry
        // alone (its promise differs).
        if (pollingPromise) {
          const stillOurs = inFlightPolling.current.get(moment.id);
          if (stillOurs && stillOurs.promise === pollingPromise) {
            inFlightPolling.current.delete(moment.id);
          }
        }
        // An AbortError means a newer call superseded us — that newer call
        // owns the pendingSynthesisHash marker and will persist its own
        // result. Don't log, don't clear, don't persist.
        if ((err as Error)?.name === 'AbortError') {
          return null;
        }
        console.error('[Moments] Synthesis failed:', err);
        // Clear the recovery marker so app start doesn't keep polling a dead
        // request — but only if it still matches the marker *this call* set.
        // A concurrent newer call may have overwritten it with its own hash;
        // wiping that would leave the newer in-flight orphan.
        if (workingMoment.pendingSynthesisHash || workingMoment.pendingSynthesisAt) {
          const latest = await getMoment(moment.id);
          if (
            latest &&
            !latest.isDeleted &&
            latest.pendingSynthesisHash === workingMoment.pendingSynthesisHash
          ) {
            const cleared: Moment = {
              ...latest,
              pendingSynthesisHash: undefined,
              pendingSynthesisAt: undefined,
              updatedAt: Date.now(),
            };
            await saveMoment(cleared);
            setMomentsList(prev => prev.map(m => m.id === moment.id ? cleared : m));
          }
        }
        return null;
      } finally {
        setSynthesisLoading(prev => {
          const next = new Set(prev);
          next.delete(moment.id);
          return next;
        });
      }
    },
    [synthesesMap]
  );

  // Stable ref for cross-callback access to loadSynthesis. addNoteToMoment
  // uses it to kick off background re-synthesis when a new note matches a
  // moment, without dragging synthesesMap into the addNoteToMoment dep list
  // (which would churn the App.tsx setOnNoteMatchedMoments wiring).
  const loadSynthesisRef = useRef<typeof loadSynthesis>(loadSynthesis);
  useEffect(() => { loadSynthesisRef.current = loadSynthesis; }, [loadSynthesis]);

  // Add a note to a moment (called when enrichment matches).
  // Re-reads the latest record from IndexedDB before saving (mirrors the
  // note enrichment polling pattern) so a moment that's been tombstoned
  // — locally or via a sync from another device — isn't resurrected by
  // a stale React-state copy.
  //
  // After persisting, kicks off a background re-synthesis so the moment is
  // ready when the user next opens its sheet. loadSynthesis itself handles
  // the supersede case if multiple matches arrive in quick succession (an
  // older in-flight poll for a stale note set is aborted in favor of a fresh
  // submit). Pending moments are skipped — the creation pipeline already
  // produces their initial synthesis.
  const addNoteToMoment = useCallback(
    async (momentId: string, noteId: string): Promise<void> => {
      const latest = await getMoment(momentId);
      if (!latest || latest.isDeleted || latest.noteIds.includes(noteId)) return;

      const newNoteIds = [...latest.noteIds, noteId];
      const updated: Moment = {
        ...latest,
        noteIds: newNoteIds,
        inputHash: computeInputHash(newNoteIds, memoriesRef.current),
        updatedAt: Date.now(),
      };

      await saveMoment(updated);
      setMomentsList(prev => {
        const exists = prev.some(m => m.id === momentId);
        return exists ? prev.map(m => m.id === momentId ? updated : m) : [...prev, updated];
      });
      onMomentChangedRef.current?.(updated);

      if (!updated.isPending) {
        loadSynthesisRef.current(updated, memoriesRef.current).catch(err =>
          console.error(`[Moments] Background re-synthesis failed for ${momentId}:`, err)
        );
      }
    },
    []
  );

  // Mark a moment as seen by updating lastSeenInputHash to match current inputHash.
  // This persists to IndexedDB and syncs to Drive so the indicator stays correct
  // across sessions and devices. Same IDB re-read pattern as addNoteToMoment.
  const markMomentSeen = useCallback(
    async (momentId: string): Promise<void> => {
      const latest = await getMoment(momentId);
      if (!latest || latest.isDeleted || latest.lastSeenInputHash === latest.inputHash) return;

      const updated: Moment = {
        ...latest,
        lastSeenInputHash: latest.inputHash,
        updatedAt: Date.now(),
      };

      await saveMoment(updated);
      setMomentsList(prev => prev.map(m => m.id === momentId ? updated : m));
      onMomentChangedRef.current?.(updated);
    },
    []
  );

  // Remove a note from all moments that reference it (called on note deletion).
  // Uses setMomentsList's functional updater so each call sees the latest
  // state — this prevents lost updates when multiple notes are deleted
  // in quick succession (same pattern as addNoteToMoment).
  //
  // Clears `inputHash` on affected moments so that:
  // 1. MomentBubble shows the stale indicator (hash mismatch)
  // 2. loadSynthesis triggers re-synthesis on next open (cache miss)
  const removeNoteFromMoments = useCallback(
    async (noteId: string): Promise<void> => {
      const changedMoments: Moment[] = [];

      // Use flushSync to ensure the functional updater runs immediately,
      // so changedMoments is populated before we proceed to persistence.
      // This also ensures atomicity — each call sees the latest state.
      flushSync(() => {
        setMomentsList(prev => {
          const affected = prev.filter(m => !m.isDeleted && m.noteIds.includes(noteId));
          if (affected.length === 0) return prev;

          const updatedMoments = prev.map(m => {
            if (m.isDeleted || !m.noteIds.includes(noteId)) return m;
            const remainingNoteIds = m.noteIds.filter(id => id !== noteId);
            // If the last source note is gone (and this isn't a still-being-created
            // pending moment), soft-delete the moment — a moment with no source notes
            // is an orphan, just like an orphan to-do or calendar event.
            const becameOrphan = remainingNoteIds.length === 0 && !m.isPending;
            const updated: Moment = {
              ...m,
              noteIds: remainingNoteIds,
              inputHash: undefined,
              updatedAt: Date.now(),
              ...(becameOrphan ? { isDeleted: true } : {}),
            };
            changedMoments.push(updated);
            return updated;
          });

          return updatedMoments;
        });
      });

      if (changedMoments.length === 0) return;

      // Clear synthesis caches for affected moments so stale synthesis
      // (which still references the deleted note) cannot be served.
      setSynthesesMap(prev => {
        const next = new Map(prev);
        for (const m of changedMoments) {
          next.delete(m.id);
        }
        return next;
      });

      // Persist and sync each affected moment, and clear persisted synthesis
      await Promise.all(
        changedMoments.map(m =>
          Promise.all([
            saveMoment(m),
            deleteMomentSynthesis(m.id).catch(e =>
              console.warn(`[Moments] Failed to delete synthesis cache for ${m.id}:`, e)
            ),
          ]).then(() => {
            onMomentChangedRef.current?.(m);
          })
        )
      );
    },
    []
  );

  // Soft-delete a moment, then sync the deletion. The sync layer
  // (performMomentSync) directly deletes the Drive files and hard-deletes the
  // local tombstone — same pattern as note deletion (handleDelete in
  // useMemories). Awaiting the callback mirrors note deletion semantics so
  // callers can react after the deletion has propagated (or failed).
  const deleteMoment = useCallback(
    async (momentId: string): Promise<void> => {
      const current = momentsListRef.current.find(m => m.id === momentId);
      if (!current) return;

      const tombstone: Moment = { ...current, isDeleted: true, updatedAt: Date.now() };

      // Persist the tombstone first so a sync failure leaves an idempotent
      // record that the next delta sync will retry.
      await saveMoment(tombstone);

      setMomentsList(prev => prev.filter(m => m.id !== momentId));

      // Clear cached synthesis so a stale entry can't resurface in the UI.
      setSynthesesMap(prev => {
        if (!prev.has(momentId)) return prev;
        const next = new Map(prev);
        next.delete(momentId);
        return next;
      });
      onMomentChangedRef.current?.(tombstone);
    },
    []
  );

  // Filter to active moments only
  const moments = useMemo(
    () => momentsList.filter(m => !m.isDeleted).sort((a, b) => b.updatedAt - a.updatedAt),
    [momentsList]
  );

  return {
    moments,
    createNewMoment,
    loadSynthesis,
    synthesisLoading,
    creating,
    addNoteToMoment,
    removeNoteFromMoments,
    deleteMoment,
    synthesesMap,
    setOnMomentChanged,
    refreshMoments,
    markMomentSeen,
  };
};
