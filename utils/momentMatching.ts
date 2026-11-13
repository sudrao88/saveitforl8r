import { Memory, Moment, EMBEDDING_MODEL_ID } from '../types';
import { dot } from '../services/relatedMemories';
import { buildKeywordIndex, KeywordIndex, prepareConcepts, scoreConcepts } from './keywordMatching';

/**
 * Local matching for Moments.
 *
 * Hybrid (moments with concepts). The server turns a moment's terms into 1-3
 * required concepts with synonyms. A note qualifies only when its enriched
 * fields mention every concept (keywordMatching.ts) — so "Fashion tips" can't
 * pick up a wedding reminder and "Cafes in bangalore" can't pick up a shoe
 * brand, however close their vectors happen to be. Qualifying notes are then
 * ranked by reciprocal rank fusion of their keyword score and their vector
 * similarity, and each match records the words it matched on.
 *
 * Embedding-only (moments created before concepts existed, until useMoments
 * re-embeds them), described below.
 *
 * A moment carries an intent vector (its terms read together and expanded
 * server-side into a note-shaped description of the theme) and one vector per
 * term; each note holds one synced vector.
 *
 * Score = INTENT_WEIGHT * sim(intent, note) + TERM_WEIGHT * best sim(term, note).
 * The intent dominates, so a note has to fit what the moment means as a whole
 * — for ["Singapore", "hawker food"] a laksa stall ranks high, an airport
 * layover does not just because it says "Singapore". The term part still
 * rewards notes that strongly match one specific term.
 *
 * Short-query-vs-note similarities sit in a narrow band that shifts from one
 * moment to another, so the cutoff is relative: keep notes within
 * RELATIVE_MARGIN of the moment's best match, never below an absolute floor.
 *
 * Moments embedded before intent vectors existed fall back to the old rule
 * (best term similarity) until useMoments re-embeds them.
 *
 * Every device holds the same vectors and runs this same deterministic
 * ranking, so matches are identical everywhere without being synced.
 * Dependency-free (beyond pure helpers) so it runs unchanged in unit tests.
 */

/** Share of the score that comes from the whole-moment intent vector. */
export const INTENT_WEIGHT = 0.75;
/** Share of the score that comes from the best single term. */
export const TERM_WEIGHT = 1 - INTENT_WEIGHT;

/**
 * Absolute floor: notes scoring below this are never shown. Note-shaped intent
 * vectors score closer to note-vs-note similarity (Related Memories uses 0.6)
 * than bare terms did. Tune against real data if matches look too loose or
 * too sparse.
 */
export const MOMENT_MIN_SIMILARITY = 0.5;

/** Notes more than this far below the moment's best match are dropped. */
export const MOMENT_RELATIVE_MARGIN = 0.15;

/** Reciprocal rank fusion constant (the standard 60). */
export const RRF_K = 60;

/** Upper bound on notes shown for one moment. */
export const MAX_MOMENT_NOTES = 50;

/** Mirrors the server's validateMomentEmbedInput limits. */
export const MAX_MOMENT_TERMS = 10;
export const MAX_MOMENT_TERM_LENGTH = 200;

export interface MomentMatch {
  id: string;
  score: number;
  /** Hybrid moments: the word that matched each concept, e.g. ["cafe", "bengaluru"]. */
  matched?: string[];
}

/**
 * Everything matching needs from the notes, prepared once per change to the
 * notes and shared by every moment.
 */
export interface MomentNoteIndex {
  memories: Memory[];
  byId: Map<string, Memory>;
  keyword: KeywordIndex;
}

export const buildMomentNoteIndex = (memories: Memory[]): MomentNoteIndex => ({
  memories,
  byId: new Map(memories.map(m => [m.id, m])),
  keyword: buildKeywordIndex(memories),
});

const asIndex = (notes: Memory[] | MomentNoteIndex): MomentNoteIndex =>
  Array.isArray(notes) ? buildMomentNoteIndex(notes) : notes;

