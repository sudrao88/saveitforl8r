/**
 * useMoments.ts
 *
 * Moments are saved semantic searches. The user enters a few terms; the server
 * reads them together into one intent vector and also embeds each term (same
 * model as notes), and both are stored, with an emoji, on the moment. Matching notes are computed here, locally, from the
 * synced note vectors — so a moment updates live as notes are added, edited,
 * synced or deleted, works offline once embedded, and shows the same notes on
 * every device without the matches themselves being synced.
 *
 * A moment created offline (or whose embed request failed, or a legacy moment
 * migrated from the old agentic flow) is saved without vectors and embedded as
 * soon as the app is back online. A moment embedded before intent vectors
 * existed keeps matching by its terms and is quietly re-embedded to gain one.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Memory, Moment, EMBEDDING_MODEL_ID } from '../types';
import { getMoments, getMoment, saveMoment } from '../services/storageService';
import { embedMomentTerms } from '../services/geminiService';
import {
  isMomentEmbedded,
  needsMomentEmbedding,
  matchNotesToMoment,
  explainMomentMatch,
  MAX_MOMENT_NOTES,
  MomentMatch,
} from '../utils/momentMatching';

// After a failed embed, wait this long before retrying the same moment so a
// persistent error (signed out, rate limited) doesn't fire on every refresh.
const EMBED_RETRY_DELAY_MS = 60_000;

// Set localStorage 'debug:moments' to '1' to log, for every moment, each
// shown note's scores (blended / intent / best term) plus the notes hidden by
// the user and the closest ones that fell below the cutoff — for tuning the
// matching constants.
const isMomentDebugOn = (): boolean => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('debug:moments') === '1';
  } catch {
    return false;
  }
};

/** How many of the best below-cutoff notes to include, to show the margin. */
export const DEBUG_NEAR_MISSES = 15;

const fmt = (n: number | null | undefined) => (typeof n === 'number' ? n.toFixed(3) : '—');

const logMomentScores = (moment: Moment, memories: Memory[]) => {
  const report = explainMomentMatch(moment, memories);
  const byId = new Map(memories.map(m => [m.id, m]));
  const shownCount = report.rows.filter(r => r.status === 'shown').length;
  const hiddenCount = report.rows.filter(r => r.status === 'hidden').length;
  const overLimit = report.rows.filter(r => r.status === 'over-limit').length;
  let nearMisses = 0;
  const rows = report.rows
    .filter(r => r.status !== 'below-cutoff' || nearMisses++ < DEBUG_NEAR_MISSES)
    .map((r, i) => {
      const note = byId.get(r.id);
      return {
        rank: i + 1,
        status: r.status,
        note: (note?.enrichment?.entityContext?.title || note?.content || r.id).slice(0, 60),
        score: fmt(r.score),
        intent: fmt(r.intent),
        term: fmt(r.term),
        id: r.id,
      };
    });
  console.groupCollapsed(
    `[Moments] ${moment.emoji ?? ''} ${moment.title}: ${shownCount} shown, ${hiddenCount} hidden` +
      (overLimit ? `, ${overLimit} over the ${MAX_MOMENT_NOTES}-note cap` : '') + ' — ' +
      `mode ${report.mode}, best ${fmt(report.best)}, cutoff ${fmt(report.cutoff)}, ` +
      `${report.rows.length} notes scored`,
  );
  console.table(rows);
  console.groupEnd();
};

interface UseMomentsReturn {
  /** All active moments, newest first */
  moments: Moment[];
  /** Matching notes per moment id, best match first */
  matchesByMoment: Map<string, MomentMatch[]>;
  /** Create a moment from its terms. Embeds right away when online. */
  createNewMoment: (terms: string[]) => Promise<Moment | null>;
  /** True while a create call is in progress */
  creating: boolean;
  /** Moment ids whose terms are being embedded right now */
  embeddingIds: Set<string>;
  /** Retry embedding a moment that's waiting for its vectors */
  retryEmbedding: (momentId: string) => Promise<void>;
  /** Hide a matched note from a moment (synced) */
  hideNoteInMoment: (momentId: string, noteId: string) => Promise<void>;
  /** Soft-delete a moment */
  deleteMoment: (momentId: string) => Promise<void>;
  /** Set the callback that syncs a changed moment to Drive */
  setOnMomentChanged: (cb: (moment: Moment) => void) => void;
  /** Reload moments from IndexedDB (e.g. after sync) */
  refreshMoments: () => Promise<void>;
}

