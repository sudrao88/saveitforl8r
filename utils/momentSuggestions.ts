import { Moment, EMBEDDING_MODEL_ID } from '../types';
import { dot, MIN_SIMILARITY } from '../services/relatedMemories';
import { GENERIC_KEYWORDS, prepareConcepts, scoreConcepts, tokenize } from './keywordMatching';
import { matchNotesToMoment, MomentMatch, MomentNoteIndex, noteVector } from './momentMatching';

/**
 * Suggested moments.
 *
 * A keyword is suggested as a moment when at least MIN_SUGGESTION_NOTES notes
 *  1. share it (a tag, AI-suggested tag or entity type), and
 *  2. form a cluster by embeddings: linked by note-to-note similarity of at
 *     least MIN_SIMILARITY (the Related Memories threshold).
 *
 * The notes a suggestion shows come from the same matcher a typed moment
 * uses: a draft moment with the keyword as its one concept and the cluster's
 * centroid as its vectors is run through matchNotesToMoment (keyword gate,
 * then reciprocal rank fusion). A note qualifies for the keyword exactly as
 * it would for a moment (scoreConcepts), so a keyword found only in a note's
 * title or summary counts too.
 *
 * Everything is local and deterministic, so every device suggests the same
 * moments.
 */

/** A suggestion needs at least this many clustered notes. */
export const MIN_SUGGESTION_NOTES = 3;

/** At most this many suggestions are shown at once. */
export const MAX_SUGGESTIONS = 3;

/**
 * A suggestion is dropped when this share of its notes already sit in an
 * existing moment or a higher-ranked suggestion.
 */
export const SUGGESTION_OVERLAP = 0.8;

/** Only the most widely shared keywords are clustered, to bound the work. */
export const MAX_CANDIDATE_KEYWORDS = 40;

/** Notes considered per keyword when clustering (most recent first). */
export const MAX_CLUSTER_NOTES = 200;

export interface MomentSuggestion {
  /** Normalized keyword (tokens joined), used for dismissal. */
  key: string;
  /** Display label, the keyword as users wrote it most often. */
  label: string;
  /** The draft moment the matches were computed from. */
  draft: Moment;
  /** Exactly what matchNotesToMoment returns for the draft, best first. */
  matches: MomentMatch[];
  /** The embedding cluster that triggered the suggestion. */
  clusterIds: string[];
}

interface Candidate {
  key: string;
  /** Spelling → how many notes used it, for the label. */
  spellings: Map<string, number>;
  noteIds: Set<string>;
}

/** Normalized key for a keyword, or null when it can't be suggested. */
export const suggestionKey = (text: string): string | null => {
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;
  if (tokens.every(t => GENERIC_KEYWORDS.has(t) || t.length < 2 || /^\p{N}+$/u.test(t))) return null;
  return tokens.join(' ');
};

