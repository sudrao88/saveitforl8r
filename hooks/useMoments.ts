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
import { submitMomentCreation, synthesizeMoment } from '../services/geminiService';
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
  /** Soft-delete a moment */
  deleteMoment: (momentId: string) => Promise<void>;
  /** Cached synthesis map for UI state */
  synthesesMap: Map<string, MomentSynthesis>;
  /** Callback to sync a moment to Drive */
  onMomentChanged?: (moment: Moment) => void;
  /** Set the sync callback */
  setOnMomentChanged: (cb: (moment: Moment) => void) => void;
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

      // Cache miss — re-synthesize
      setSynthesisLoading(moment.id);
      try {
        const synthesis = await synthesizeMoment(moment, currentMemories);

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

  // Add a note to a moment (called when enrichment matches)
  const addNoteToMoment = useCallback(
    async (momentId: string, noteId: string) => {
      const moment = momentsList.find(m => m.id === momentId);
      if (!moment) return;
      if (moment.noteIds.includes(noteId)) return;

      const updated: Moment = {
        ...moment,
        noteIds: [...moment.noteIds, noteId],
        updatedAt: Date.now(),
      };

      await saveMoment(updated);
      setMomentsList(prev => prev.map(m => m.id === momentId ? updated : m));
      onMomentChangedRef.current?.(updated);
    },
    [momentsList]
  );

  // Soft-delete a moment
  const deleteMoment = useCallback(
    async (momentId: string) => {
      const moment = momentsList.find(m => m.id === momentId);
      if (!moment) return;

      const tombstone: Moment = {
        ...moment,
        isDeleted: true,
        updatedAt: Date.now(),
      };

      await saveMoment(tombstone);
      setMomentsList(prev => prev.filter(m => m.id !== momentId));
      onMomentChangedRef.current?.(tombstone);
    },
    [momentsList]
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
    deleteMoment,
    synthesesMap,
    setOnMomentChanged,
  };
};
