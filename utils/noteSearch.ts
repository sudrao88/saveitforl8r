import { Memory } from '../types';
import { dot } from '../services/relatedMemories';
import { buildKeywordIndex, FIELD_WEIGHTS, KeywordIndex, tokenize } from './keywordMatching';
import { noteVector } from './momentMatching';

/**
 * Hybrid note search: keyword (BM25) + semantic (embedding similarity).
 *
 * Keyword: the query is tokenized with the same tokenizer as Moments (accents
 * stripped, plurals stemmed). Each query term matches a note's token exactly,
 * or as a prefix (so results appear while a word is still being typed) at a
 * discount. Terms are scored with BM25 over field-weighted frequencies —
 * title/tag hits count more than body hits, rarer words count more.
 *
 * Semantic: the query is embedded server-side by the same model as the notes
 * (gemini-embedding-2), and each note's synced vector is compared locally.
 * Short-query-vs-note similarities sit in a narrow band that moves from query
 * to query, so the cutoff is relative to the best match, with an absolute
 * floor.
 *
 * The two rankings are combined with reciprocal rank fusion. A note's keyword
 * contribution is scaled by the share of query terms it contains, so a note
 * matching every word outranks one that only shares a common word.
 *
 * Pure and deterministic: no DOM, network or storage access.
 */

/** Words that carry no meaning on their own in a search query. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'in', 'on', 'at', 'for', 'to', 'with', 'from', 'by', 'about',
  'my', 'our', 'or', 'is', 'are', 'was', 'were', 'it', 'that', 'this', 'what', 'where', 'when',
  'which', 'who', 'how', 'i', 'me', 'do', 'did', 'does', 'any', 'some',
]);

// BM25 parameters (standard values).
const K1 = 1.2;
const B = 0.75;

/** Prefix hits count this much of an exact hit. */
export const PREFIX_WEIGHT = 0.6;
/** Shortest term that also matches as a prefix (one letter matches everything). */
export const MIN_PREFIX_LENGTH = 2;

/** Notes below this cosine similarity to the query are never semantic hits. */
export const SEARCH_MIN_SIMILARITY = 0.4;
/** Semantic hits more than this far below the best match are dropped. */
export const SEARCH_RELATIVE_MARGIN = 0.12;
/** Upper bound on semantic-only hits, so a vague query can't list everything. */
export const MAX_SEMANTIC_HITS = 30;

/** Reciprocal rank fusion constant (the standard 60). */
export const RRF_K = 60;

export const MAX_SEARCH_RESULTS = 100;

/** Mirrors the server's MAX_EMBED_TEXT_LENGTH comfortably. */
export const MAX_QUERY_LENGTH = 500;

export interface SearchResult {
  id: string;
  score: number;
  /** Share of query terms the note contains (0 when it matched only by meaning). */
  keywordCoverage: number;
  /** Cosine similarity to the query, when a query vector was available. */
  similarity?: number;
}

/**
 * Query terms for keyword matching. Stop words are dropped unless the query is
 * nothing but stop words. Duplicates are removed.
 */
export const queryTerms = (query: string): string[] => {
  const tokens = Array.from(new Set(tokenize(query.slice(0, MAX_QUERY_LENGTH))));
  const meaningful = tokens.filter(t => !STOP_WORDS.has(t));
  return meaningful.length > 0 ? meaningful : tokens;
};

/** Field-weighted exact and prefix frequencies of one term in one note. */
const termFrequency = (doc: KeywordIndex['docs'][number], term: string, allowPrefix: boolean): number => {
  if (!allowPrefix && !doc.tokenSet.has(term)) return 0;
  let tf = 0;
  for (const f of doc.fields) {
    const w = FIELD_WEIGHTS[f.name];
    for (const t of f.tokens) {
      if (t === term) tf += w;
      else if (allowPrefix && t.startsWith(term)) tf += w * PREFIX_WEIGHT;
    }
  }
  return tf;
};

export interface KeywordSearchHit {
  id: string;
  score: number;
  coverage: number;
}

