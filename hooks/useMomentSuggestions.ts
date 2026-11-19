/**
 * useMomentSuggestions.ts
 *
 * Suggested moments: keywords shared by a cluster of at least three similar
 * notes (utils/momentSuggestions.ts). Computed locally from the same note
 * index the user's moments use. Dismissed suggestions are remembered on this
 * device.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Moment } from '../types';
import { MomentMatch, MomentNoteIndex } from '../utils/momentMatching';
import { suggestMoments, MomentSuggestion } from '../utils/momentSuggestions';

export const DISMISSED_SUGGESTIONS_KEY = 'moments:dismissedSuggestions';

const readDismissed = (): Set<string> => {
  try {
    const raw = localStorage.getItem(DISMISSED_SUGGESTIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
};

const writeDismissed = (keys: Set<string>) => {
  try {
    localStorage.setItem(DISMISSED_SUGGESTIONS_KEY, JSON.stringify([...keys]));
  } catch {
    // Storage unavailable (private mode, quota): the dismissal lasts this session.
  }
};

const isDebugOn = (): boolean => {
  try {
    return localStorage.getItem('debug:moments') === '1';
  } catch {
    return false;
  }
};

interface UseMomentSuggestionsReturn {
  suggestions: MomentSuggestion[];
  dismissSuggestion: (key: string) => void;
}

export const useMomentSuggestions = (
  noteIndex: MomentNoteIndex,
  moments: Moment[],
  matchesByMoment: Map<string, MomentMatch[]>,
  enabled: boolean = true,
): UseMomentSuggestionsReturn => {
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);

  const suggestions = useMemo(
    () => (enabled ? suggestMoments(noteIndex, moments, matchesByMoment, dismissed) : []),
    [enabled, noteIndex, moments, matchesByMoment, dismissed],
  );

  useEffect(() => {
    if (!isDebugOn()) return;
    for (const s of suggestions) {
      console.groupCollapsed(`[Moments] Suggested "${s.label}": ${s.matches.length} notes, cluster of ${s.clusterIds.length}`);
      console.table(s.matches.map((m, i) => ({
        rank: i + 1,
        inCluster: s.clusterIds.includes(m.id),
        matched: m.matched?.join(' + '),
        score: m.score.toFixed(4),
        id: m.id,
      })));
      console.groupEnd();
    }
  }, [suggestions]);

  const dismissSuggestion = useCallback((key: string) => {
    setDismissed(prev => {
      if (prev.has(key)) return prev;
      const next = new Set(prev).add(key);
      writeDismissed(next);
      return next;
    });
  }, []);

  return { suggestions, dismissSuggestion };
};
