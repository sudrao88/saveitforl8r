/**
 * useMoments.ts
 *
 * React hook combining the clustering engine, cadence engine, and synthesis cache.
 * Recomputes clusters whenever memories change. Surfacing runs on every render.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Memory,
  MomentCluster,
  MomentMeta,
  MomentSynthesis,
  Rhythm,
  SynthesisResponse,
} from '../types';
import { buildClusters, computeInputHash } from '../services/clusteringEngine';
import { shouldSurface, rankClusters } from '../services/cadenceEngine';
import {
  getRhythms,
  saveRhythm,
  deleteRhythm as deleteRhythmStorage,
  getAllMomentMeta,
  saveMomentMeta,
  getMomentSynthesis,
  saveMomentSynthesis,
} from '../services/storageService';
import { postProxy } from '../services/proxyService';

interface UseMomentsReturn {
  /** Clusters currently surfaced in the strip */
  surfacedMoments: MomentCluster[];
  /** All clusters (including non-surfaced) */
  allClusters: MomentCluster[];
  /** Rhythms */
  rhythms: Rhythm[];
  /** Load synthesis for a moment (cache-aware) */
  loadSynthesis: (cluster: MomentCluster, memories: Memory[]) => Promise<SynthesisResponse | null>;
  /** Current synthesis loading state */
  synthesisLoading: string | null;
  /** Mark a moment as viewed */
  markViewed: (momentId: string) => Promise<void>;
  /** Dismiss a moment */
  dismissMoment: (momentId: string) => Promise<void>;
  /** Set frequency override */
  setFrequencyOverride: (momentId: string, override: 'more' | 'less' | null) => Promise<void>;
  /** Add a new rhythm */
  addRhythm: (text: string, existingTags: string[], existingEntityTypes: string[]) => Promise<Rhythm | null>;
  /** Remove a rhythm */
  removeRhythm: (id: string) => Promise<void>;
  /** Toggle rhythm active state */
  toggleRhythm: (id: string) => Promise<void>;
  /** Meta map for UI state checks */
  metaMap: Map<string, MomentMeta>;
  /** Cached synthesis map */
  synthesesMap: Map<string, MomentSynthesis>;
}