/** BM25 keyword search. Returns notes containing at least one query term. */
export const keywordSearch = (index: KeywordIndex, terms: string[]): KeywordSearchHit[] => {
  const N = index.docs.length;
  if (N === 0 || terms.length === 0) return [];

  const allowPrefix = terms.map(t => t.length >= MIN_PREFIX_LENGTH);
  const tf = index.docs.map(d => terms.map((t, i) => termFrequency(d, t, allowPrefix[i])));
  const idf = terms.map((_, ti) => {
    let df = 0;
    for (const row of tf) if (row[ti] > 0) df++;
    return Math.log(1 + (N - df + 0.5) / (df + 0.5));
  });

  const hits: KeywordSearchHit[] = [];
  index.docs.forEach((doc, di) => {
    const norm = K1 * (1 - B + (B * doc.length) / (index.avgLength || 1));
    let score = 0;
    let matched = 0;
    terms.forEach((_, ti) => {
      const f = tf[di][ti];
      if (f === 0) return;
      matched++;
      score += idf[ti] * ((f * (K1 + 1)) / (f + norm));
    });
    if (matched > 0) hits.push({ id: doc.id, score, coverage: matched / terms.length });
  });

  hits.sort((a, b) => b.coverage - a.coverage || b.score - a.score || (a.id < b.id ? -1 : 1));
  return hits;
};

export interface SemanticSearchHit {
  id: string;
  similarity: number;
}

/** Notes whose vector is close to the query vector, best first. */
export const semanticSearch = (memories: Memory[], queryVector: number[]): SemanticSearchHit[] => {
  const scored: SemanticSearchHit[] = [];
  for (const m of memories) {
    const v = noteVector(m);
    if (!v || v.length !== queryVector.length) continue;
    const similarity = dot(queryVector, v);
    if (similarity >= SEARCH_MIN_SIMILARITY) scored.push({ id: m.id, similarity });
  }
  if (scored.length === 0) return [];
  scored.sort((a, b) => b.similarity - a.similarity || (a.id < b.id ? -1 : 1));
  const cutoff = scored[0].similarity - SEARCH_RELATIVE_MARGIN;
  return scored.filter(s => s.similarity >= cutoff).slice(0, MAX_SEMANTIC_HITS);
};

/**
 * Search notes by keyword, and by meaning when a query vector is given.
 * Pass the same `memories` array between calls to reuse its keyword index.
 */
export const searchNotes = (
  memories: Memory[],
  query: string,
  queryVector?: number[] | null,
): SearchResult[] => {
  const live = memories.filter(m => !m.isDeleted);
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  const keyword = keywordSearch(cachedIndex(live), terms);
  const semantic = queryVector && queryVector.length > 0 ? semanticSearch(live, queryVector) : [];

  const results = new Map<string, SearchResult>();
  const entry = (id: string): SearchResult => {
    let r = results.get(id);
    if (!r) {
      r = { id, score: 0, keywordCoverage: 0 };
      results.set(id, r);
    }
    return r;
  };

  keyword.forEach((hit, rank) => {
    const r = entry(hit.id);
    r.keywordCoverage = hit.coverage;
    r.score += hit.coverage / (RRF_K + rank + 1);
  });
  semantic.forEach((hit, rank) => {
    const r = entry(hit.id);
    r.similarity = hit.similarity;
    r.score += 1 / (RRF_K + rank + 1);
  });

  return Array.from(results.values())
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    .slice(0, MAX_SEARCH_RESULTS);
};

// One index per notes array: typing re-scores without re-tokenizing notes
// (buildKeywordIndex also caches each note's tokens by object identity).
let lastInput: Memory[] | null = null;
let lastIndex: KeywordIndex | null = null;
const cachedIndex = (live: Memory[]): KeywordIndex => {
  if (lastInput && lastIndex && sameNotes(lastInput, live)) return lastIndex;
  lastInput = live;
  lastIndex = buildKeywordIndex(live);
  return lastIndex;
};
const sameNotes = (a: Memory[], b: Memory[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

const plainText = (html: string): string =>
  (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * A short excerpt of `text` around the first word matching a query term, so a
 * hit deep inside a long note shows why it matched. Falls back to the start.
 */
export const excerptAround = (text: string, terms: string[], maxLength = 160): string => {
  const plain = plainText(text);
  if (plain.length <= maxLength) return plain;
  const words = plain.split(' ');
  let charPos = 0;
  let hitPos = -1;
  for (const w of words) {
    const t = tokenize(w)[0];
    if (t && terms.some(term => t === term || (term.length >= MIN_PREFIX_LENGTH && t.startsWith(term)))) {
      hitPos = charPos;
      break;
    }
    charPos += w.length + 1;
  }
  if (hitPos < 0) return `${plain.slice(0, maxLength).trimEnd()}…`;
  const start = Math.max(0, hitPos - Math.floor(maxLength / 3));
  const end = Math.min(plain.length, start + maxLength);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end).trim()}${end < plain.length ? '…' : ''}`;
};

/** True when a displayed word matches one of the query terms (for highlighting). */
export const wordMatchesTerms = (word: string, terms: string[]): boolean => {
  const t = tokenize(word)[0];
  if (!t) return false;
  return terms.some(term => t === term || (term.length >= MIN_PREFIX_LENGTH && t.startsWith(term)));
};