/** Score parts for one note, for debugging/tuning. */
export interface MomentScore {
  score: number;
  intent: number | null;
  term: number;
}

/**
 * True when the moment has usable term vectors from the current embedding
 * model, i.e. it can match notes (with or without an intent vector).
 */
export const isMomentEmbedded = (moment: Moment): boolean =>
  Array.isArray(moment.termVectors) &&
  moment.termVectors.length > 0 &&
  moment.termVectors.length === moment.terms.length &&
  moment.embeddingModel === EMBEDDING_MODEL_ID;

/** True when the moment also has its whole-moment intent vector. */
export const hasIntentVector = (moment: Moment): boolean =>
  Array.isArray(moment.intentVector) && moment.intentVector.length > 0;

/** True when the moment has keyword concepts (hybrid matching). */
export const hasConcepts = (moment: Moment): boolean =>
  Array.isArray(moment.concepts) &&
  moment.concepts.length > 0 &&
  moment.concepts.every(c => Array.isArray(c) && c.length > 0);

/**
 * True when the moment can show matches: it has usable vectors, or keyword
 * concepts (which match even while its vectors are being refreshed, e.g.
 * after an embedding-model change). False means it's still being set up.
 */
export const canMatchMoment = (moment: Moment): boolean =>
  isMomentEmbedded(moment) || hasConcepts(moment);

/**
 * True when the moment should be (re-)embedded: no usable vectors yet, or
 * older vectors without an intent vector or keyword concepts.
 */
export const needsMomentEmbedding = (moment: Moment): boolean =>
  !isMomentEmbedded(moment) || !hasIntentVector(moment) || !hasConcepts(moment);

const noteVector = (m: Memory): number[] | null => {
  if (m.isDeleted) return null;
  const v = m.enrichment?.embedding;
  if (!Array.isArray(v) || v.length === 0) return null;
  // Vectors from a superseded model live in a different space — skip until
  // useRelatedEmbeddingBackfill re-embeds the note.
  if (m.enrichment?.embeddingModel !== EMBEDDING_MODEL_ID) return null;
  return v;
};

/**
 * Score one note vector against an embedded moment. Returns null when the
 * vectors aren't comparable (dimension mismatch) — including an intent vector
 * of another size, so every score for a moment is on the same scale.
 */
export const scoreNoteForMoment = (moment: Moment, v: number[]): MomentScore | null => {
  let term = -Infinity;
  for (const tv of moment.termVectors || []) {
    if (tv.length !== v.length) continue;
    const s = dot(tv, v);
    if (s > term) term = s;
  }
  if (!hasIntentVector(moment)) {
    return term === -Infinity ? null : { score: term, intent: null, term };
  }
  const iv = moment.intentVector!;
  if (iv.length !== v.length) return null;
  const intent = dot(iv, v);
  if (term === -Infinity) return { score: intent, intent, term: intent };
  return { score: INTENT_WEIGHT * intent + TERM_WEIGHT * term, intent, term };
};

/** One qualifying note in a hybrid match, before the cap. */
interface HybridCandidate {
  id: string;
  keyword: number;
  semantic: number | null;
  matched: string[];
  score: number;
}

/**
 * Hybrid match: notes that hit every concept, ranked by reciprocal rank
 * fusion of keyword score and vector similarity. Includes hidden notes (the
 * caller filters them) so the debug report can show them.
 */