export const useMoments = (memories: Memory[]): UseMomentsReturn => {
  const [rhythms, setRhythms] = useState<Rhythm[]>([]);
  const [metas, setMetas] = useState<MomentMeta[]>([]);
  const [synthesesMap, setSynthesesMap] = useState<Map<string, MomentSynthesis>>(new Map());
  const [synthesisLoading, setSynthesisLoading] = useState<string | null>(null);
  const loaded = useRef(false);

  // Load persisted data on mount
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    const loadData = async () => {
      try {
        const [loadedRhythms, loadedMetas] = await Promise.all([
          getRhythms(),
          getAllMomentMeta(),
        ]);
        setRhythms(loadedRhythms);
        setMetas(loadedMetas);
      } catch (err) {
        console.error('[Moments] Failed to load persisted data:', err);
      }
    };
    loadData();
  }, []);

  // Build meta map
  const metaMap = useMemo(() => {
    const map = new Map<string, MomentMeta>();
    for (const m of metas) {
      map.set(m.momentId, m);
    }
    return map;
  }, [metas]);

  // Compute all clusters (runs whenever memories or metas change)
  const allClusters = useMemo(() => {
    if (memories.length === 0) return [];
    return buildClusters(memories, metas);
  }, [memories, metas]);

  // Determine which clusters to surface right now
  const surfacedMoments = useMemo(() => {
    const now = new Date();
    const surfaced = allClusters.filter(c =>
      shouldSurface(c, rhythms, metaMap, now)
    );
    return rankClusters(surfaced, metaMap, now);
  }, [allClusters, rhythms, metaMap]);

  // Load synthesis (cache-aware)
  const loadSynthesis = useCallback(
    async (
      cluster: MomentCluster,
      currentMemories: Memory[]
    ): Promise<SynthesisResponse | null> => {
      const currentHash = computeInputHash(cluster.noteIds, currentMemories);

      // Check in-memory cache first
      const cached = synthesesMap.get(cluster.id);
      if (cached && cached.inputHash === currentHash) {
        return cached.content;
      }

      // Check IndexedDB
      const persisted = await getMomentSynthesis(cluster.id);
      if (persisted && persisted.inputHash === currentHash) {
        setSynthesesMap(prev => {
          const next = new Map(prev);
          next.set(cluster.id, persisted);
          return next;
        });
        return persisted.content;
      }

      // Cache miss — call server
      setSynthesisLoading(cluster.id);
      try {
        const notes = cluster.noteIds
          .map(id => currentMemories.find(m => m.id === id))
          .filter((m): m is Memory => !!m)
          .map(m => ({
            id: m.id,
            content: m.content,
            tags: m.tags,
            enrichment: m.enrichment
              ? {
                  summary: m.enrichment.summary,
                  locationContext: m.enrichment.locationContext,
                  temporalContext: m.enrichment.temporalContext,
                  entityContext: m.enrichment.entityContext,
                }
              : undefined,
          }));

        const synthesis = await postProxy<SynthesisResponse>('/api/synthesize', {
          notes,
          momentType: cluster.type,
          momentTitle: cluster.title,
          temporalWindow: cluster.clusterCriteria.temporalWindow || null,
        });

        const stored: MomentSynthesis = {
          momentId: cluster.id,
          inputHash: currentHash,
          content: synthesis,
          generatedAt: Date.now(),
          noteIds: cluster.noteIds,
        };

        await saveMomentSynthesis(stored);
        setSynthesesMap(prev => {
          const next = new Map(prev);
          next.set(cluster.id, stored);
          return next;
        });

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

  // Mark a moment as viewed
  const markViewed = useCallback(
    async (momentId: string) => {
      const existing = metaMap.get(momentId) || {
        momentId,
        dismissCount: 0,
        completedNoteIds: [],
      };
      const updated: MomentMeta = {
        ...existing,
        lastViewedAt: Date.now(),
      };
      await saveMomentMeta(updated);
      setMetas(prev =>
        prev.some(m => m.momentId === momentId)
          ? prev.map(m => (m.momentId === momentId ? updated : m))
          : [...prev, updated]
      );
    },
    [metaMap]
  );

  // Dismiss a moment
  const dismissMoment = useCallback(
    async (momentId: string) => {
      const existing = metaMap.get(momentId) || {
        momentId,
        dismissCount: 0,
        completedNoteIds: [],
      };
      const updated: MomentMeta = {
        ...existing,
        dismissCount: existing.dismissCount + 1,
        lastSurfacedAt: Date.now(),
      };
      await saveMomentMeta(updated);
      setMetas(prev =>
        prev.some(m => m.momentId === momentId)
          ? prev.map(m => (m.momentId === momentId ? updated : m))
          : [...prev, updated]
      );
    },
    [metaMap]
  );

  // Set frequency override
  const setFrequencyOverride = useCallback(
    async (momentId: string, override: 'more' | 'less' | null) => {
      const existing = metaMap.get(momentId) || {
        momentId,
        dismissCount: 0,
        completedNoteIds: [],
      };
      const updated: MomentMeta = {
        ...existing,
        frequencyOverride: override,
        dismissCount: 0, // Reset dismiss count on explicit preference
      };
      await saveMomentMeta(updated);
      setMetas(prev =>
        prev.some(m => m.momentId === momentId)
          ? prev.map(m => (m.momentId === momentId ? updated : m))
          : [...prev, updated]
      );
    },
    [metaMap]
  );

  // Add a new rhythm (calls parse-rhythm endpoint)
  const addRhythm = useCallback(
    async (
      text: string,
      existingTags: string[],
      existingEntityTypes: string[]
    ): Promise<Rhythm | null> => {
      try {
        const parsed = await postProxy<{
          matchers: Rhythm['parsed']['matchers'];
          cadence: Rhythm['parsed']['cadence'];
          inferredLabel: string;
        }>('/api/parse-rhythm', {
          text,
          existingTags,
          existingEntityTypes,
        });

        const rhythm: Rhythm = {
          id: crypto.randomUUID(),
          natural: text,
          parsed,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isActive: true,
        };

        await saveRhythm(rhythm);
        setRhythms(prev => [...prev, rhythm]);
        return rhythm;
      } catch (err) {
        console.error('[Moments] Failed to add rhythm:', err);
        return null;
      }
    },
    []
  );

  // Remove a rhythm
  const removeRhythm = useCallback(async (id: string) => {
    await deleteRhythmStorage(id);
    setRhythms(prev => prev.filter(r => r.id !== id));
  }, []);

  // Toggle rhythm active state
  const toggleRhythm = useCallback(
    async (id: string) => {
      const rhythm = rhythms.find(r => r.id === id);
      if (!rhythm) return;
      const updated = { ...rhythm, isActive: !rhythm.isActive, updatedAt: Date.now() };
      await saveRhythm(updated);
      setRhythms(prev => prev.map(r => (r.id === id ? updated : r)));
    },
    [rhythms]
  );

  return {
    surfacedMoments,
    allClusters,
    rhythms,
    loadSynthesis,
    synthesisLoading,
    markViewed,
    dismissMoment,
    setFrequencyOverride,
    addRhythm,
    removeRhythm,
    toggleRhythm,
    metaMap,
    synthesesMap,
  };
};
