import { Memory } from '../types';

/**
 * Keyword matching for Moments.
 *
 * A moment has a few required concepts, each a list of synonyms (from the
 * server, e.g. [["cafe", "café", "coffee shop"], ["bangalore", "bengaluru"]]).
 * A note matches a concept when any of its synonyms appears in the note's
 * enriched fields (title, tags, type, place, summary, …) and qualifies for the
 * moment only when it matches every concept.
 *
 * Each concept hit is scored with BM25: rarer words count more (idf), repeats
 * count less and less (saturation), and short identifying fields (title,
 * tags) weigh more than long body text. Embeddings then rank the qualifying
 * notes (see momentMatching.ts).
 *
 * Dependency-free and deterministic so every device matches the same notes.
 */

// BM25 parameters (standard values).
const K1 = 1.2;
const B = 0.75;

// How much a hit in each field counts. Short identifying fields first.
const FIELD_WEIGHTS = {
  title: 3,
  tags: 3,
  type: 2,
  subtitle: 2,
  place: 2,
  summary: 1.5,
  description: 1,
  visual: 1,
  content: 1,
} as const;

type FieldName = keyof typeof FIELD_WEIGHTS;

// Long note bodies are capped so one huge note doesn't dominate the index.
const MAX_CONTENT_CHARS = 3000;

/**
 * Light English stemming so plurals match their singular: cafes → cafe,
 * dresses → dress, bakeries → bakery. Deliberately conservative.
 */
export const stem = (w: string): string => {
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(ss|sh|ch|x|z)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
};

/**
 * Split text into normalized tokens: camelCase and hashtags split
 * (#BangaloreEats → bangalore eats), accents removed (café → cafe),
 * lowercased, split on anything that isn't a letter or digit, then stemmed.
 */
export const tokenize = (text: string): string[] => {
  if (!text) return [];
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(stem);
};

/** One note prepared for keyword matching. */
export interface KeywordDoc {
  id: string;
  fields: { name: FieldName; tokens: string[] }[];
  /** Every token in the note, for a fast "can this phrase be here?" check. */
  tokenSet: Set<string>;
  /** Weighted token count, for BM25 length normalization. */
  length: number;
}

export interface KeywordIndex {
  docs: KeywordDoc[];
  avgLength: number;
}

/**
 * A note's searchable text, one entry per segment. Each tag and each part of
 * the place is its own segment, so a phrase can't match across two of them
 * ("#Coffee" + "#Shop" is not "coffee shop").
 */
const noteFields = (m: Memory): [FieldName, string][] => {
  const e = m.enrichment;
  const ent = e?.entityContext;
  const loc = e?.locationContext;
  const tags = [...(e?.suggestedTags || []), ...(m.tags || [])];
  return [
    ['title', ent?.title || ''],
    ...tags.map((t): [FieldName, string] => ['tags', t]),
    ['type', ent?.type || ''],
    ['subtitle', ent?.subtitle || ''],
    ['place', loc?.name || ''],
    ['place', loc?.address || ''],
    ['summary', e?.summary || ''],
    ['description', ent?.description || ''],
    ['visual', e?.visualDescription || ''],
    ['content', (m.content || '').slice(0, MAX_CONTENT_CHARS)],
  ];
};

export const buildKeywordDoc = (m: Memory): KeywordDoc => {
  const fields: KeywordDoc['fields'] = [];
  const tokenSet = new Set<string>();
  let length = 0;
  for (const [name, text] of noteFields(m)) {
    const tokens = tokenize(text);
    if (tokens.length === 0) continue;
    fields.push({ name, tokens });
    for (const t of tokens) tokenSet.add(t);
    length += tokens.length * FIELD_WEIGHTS[name];
  }
  return { id: m.id, fields, tokenSet, length };
};

// Notes are replaced (not mutated) when they change, so a prepared doc can be
// reused for as long as its Memory object lives: editing one note re-tokenizes
// only that note.
const docCache = new WeakMap<Memory, KeywordDoc>();

