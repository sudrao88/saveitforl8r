import { Memory, Moment, EMBEDDING_MODEL_ID } from '../types';
import { dot } from '../services/relatedMemories';

/**
 * Local vector matching for Moments.
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

/** Upper bound on notes shown for one moment. */
export const MAX_MOMENT_NOTES = 50;

/** Mirrors the server's validateMomentEmbedInput limits. */
export const MAX_MOMENT_TERMS = 10;
export const MAX_MOMENT_TERM_LENGTH = 200;

export interface MomentMatch {
  id: string;
  score: number;
}

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

/**
 * True when the moment should be (re-)embedded: no usable vectors yet, or
 * only the older term-only vectors without an intent vector.
 */
export const needsMomentEmbedding = (moment: Moment): boolean =>
  !isMomentEmbedded(moment) || !hasIntentVector(moment);

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

/**
 * Score every note against a moment and return the matches, best first.
 * Hidden notes (excludedNoteIds) are left out.
 */
export const matchNotesToMoment = (
  moment: Moment,
  memories: Memory[],
  limit: number = MAX_MOMENT_NOTES,
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