const collectCandidates = (index: MomentNoteIndex): Candidate[] => {
  const byKey = new Map<string, Candidate>();
  for (const m of index.memories) {
    if (m.isDeleted) continue;
    const words = [
      ...(m.tags || []),
      ...(m.enrichment?.suggestedTags || []),
      m.enrichment?.entityContext?.type || '',
    ];
    const seen = new Set<string>();
    for (const raw of words) {
      const label = String(raw).replace(/^#/, '').replace(/\s+/g, ' ').trim();
      const key = label ? suggestionKey(label) : null;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      let c = byKey.get(key);
      if (!c) {
        c = { key, spellings: new Map(), noteIds: new Set() };
        byKey.set(key, c);
      }
      c.noteIds.add(m.id);
      c.spellings.set(label, (c.spellings.get(label) ?? 0) + 1);
    }
  }
  return [...byKey.values()]
    .filter(c => c.noteIds.size >= MIN_SUGGESTION_NOTES)
    .sort((a, b) => b.noteIds.size - a.noteIds.size || (a.key < b.key ? -1 : 1))
    .slice(0, MAX_CANDIDATE_KEYWORDS);
};

const pickLabel = (spellings: Map<string, number>): string =>
  [...spellings.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];

/**
 * Largest connected component of notes linked by similarity >= MIN_SIMILARITY.
 * Ties go to the component holding the smallest id, so the result is stable.
 */
export const largestCluster = (
  vectors: { id: string; v: number[] }[],
  sim: (a: { id: string; v: number[] }, b: { id: string; v: number[] }) => number,
): string[] => {
  const sorted = [...vectors].sort((a, b) => (a.id < b.id ? -1 : 1));
  const seen = new Set<string>();
  let best: string[] = [];
  for (const start of sorted) {
    if (seen.has(start.id)) continue;
    const component: string[] = [];
    const stack = [start];
    seen.add(start.id);
    while (stack.length) {
      const cur = stack.pop()!;
      component.push(cur.id);
      for (const other of sorted) {
        if (seen.has(other.id)) continue;
        if (sim(cur, other) >= MIN_SIMILARITY) {
          seen.add(other.id);
          stack.push(other);
        }
      }
    }
    if (component.length > best.length) best = component;
  }
  return best.sort();
};

const centroid = (vs: number[][]): number[] => {
  const out = new Array(vs[0].length).fill(0);
  for (const v of vs) for (let i = 0; i < v.length; i++) out[i] += v[i];
  const norm = Math.sqrt(out.reduce((s, x) => s + x * x, 0)) || 1;
  return out.map(x => x / norm);
};

const overlapShare = (ids: string[], other: Set<string>): number => {
  if (ids.length === 0) return 0;
  let n = 0;
  for (const id of ids) if (other.has(id)) n++;
  return n / ids.length;
};

/**
 * True when an existing moment already has this keyword as a term or concept
 * synonym. Checking terms too hides a suggestion the moment it's added, before
 * the new moment's concepts come back from the server.
 */
const coveredByMoment = (key: string, moments: Moment[]): boolean =>
  moments.some(
    m =>
      !m.isDeleted &&
      [...m.terms, ...(m.concepts || []).flat()].some(w => tokenize(w).join(' ') === key),
  );

/**
 * Suggest moments from clusters of similar notes that share a keyword.
 * Skips dismissed keywords and anything an existing moment already covers.
 */
export const suggestMoments = (
  index: MomentNoteIndex,
  moments: Moment[],
  matchesByMoment: Map<string, MomentMatch[]>,
  dismissedKeys: ReadonlySet<string> = new Set(),
): MomentSuggestion[] => {
  const existingSets = moments
    .filter(m => !m.isDeleted)
    .map(m => new Set((matchesByMoment.get(m.id) || []).map(x => x.id)));

  // Note-to-note similarities are shared across keywords.
  const simCache = new Map<string, number>();
  const sim = (a: { id: string; v: number[] }, b: { id: string; v: number[] }) => {
    const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    let s = simCache.get(k);
    if (s === undefined) {
      s = a.v.length === b.v.length ? dot(a.v, b.v) : -1;
      simCache.set(k, s);
    }
    return s;
  };

  const found: (MomentSuggestion & { clusterSize: number })[] = [];
  for (const c of collectCandidates(index)) {
    if (dismissedKeys.has(c.key)) continue;
    if (coveredByMoment(c.key, moments)) continue;
    const label = pickLabel(c.spellings);

    // Notes that qualify for the keyword exactly as a moment's concept would.
    const concept = [label.toLowerCase()];
    const qualifying = scoreConcepts(index.keyword, prepareConcepts([concept]))
      .filter(r => r.hits.every(Boolean))
      .map(r => index.byId.get(r.id)!)
      .filter(Boolean);

    const vectors = qualifying
      .map(m => ({ id: m.id, v: noteVector(m), ts: m.timestamp }))
      .filter((x): x is { id: string; v: number[]; ts: number } => x.v !== null)
      .sort((a, b) => b.ts - a.ts || (a.id < b.id ? -1 : 1))
      .slice(0, MAX_CLUSTER_NOTES);
    if (vectors.length < MIN_SUGGESTION_NOTES) continue;

    const cluster = largestCluster(vectors, sim);
    if (cluster.length < MIN_SUGGESTION_NOTES) continue;

    const byId = new Map(vectors.map(v => [v.id, v.v]));
    const center = centroid(cluster.map(id => byId.get(id)!));
    const draft: Moment = {
      id: `suggestion:${c.key}`,
      title: label,
      terms: [label],
      concepts: [concept],
      intentVector: center,
      termVectors: [center],
      embeddingModel: EMBEDDING_MODEL_ID,
      createdAt: 0,
      updatedAt: 0,
    };
    const matches = matchNotesToMoment(draft, index);
    if (matches.length < MIN_SUGGESTION_NOTES) continue;

    const ids = matches.map(m => m.id);
    if (existingSets.some(s => overlapShare(ids, s) >= SUGGESTION_OVERLAP)) continue;

    found.push({ key: c.key, label, draft, matches, clusterIds: cluster, clusterSize: cluster.length });
  }

  found.sort(
    (a, b) =>
      b.clusterSize - a.clusterSize || b.matches.length - a.matches.length || (a.key < b.key ? -1 : 1),
  );

  const out: MomentSuggestion[] = [];
  const taken: Set<string>[] = [];
  for (const s of found) {
    if (out.length >= MAX_SUGGESTIONS) break;
    const ids = s.matches.map(m => m.id);
    if (taken.some(t => overlapShare(ids, t) >= SUGGESTION_OVERLAP)) continue;
    taken.push(new Set(ids));
    out.push({ key: s.key, label: s.label, draft: s.draft, matches: s.matches, clusterIds: s.clusterIds });
  }
  return out;
};