const hybridCandidates = (moment: Moment, index: MomentNoteIndex): HybridCandidate[] => {
  const concepts = prepareConcepts(moment.concepts!);
  const qualifying = scoreConcepts(index.keyword, concepts).filter(r => r.hits.every(Boolean));
  const cands: HybridCandidate[] = qualifying.map(r => {
    const v = index.byId.get(r.id);
    const vec = v ? noteVector(v) : null;
    const sem = vec && isMomentEmbedded(moment) ? scoreNoteForMoment(moment, vec) : null;
    return { id: r.id, keyword: r.score, semantic: sem?.score ?? null, matched: r.hits.map(h => h!.synonym), score: 0 };
  });

  const rank = (key: (c: HybridCandidate) => number) => {
    const order = [...cands].sort((a, b) => key(b) - key(a) || (a.id < b.id ? -1 : 1));
    return new Map(order.map((c, i) => [c.id, i + 1]));
  };
  const kwRank = rank(c => c.keyword);
  const semRank = rank(c => c.semantic ?? -Infinity);
  for (const c of cands) c.score = 1 / (RRF_K + kwRank.get(c.id)!) + 1 / (RRF_K + semRank.get(c.id)!);
  return cands.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
};

/**
 * Score every note against a moment and return the matches, best first.
 * Hidden notes (excludedNoteIds) are left out. Pass a prebuilt
 * MomentNoteIndex to share the per-note work across moments.
 */
export const matchNotesToMoment = (
  moment: Moment,
  notes: Memory[] | MomentNoteIndex,
  limit: number = MAX_MOMENT_NOTES,
): MomentMatch[] => {
  const index = asIndex(notes);
  if (hasConcepts(moment)) {
    const excluded = new Set(moment.excludedNoteIds || []);
    return hybridCandidates(moment, index)
      .filter(c => !excluded.has(c.id))
      .slice(0, limit)
      .map(c => ({ id: c.id, score: c.score, matched: c.matched }));
  }
  return matchByEmbedding(moment, index.memories, limit);
};

/**
 * Embedding-only match for moments without concepts: blended similarity with
 * a fixed floor and, for intent moments, a margin below the best match.
 */
const matchByEmbedding = (
  moment: Moment,
  memories: Memory[],
  limit: number,
): MomentMatch[] => {
  if (!isMomentEmbedded(moment)) return [];
  const useIntent = hasIntentVector(moment);
  const excluded = new Set(moment.excludedNoteIds || []);
  const matches: MomentMatch[] = [];

  for (const m of memories) {
    if (excluded.has(m.id)) continue;
    const v = noteVector(m);
    if (!v) continue;
    const s = scoreNoteForMoment(moment, v);
    if (s && s.score >= MOMENT_MIN_SIMILARITY) matches.push({ id: m.id, score: s.score });
  }

  matches.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  if (useIntent && matches.length > 0) {
    const cutoff = matches[0].score - MOMENT_RELATIVE_MARGIN;
    const kept = matches.filter(m => m.score >= cutoff);
    return kept.slice(0, limit);
  }
  return matches.slice(0, limit);
};

/** One note in a moment's debug breakdown. */
export interface MomentDebugRow {
  id: string;
  /** Ranking score (RRF for hybrid moments, blended similarity otherwise). */
  score: number;
  /** Blended vector similarity and its intent / best-term parts. */
  semantic: number | null;
  intent: number | null;
  term: number | null;
  /** Hybrid only: keyword (BM25) score and the word matched per concept ("✗" = missed). */
  keyword: number | null;
  matched: string | null;
  /**
   * shown = in the moment; hidden = the user hid it; over-limit = qualified
   * but past the MAX_MOMENT_NOTES cap; partial = hit some concepts but not
   * all (hybrid); below-cutoff = scored too low (embedding-only).
   */
  status: 'shown' | 'hidden' | 'over-limit' | 'partial' | 'below-cutoff';
}

export interface MomentDebugReport {
  mode: 'hybrid' | 'intent' | 'term-only' | 'not-embedded';
  /** Hybrid: the concepts a note must all match. */
  concepts: string[][] | null;
  /** Embedding-only: score a note needed (null when nothing qualified). */
  cutoff: number | null;
  rows: MomentDebugRow[];
}

