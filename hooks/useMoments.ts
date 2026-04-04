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
  saveMoment,
  getMomentSynthesis,
  saveMomentSynthesis,
  deleteMomentSynthesis,
} from '../services/storageService';
import { submitMomentCreation, submitResynthesis, pollSynthesisResult } from '../services/geminiService';
import { useMomentCreationPolling } from './useMomentCreationPolling';
import { computeInputHash } from '../utils/hash';

interface UseMomentsReturn {
  /** All active moments */
  moments: Moment[];
  /** Create a new moment from an objective (returns immediately with pending placeholder) */
  createNewMoment: (objective: string, memories: Memory[]) => Promise<Moment | null>;
  /** Load synthesis for a moment (cache-aware, triggers re-synthesis if new notes) */
  loadSynthesis: (moment: Moment, memories: Memory[], signal?: AbortSignal) => Promise<SynthesisResponse | null>;
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

  // Track in-flight synthesis polling promises so concurrent calls for the
  // same moment reuse the same promise instead of submitting duplicate requests.
  const inFlightPolling = useRef<Map<string, Promise<SynthesisResponse>>>(new Map());

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
  const { startPolling, recoverPending } = useMomentCreationPolling({
    momentsRef: momentsListRef,
    memoriesRef,
    setMoments: setMomentsList,
    setSynthesesMap,
    onMomentCreated: handleMomentCreated,
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
    } catch (err) {
      console.error('[Moments] Failed to refresh moments:', err);
    }
  }, [recoverPending]);

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
      } catch (err) {
        console.error('[Moments] Failed to load persisted data:', err);
      }
    };
    loadData();
  }, [recoverPending]);

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

  // Load synthesis (cache-aware; re-synthesizes if notes have changed)
  const loadSynthesis = useCallback(
    async (moment: Moment, currentMemories: Memory[], signal?: AbortSignal): Promise<SynthesisResponse | null> => {
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

      // Cache miss — submit re-synthesis asynchronously and poll for result.
      // Polling is decoupled from the caller's AbortSignal so that navigating
      // away from a MomentSheet doesn't cancel background polling — the result
      // is cached and ready when the user returns.
      setSynthesisLoading(prev => new Set(prev).add(moment.id));
      try {
        // Reuse an existing in-flight polling promise for this moment if one
        // exists (e.g. if the user re-opens the sheet while polling is still
        // running from the first open).
        let pollingPromise = inFlightPolling.current.get(moment.id);
        if (!pollingPromise) {
          await submitResynthesis(moment, currentMemories);
          pollingPromise = pollSynthesisResult(moment.id);
          inFlightPolling.current.set(moment.id, pollingPromise);
        }

        const rawSynthesis = await pollingPromise;
        inFlightPolling.current.delete(moment.id);

        // Filter out items referencing notes not in this moment.
        // This guards against a race where a concurrent synthesis request
        // (with a different set of notes) completes first and its result
        // is picked up by our polling — e.g. when a note is deleted while
        // a previous synthesis is still in-flight on the server.
        const synthesis: SynthesisResponse = {
          ...rawSynthesis,
          sections: rawSynthesis.sections
            .map(section => ({
              ...section,
              items: section.items.filter(item =>
                currentNoteIdSet.has(item.sourceNoteId)
              ),
            }))
            .filter(section => section.items.length > 0),
          generatedFrom: rawSynthesis.generatedFrom.filter(id =>
            currentNoteIdSet.has(id)
          ),
        };

        const stored: MomentSynthesis = {
          momentId: moment.id,
          inputHash: currentHash,
          content: synthesis,
          generatedAt: Date.now(),
          noteIds: moment.noteIds,
        };

        // Update moment's hash and synthesis timestamp
        const updatedMoment: Moment = {
          ...moment,
          inputHash: currentHash,
          lastSeenInputHash: currentHash,
          lastSynthesizedAt: Date.now(),
          updatedAt: Date.now(),
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

        // If the caller was aborted (e.g. MomentSheet unmounted), the result
        // is still cached above — the caller just won't use the return value.
        if (signal?.aborted) {
          return null;
        }

        return synthesis;
      } catch (err) {
        inFlightPolling.current.delete(moment.id);
        console.error('[Moments] Synthesis failed:', err);
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

  // Add a note to a moment (called when enrichment matches).
  // Uses setMomentsList's functional updater so each call sees the latest
  // state — this prevents lost updates when multiple enrichments complete
  // in quick succession and match the same moment.
  const addNoteToMoment = useCallback(
    (momentId: string, noteId: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        setMomentsList(prev => {
          const current = prev.find(m => m.id === momentId);
          if (!current || current.noteIds.includes(noteId)) {
            resolve();
            return prev;
          }

          const newNoteIds = [...current.noteIds, noteId];
          const updated: Moment = {
            ...current,
            noteIds: newNoteIds,
            inputHash: computeInputHash(newNoteIds, memoriesRef.current),
            updatedAt: Date.now(),
          };

          saveMoment(updated)
            .then(() => {
              onMomentChangedRef.current?.(updated);
              resolve();
            })
            .catch(reject);

          return prev.map(m => m.id === momentId ? updated : m);
        });
      });
    },
    []
  );

  // Mark a moment as seen by updating lastSeenInputHash to match current inputHash.
  // This persists to IndexedDB and syncs to Drive so the indicator stays correct
  // across sessions and devices.
  const markMomentSeen = useCallback(
    (momentId: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        setMomentsList(prev => {
          const current = prev.find(m => m.id === momentId);
          if (!current || current.lastSeenInputHash === current.inputHash) {
            resolve();
            return prev;
          }

          const updated: Moment = {
            ...current,
            lastSeenInputHash: current.inputHash,
            updatedAt: Date.now(),
          };

          saveMoment(updated)
            .then(() => {
              onMomentChangedRef.current?.(updated);
              resolve();
            })
            .catch(reject);

          return prev.map(m => m.id === momentId ? updated : m);
        });
      });
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
            const updated = {
              ...m,
              noteIds: m.noteIds.filter(id => id !== noteId),
              inputHash: undefined,
              updatedAt: Date.now(),
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

  // Soft-delete a moment.
  // Same functional-updater pattern as addNoteToMoment for consistency.
  const deleteMoment = useCallback(
    (momentId: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        setMomentsList(prev => {
          const current = prev.find(m => m.id === momentId);
          if (!current) {
            resolve();
            return prev;
          }

          const tombstone: Moment = {
            ...current,
            isDeleted: true,
            updatedAt: Date.now(),
          };

          saveMoment(tombstone)
            .then(() => {
              onMomentChangedRef.current?.(tombstone);
              resolve();
            })
            .catch(reject);

          return prev.filter(m => m.id !== momentId);
        });
      });
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