export const useMoments = (memories: Memory[]): UseMomentsReturn => {
  const [momentsList, setMomentsList] = useState<Moment[]>([]);
  const [creating, setCreating] = useState(false);
  const [embeddingIds, setEmbeddingIds] = useState<Set<string>>(new Set());

  const loaded = useRef(false);
  const onMomentChangedRef = useRef<((moment: Moment) => void) | undefined>(undefined);
  const inFlightEmbeds = useRef<Set<string>>(new Set());
  const lastEmbedFailure = useRef<Map<string, number>>(new Map());
  // Set once the proxy answers without an intent vector (an older server):
  // stop trying to upgrade term-only moments for the rest of the session.
  const proxyLacksIntent = useRef(false);

  const setOnMomentChanged = useCallback((cb: (moment: Moment) => void) => {
    onMomentChangedRef.current = cb;
  }, []);

  const replaceInList = useCallback((moment: Moment) => {
    setMomentsList(prev => {
      const exists = prev.some(m => m.id === moment.id);
      if (moment.isDeleted) return prev.filter(m => m.id !== moment.id);
      return exists ? prev.map(m => (m.id === moment.id ? moment : m)) : [...prev, moment];
    });
  }, []);

  // Embed one moment's terms and persist the vectors + emoji. Re-reads the
  // latest record first so a moment deleted meanwhile (locally or via sync)
  // isn't resurrected. Returns the saved moment, or null if it didn't embed.
  const embedMoment = useCallback(async (momentId: string): Promise<Moment | null> => {
    if (inFlightEmbeds.current.has(momentId)) return null;
    inFlightEmbeds.current.add(momentId);
    try {
      const current = await getMoment(momentId);
      if (!current || current.isDeleted || current.terms.length === 0) return null;
      if (!needsMomentEmbedding(current)) return current;
      // A moment that already matches by its terms is being upgraded in the
      // background — don't show it as "creating".
      const upgrading = isMomentEmbedded(current);
      if (upgrading && proxyLacksIntent.current) return current;
      if (!upgrading) setEmbeddingIds(prev => new Set(prev).add(momentId));

      const result = await embedMomentTerms(current.terms);

      const latest = await getMoment(momentId);
      if (!latest || latest.isDeleted) return null;
      // Another device may have upgraded it (and synced) meanwhile — keep that.
      if (!needsMomentEmbedding(latest)) return latest;
      if (!result.intentVector) {
        proxyLacksIntent.current = true;
        // Nothing new for a moment that already had term vectors: don't
        // rewrite or re-sync it.
        if (isMomentEmbedded(latest)) return latest;
      }
      const updated: Moment = {
        ...latest,
        termVectors: result.vectors,
        embeddingModel: result.model || EMBEDDING_MODEL_ID,
        // Keep an existing emoji so re-embedding an older moment doesn't
        // change how it looks.
        emoji: latest.emoji || result.emoji,
        updatedAt: Date.now(),
      };
      if (result.intentVector) updated.intentVector = result.intentVector;
      else delete updated.intentVector;
      await saveMoment(updated);
      replaceInList(updated);
      onMomentChangedRef.current?.(updated);
      lastEmbedFailure.current.delete(momentId);
      return updated;
    } catch (err) {
      lastEmbedFailure.current.set(momentId, Date.now());
      console.warn(`[Moments] Embedding failed for ${momentId} (will retry when online):`, err);
      return null;
    } finally {
      inFlightEmbeds.current.delete(momentId);
      setEmbeddingIds(prev => {
        if (!prev.has(momentId)) return prev;
        const next = new Set(prev);
        next.delete(momentId);
        return next;
      });
    }
  }, [replaceInList]);

  // Embed every moment that's still waiting for vectors (created offline, a
  // failed request, a legacy moment, vectors from a superseded model, or
  // term-only vectors from before intent vectors existed).
  const embedPending = useCallback(async (list: Moment[]) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const now = Date.now();
    for (const m of list) {
      if (m.isDeleted || !needsMomentEmbedding(m)) continue;
      if (proxyLacksIntent.current && isMomentEmbedded(m)) continue;
      const failedAt = lastEmbedFailure.current.get(m.id);
      if (failedAt && now - failedAt < EMBED_RETRY_DELAY_MS) continue;
      await embedMoment(m.id);
    }
  }, [embedMoment]);

  const refreshMoments = useCallback(async () => {
    try {
      const loadedMoments = await getMoments();
      setMomentsList(loadedMoments);
      embedPending(loadedMoments);
    } catch (err) {
      console.error('[Moments] Failed to refresh moments:', err);
    }
  }, [embedPending]);

  // Load persisted moments on mount
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    refreshMoments();
  }, [refreshMoments]);

  // Back online → embed anything created while offline
  const momentsListRef = useRef<Moment[]>([]);
  useEffect(() => { momentsListRef.current = momentsList; }, [momentsList]);
  useEffect(() => {
    const onOnline = () => {
      lastEmbedFailure.current.clear();
      embedPending(momentsListRef.current);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [embedPending]);

  const createNewMoment = useCallback(async (terms: string[]): Promise<Moment | null> => {
    const clean = terms.map(t => t.trim()).filter(Boolean);
    if (clean.length === 0) return null;
    setCreating(true);
    try {
      const now = Date.now();
      const moment: Moment = {
        id: crypto.randomUUID(),
        title: clean.join(', '),
        terms: clean,
        createdAt: now,
        updatedAt: now,
      };
      await saveMoment(moment);
      replaceInList(moment);

      // Embed straight away when we can; otherwise it stays waiting and the
      // online listener / next refresh picks it up.
      const embedded = navigator.onLine === false ? null : await embedMoment(moment.id);
      if (embedded) return embedded;

      onMomentChangedRef.current?.(moment);
      return moment;
    } catch (err) {
      console.error('[Moments] Failed to create moment:', err);
      return null;
    } finally {
      setCreating(false);
    }
  }, [embedMoment, replaceInList]);

  const retryEmbedding = useCallback(async (momentId: string): Promise<void> => {
    lastEmbedFailure.current.delete(momentId);
    await embedMoment(momentId);
  }, [embedMoment]);

  const hideNoteInMoment = useCallback(async (momentId: string, noteId: string): Promise<void> => {
    const latest = await getMoment(momentId);
    if (!latest || latest.isDeleted) return;
    const excluded = latest.excludedNoteIds || [];
    if (excluded.includes(noteId)) return;
    const updated: Moment = {
      ...latest,
      excludedNoteIds: [...excluded, noteId],
      updatedAt: Date.now(),
    };
    await saveMoment(updated);
    replaceInList(updated);
    onMomentChangedRef.current?.(updated);
  }, [replaceInList]);

  // Soft-delete, then sync. The sync layer (performMomentSync) deletes the
  // Drive file and hard-deletes the local tombstone.
  const deleteMoment = useCallback(async (momentId: string): Promise<void> => {
    const latest = await getMoment(momentId);
    if (!latest) return;
    const tombstone: Moment = { ...latest, isDeleted: true, updatedAt: Date.now() };
    await saveMoment(tombstone);
    replaceInList(tombstone);
    onMomentChangedRef.current?.(tombstone);
  }, [replaceInList]);

  const moments = useMemo(
    () => momentsList.filter(m => !m.isDeleted).sort((a, b) => b.createdAt - a.createdAt),
    [momentsList]
  );

  const matchesByMoment = useMemo(() => {
    const map = new Map<string, MomentMatch[]>();
    const debug = isMomentDebugOn();
    for (const m of moments) {
      const matches = matchNotesToMoment(m, memories);
      map.set(m.id, matches);
      if (debug) logMomentScores(m, memories);
    }
    return map;
  }, [moments, memories]);

  return {
    moments,
    matchesByMoment,
    createNewMoment,
    creating,
    embeddingIds,
    retryEmbedding,
    hideNoteInMoment,
    deleteMoment,
    setOnMomentChanged,
    refreshMoments,
  };
};
