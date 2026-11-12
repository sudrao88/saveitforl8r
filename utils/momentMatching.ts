import { Memory, Moment, EMBEDDING_MODEL_ID } from '../types';
import { dot } from '../services/relatedMemories';

/**
 * Local vector matching for Moments.
 *
 * A moment holds one vector per term; each note holds one synced vector. A
 * note's score for a moment is its best similarity to ANY of the terms, so a
 * moment like ["Singapore", "hawker food"] picks up notes about either. Every
 * device holds the same vectors and runs this same deterministic ranking, so
 * matches are identical everywhere without being synced.
 *
 * Dependency-free (beyond pure helpers) so it runs unchanged in unit tests.
 */

/**
 * Notes scoring below this are not shown. Lower than Related Memories' 0.6
 * because a short term compared against a whole note scores lower than two
 * notes compared with each other. Tune against real data if matches look too
 * loose or too sparse.
 */
export const MOMENT_MIN_SIMILARITY = 0.5;

/** Upper bound on notes shown for one moment. */
export const MAX_MOMENT_NOTES = 50;

/** Mirrors the server's validateMomentEmbedInput limits. */
export const MAX_MOMENT_TERMS = 10;
export const MAX_MOMENT_TERM_LENGTH = 200;

export interface MomentMatch {
  id: string;
  score: number;
}

/** True when the moment has usable vectors from the current embedding model. */
export const isMomentEmbedded = (moment: Moment): boolean =>
  Array.isArray(moment.termVectors) &&
  moment.termVectors.length > 0 &&
  moment.termVectors.length === moment.terms.length &&
  moment.embeddingModel === EMBEDDING_MODEL_ID;

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
 * Score every note against a moment and return the matches, best first.
 * Hidden notes (excludedNoteIds) are left out.
 */
export const matchNotesToMoment = (
  moment: Moment,
  memories: Memory[],
  minScore: number = MOMENT_MIN_SIMILARITY,
  limit: number = MAX_MOMENT_NOTES,
): MomentMatch[] => {
  if (!isMomentEmbedded(moment)) return [];
  const termVectors = moment.termVectors!;
  const excluded = new Set(moment.excludedNoteIds || []);
  const matches: MomentMatch[] = [];

  for (const m of memories) {
    if (excluded.has(m.id)) continue;
    const v = noteVector(m);
    if (!v) continue;
    let best = -Infinity;
    for (const tv of termVectors) {
      if (tv.length !== v.length) continue;
      const s = dot(tv, v);
      if (s > best) best = s;
    }
    if (best >= minScore) matches.push({ id: m.id, score: best });
  }

  matches.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
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
