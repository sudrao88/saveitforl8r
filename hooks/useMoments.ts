/**
 * useMoments.ts
 *
 * React hook for managing user-created moments.
 * Moments are explicit synthesis objectives created by the user.
 * Notes are matched to moments during enrichment, and synthesis
 * is regenerated on-demand when new notes are added.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Memory,
  Moment,
  MomentSynthesis,
  MomentType,
  SynthesisResponse,
} from '../types';
import {
  getMoments,
  saveMoment,
  getMomentSynthesis,
  saveMomentSynthesis,
} from '../services/storageService';
import { createMoment as createMomentApi, synthesizeMoment } from '../services/geminiService';

// Synchronous fast hash for cache invalidation (djb2)
function fastHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) & 0xffffffff;
  }
  return 'mh_' + (hash >>> 0).toString(16);
}

function computeInputHash(noteIds: string[], memories: Memory[]): string {
  const inputs = noteIds
    .slice()
    .sort()
    .map(id => {
      const m = memories.find(n => n.id === id);
      return m ? `${id}:${m.timestamp}` : id;
    })
    .join('|');
  return fastHash(inputs);
}

interface UseMomentsReturn {
  /** All active moments */
  moments: Moment[];
  /** Create a new moment from an objective */
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

  // Load persisted moments on mount
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    const loadData = async () => {
      try {
        const loadedMoments = await getMoments();
        setMomentsList(loadedMoments);
      } catch (err) {
        console.error('[Moments] Failed to load persisted data:', err);
      }
    };
    loadData();
  }, []);

  const setOnMomentChanged = useCallback((cb: (moment: Moment) => void) => {
    onMomentChangedRef.current = cb;
  }, []);

  // Create a new moment
  const createNewMoment = useCallback(
    async (objective: string, currentMemories: Memory[]): Promise<Moment | null> => {
      setCreating(true);
      try {
        const result = await createMomentApi(objective, currentMemories);

        const moment: Moment = {
          id: crypto.randomUUID(),
          objective,
          title: result.title,
          type: (result.type || 'general') as MomentType,
          noteIds: result.usedNoteIds || [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastSynthesizedAt: Date.now(),
        };

        // Compute input hash for the initial note set
        moment.inputHash = computeInputHash(moment.noteIds, currentMemories);

        // Save moment
        await saveMoment(moment);
        setMomentsList(prev => [...prev, moment]);

        // Save synthesis
        if (result.synthesis) {
          const stored: MomentSynthesis = {
            momentId: moment.id,
            inputHash: moment.inputHash,
            content: result.synthesis,
            generatedAt: Date.now(),
            noteIds: moment.noteIds,
          };
          await saveMomentSynthesis(stored);
          setSynthesesMap(prev => {
            const next = new Map(prev);
            next.set(moment.id, stored);
            return next;
          });
        }

        // Trigger sync
        onMomentChangedRef.current?.(moment);

        return moment;
      } catch (err) {
        console.error('[Moments] Failed to create moment:', err);
        return null;
      } finally {
        setCreating(false);
      }
    },
    []
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

  // Refresh moments from storage (used after sync)
  const refreshMoments = useCallback(async () => {
    try {
      const loadedMoments = await getMoments();
      setMomentsList(loadedMoments);
    } catch (err) {
      console.error('[Moments] Failed to refresh:', err);
    }
  }, []);

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
