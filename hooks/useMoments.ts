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
  loadSynthesis: (moment: Moment, memories: Memory[]) => Promise<SynthesisResponse | null>;
  /** Current synthesis loading state (moment ID or null) */
  synthesisLoading: string | null;
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
}

export const useMoments = (memories: Memory[]): UseMomentsReturn => {
  const [momentsList, setMomentsList] = useState<Moment[]>([]);
  const [synthesesMap, setSynthesesMap] = useState<Map<string, MomentSynthesis>>(new Map());
  const [synthesisLoading, setSynthesisLoading] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const loaded = useRef(false);
  const onMomentChangedRef = useRef<((moment: Moment) => void) | undefined>(undefined);

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
    async (moment: Moment, currentMemories: Memory[]): Promise<SynthesisResponse | null> => {
      const currentHash = computeInputHash(moment.noteIds, currentMemories);

      // Check in-memory cache first
      const cached = synthesesMap.get(moment.id);
      if (cached && cached.inputHash === currentHash) {
        return cached.content;
      }

      // Check IndexedDB
      const persisted = await getMomentSynthesis(moment.id);
      if (persisted && persisted.inputHash === currentHash) {
        setSynthesesMap(prev => {
          const next = new Map(prev);
          next.set(moment.id, persisted);
          return next;
        });
        return persisted.content;
      }

      // Cache miss — submit re-synthesis asynchronously and poll for result
      setSynthesisLoading(moment.id);
      try {
        await submitResynthesis(moment, currentMemories);
        const synthesis = await pollSynthesisResult(moment.id);

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

        return synthesis;
      } catch (err) {
        console.error('[Moments] Synthesis failed:', err);
        return null;
      } finally {
        setSynthesisLoading(null);
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

          const updated: Moment = {
            ...current,
            noteIds: [...current.noteIds, noteId],
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

      // Persist and sync each affected moment
      await Promise.all(
        changedMoments.map(m =>
          saveMoment(m).then(() => {
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
  };
};