const cachedDoc = (m: Memory): KeywordDoc => {
  let doc = docCache.get(m);
  if (!doc) {
    doc = buildKeywordDoc(m);
    docCache.set(m, doc);
  }
  return doc;
};

export const buildKeywordIndex = (memories: Memory[]): KeywordIndex => {
  const docs = memories.filter(m => !m.isDeleted).map(cachedDoc);
  const total = docs.reduce((s, d) => s + d.length, 0);
  return { docs, avgLength: docs.length ? total / docs.length : 0 };
};

/** Count contiguous occurrences of `phrase` in `tokens`. */
const countPhrase = (tokens: string[], phrase: string[]): number => {
  let n = 0;
  outer: for (let i = 0; i + phrase.length <= tokens.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (tokens[i + j] !== phrase[j]) continue outer;
    n++;
  }
  return n;
};

/** Field-weighted occurrences of a phrase in a note (0 when absent). */
const weightedFrequency = (doc: KeywordDoc, phrase: string[]): number => {
  for (const t of phrase) if (!doc.tokenSet.has(t)) return 0;
  let tf = 0;
  for (const f of doc.fields) tf += countPhrase(f.tokens, phrase) * FIELD_WEIGHTS[f.name];
  return tf;
};

/** A concept prepared for matching: its synonyms, tokenized. */
export interface PreparedConcept {
  label: string;
  synonyms: { text: string; tokens: string[] }[];
}

export const prepareConcepts = (concepts: string[][]): PreparedConcept[] =>
  concepts
    .map(words => {
      const seen = new Set<string>();
      const synonyms = words
        .map(text => ({ text, tokens: tokenize(text) }))
        .filter(s => {
          const key = s.tokens.join(' ');
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      return { label: words[0] ?? '', synonyms };
    })
    .filter(c => c.synonyms.length > 0);

/** How one note matched one concept. */
export interface ConceptHit {
  /** The synonym that scored highest for this note. */
  synonym: string;
  score: number;
}

export interface KeywordResult {
  id: string;
  /** One entry per concept, null where the note doesn't match it. */
  hits: (ConceptHit | null)[];
  /** Sum of the concept scores (only meaningful when all concepts hit). */
  score: number;
}

/**
 * Score every note against a moment's concepts. Returns notes that match at
 * least one concept; `hits` shows which ones (all non-null = qualifies).
 */
export const scoreConcepts = (index: KeywordIndex, concepts: PreparedConcept[]): KeywordResult[] => {
  const N = index.docs.length;
  if (N === 0 || concepts.length === 0) return [];

  // Field-weighted frequency of every synonym in every note, computed once:
  // tf[doc][concept][synonym].
  const tf_ = index.docs.map(d => concepts.map(c => c.synonyms.map(s => weightedFrequency(d, s.tokens))));

  // Inverse document frequency per synonym, from how many notes contain it.
  const idf = concepts.map((c, ci) =>
    c.synonyms.map((_, si) => {
      let df = 0;
      for (const row of tf_) if (row[ci][si] > 0) df++;
      return Math.log(1 + (N - df + 0.5) / (df + 0.5));
    }),
  );

  const results: KeywordResult[] = [];
  index.docs.forEach((doc, di) => {
    const norm = K1 * (1 - B + (B * doc.length) / (index.avgLength || 1));
    let any = false;
    let total = 0;
    const hits = concepts.map((c, ci) => {
      let best: ConceptHit | null = null;
      c.synonyms.forEach((s, si) => {
        const tf = tf_[di][ci][si];
        if (tf === 0) return;
        const score = idf[ci][si] * ((tf * (K1 + 1)) / (tf + norm));
        if (!best || score > best.score) best = { synonym: s.text, score };
      });
      if (best) {
        any = true;
        total += (best as ConceptHit).score;
      }
      return best;
    });
    if (any) results.push({ id: doc.id, hits, score: total });
  });
  return results;
};