/**
 * Score every note against a moment and label each one, for the debug log.
 * Statuses come from matchNotesToMoment itself, so the report can't drift
 * from what the moment actually shows. Rows are best first.
 */
export const explainMomentMatch = (moment: Moment, notes: Memory[] | MomentNoteIndex): MomentDebugReport => {
  const index = asIndex(notes);
  const excluded = new Set(moment.excludedNoteIds || []);
  const shown = new Set(matchNotesToMoment(moment, index).map(m => m.id));
  const statusOf = (id: string, qualifies: boolean): MomentDebugRow['status'] =>
    excluded.has(id) ? 'hidden'
      : shown.has(id) ? 'shown'
      : qualifies ? 'over-limit'
      : 'partial';

  if (hasConcepts(moment)) {
    const qualified = hybridCandidates(moment, index);
    const qualifiedIds = new Set(qualified.map(c => c.id));
    const semanticOf = (id: string) => {
      const m = index.byId.get(id);
      const v = m ? noteVector(m) : null;
      return v && isMomentEmbedded(moment) ? scoreNoteForMoment(moment, v) : null;
    };
    const rows: MomentDebugRow[] = qualified.map(c => {
      const sem = semanticOf(c.id);
      return {
        id: c.id, score: c.score, semantic: sem?.score ?? null, intent: sem?.intent ?? null, term: sem?.term ?? null,
        keyword: c.keyword, matched: c.matched.join(' + '), status: statusOf(c.id, true),
      };
    });
    const partial = scoreConcepts(index.keyword, prepareConcepts(moment.concepts!))
      .filter(r => !qualifiedIds.has(r.id))
      .sort((a, b) => b.hits.filter(Boolean).length - a.hits.filter(Boolean).length || b.score - a.score);
    for (const r of partial) {
      const sem = semanticOf(r.id);
      rows.push({
        id: r.id, score: 0, semantic: sem?.score ?? null, intent: sem?.intent ?? null, term: sem?.term ?? null,
        keyword: r.score, matched: r.hits.map(h => h?.synonym ?? '✗').join(' + '), status: statusOf(r.id, false),
      });
    }
    return { mode: 'hybrid', concepts: moment.concepts!, cutoff: null, rows };
  }

  if (!isMomentEmbedded(moment)) return { mode: 'not-embedded', concepts: null, cutoff: null, rows: [] };
  const useIntent = hasIntentVector(moment);
  const passing = new Set(matchByEmbedding(moment, index.memories, Infinity).map(m => m.id));
  const rows: MomentDebugRow[] = [];
  for (const m of index.memories) {
    const v = noteVector(m);
    if (!v) continue;
    const s = scoreNoteForMoment(moment, v);
    if (!s) continue;
    const status = excluded.has(m.id) ? 'hidden'
      : shown.has(m.id) ? 'shown'
      : passing.has(m.id) ? 'over-limit'
      : 'below-cutoff';
    rows.push({
      id: m.id, score: s.score, semantic: s.score, intent: s.intent, term: s.term,
      keyword: null, matched: null, status,
    });
  }
  rows.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));

  // Mirror matchByEmbedding's cutoff for display.
  const best = rows.find(r => r.status !== 'hidden' && r.score >= MOMENT_MIN_SIMILARITY)?.score ?? null;
  const cutoff = best === null
    ? null
    : useIntent ? Math.max(MOMENT_MIN_SIMILARITY, best - MOMENT_RELATIVE_MARGIN) : MOMENT_MIN_SIMILARITY;
  return { mode: useIntent ? 'intent' : 'term-only', concepts: null, cutoff, rows };
};

/**
 * Split the creation input into terms: commas or new lines separate terms,
 * whitespace is collapsed, and duplicates (case-insensitive) are dropped.
 */
export const parseMomentTerms = (input: string): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const t = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_MOMENT_TERM_LENGTH);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_MOMENT_TERMS) break;
  }
  return out;
};
