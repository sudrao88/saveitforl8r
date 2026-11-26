/**
 * momentSections.ts
 *
 * Splits the notes of one moment into labelled subsections, entirely on the
 * device: no server call, nothing stored or synced. Like matching itself, the
 * result is a pure, deterministic function of the moment, its matches and the
 * notes, so every device shows the same sections.
 *
 * Four "lenses" each propose a grouping:
 *  - kind:  what the notes are. Every note carries several type words (kind
 *    of place, entity type, content family, genre, tags, the word it matched
 *    a concept on); the few words that best cover the moment become the
 *    sections;
 *  - topic: clusters of similar notes (embeddings), labelled from the notes'
 *    own keywords;
 *  - place: notes about places near each other;
 *  - time:  bursts of notes saved close together.
 *
 * Notes in one moment all resemble the moment, so their embeddings are
 * compared after removing what they share (the mean vector): what is left is
 * how each note differs from the rest.
 *
 * A grouping is kept only when it is worth showing (enough notes, 2 to 6
 * sections of at least 2 notes, few leftovers). For kind and topic, a
 * leftover note joins the section it clearly sits with in embedding space.
 * The kind grouping leads unless the embeddings contradict it; the others
 * are ranked by a shared score led by how well the grouping agrees with the
 * embeddings. No viable grouping means the moment stays a flat list.
 */

import { Memory, Moment } from '../types';
import { dot } from '../services/relatedMemories';
import { GENERIC_KEYWORDS, tokenize } from './keywordMatching';
import { MomentMatch, noteVector } from './momentMatching';
import { centroid, pickLabel, suggestionKey } from './momentSuggestions';
import { noteTitle } from './noteLabels';

export type SectionLens = 'topic' | 'kind' | 'place' | 'time';

export interface MomentSection {
  /** Stable within one sectioning; 'other' for the leftovers. */
  key: string;
  label: string;
  /** Note ids, best match first. */
  noteIds: string[];
}

export interface MomentSectioning {
  lens: SectionLens;
  /** In display order; a leftover "Other" section, if any, is last. */
  sections: MomentSection[];
  score: number;
}

/** Moments with fewer notes are never sectioned. */
export const MIN_SECTIONED_NOTES = 6;
export const MIN_SECTION_SIZE = 2;
export const MAX_SECTIONS = 6;
/** A grouping is dropped when more than this share of notes is left over. */
export const MAX_OTHER_SHARE = 0.35;
/**
 * Topic clusters must be at least this well separated (mean silhouette of the
 * centred vectors).
 */
export const MIN_TOPIC_SILHOUETTE = 0.1;
/**
 * ...and on average each note must be this much closer (cosine, uncentred) to
 * its own cluster than to the next one. Centring magnifies small differences,
 * so alone it would happily cut a set of near-identical notes in half.
 */
export const MIN_TOPIC_GAP = 0.04;
/**
 * A leftover note joins a section only when it is this much closer to it
 * than to the next one (relative), and no further out than the section's own
 * furthest note.
 */
export const ADOPT_MARGIN = 0.15;
/**
 * The kind lens is tried twice: once ignoring type words on more than this
 * share of the notes (so "Restaurant" on nearly everything gives way to the
 * kinds of restaurant), once with every word. The better grouping is kept.
 */
export const MAX_KIND_SHARE = 0.6;
/** A label must appear on at least this share of its section's notes. */
export const MIN_LABEL_SHARE = 0.5;
/** Places closer than this are one area (about city scale). */
export const PLACE_LINK_KM = 30;
/** The place lens needs this share of notes to have a place. */
export const MIN_PLACE_SHARE = 0.6;
/** Notes saved further apart than this (or 3x the median gap) start a new burst. */
export const MIN_TIME_GAP_MS = 3 * 24 * 60 * 60 * 1000;

export const OTHER_SECTION_KEY = 'other';

// Coherence used for a grouping the embeddings can't judge or don't support,
// so it ranks below any grouping they do support without being discarded.
const WEAK_COHERENCE = 0.02;

const LENS_ORDER: SectionLens[] = ['kind', 'topic', 'place', 'time'];

interface Item {
  id: string;
  m: Memory;
  /** Position in the match list (0 = best). */
  rank: number;
  v: number[] | null;
  /** `v` with the moment's mean vector removed, unit length. */
  c: number[] | null;
  matched?: string[];
}

interface Group {
  label: string;
  ids: string[];
  /** 1 for an exact label, lower for a guessed one. */
  quality: number;
}

const byIdAsc = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// --- Shared scoring ---------------------------------------------------------

/** Cosine distance between two notes; null when either has no usable vector. */
type Distance = (a: Item, b: Item) => number | null;

const makeDistance = (vector: (item: Item) => number[] | null): Distance => {
  const cache = new Map<string, number | null>();
  return (a, b) => {
    const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    let d = cache.get(k);
    if (d === undefined) {
      const va = vector(a);
      const vb = vector(b);
      d = va && vb && va.length === vb.length ? 1 - dot(va, vb) : null;
      cache.set(k, d);
    }
    return d;
  };
};

/**
 * Fill in each note's centred vector: its embedding minus the mean of all the
 * moment's notes, rescaled to unit length. Summed in id order so the result
 * never depends on match order.
 */
const centreVectors = (items: Item[]): void => {
  const vectored = items.filter(i => i.v).sort((a, b) => byIdAsc(a.id, b.id));
  if (vectored.length < 2) return;
  const dim = vectored[0].v!.length;
  const usable = vectored.filter(i => i.v!.length === dim);
  const mean = new Array<number>(dim).fill(0);
  for (const i of usable) for (let k = 0; k < dim; k++) mean[k] += i.v![k];
  for (let k = 0; k < dim; k++) mean[k] /= usable.length;
  for (const i of usable) {
    const c = i.v!.map((x, k) => x - mean[k]);
    const norm = Math.sqrt(c.reduce((s, x) => s + x * x, 0));
    i.c = norm > 1e-9 ? c.map(x => x / norm) : null;
  }
};

interface Distances {
  /** Between centred vectors: how notes differ within this moment. */
  centred: Distance;
  /** Between the embeddings as stored. */
  raw: Distance;
}

const meanDistance = (item: Item, others: Item[], dist: Distance): number | null => {
  let sum = 0;
  let n = 0;
  for (const o of others) {
    if (o.id === item.id) continue;
    const d = dist(item, o);
    if (d === null) continue;
    sum += d;
    n++;
  }
  return n > 0 ? sum / n : null;
};

interface Separation {
  /** Mean silhouette, -1 to 1: higher means tighter, better separated groups. */
  silhouette: number;
  /** Mean of (distance to the nearest other group - distance to own group). */
  gap: number;
}

/**
 * How well a grouping holds up in embedding space. Null when too few notes
 * have vectors to tell.
 */
const separation = (groups: Item[][], dist: Distance): Separation | null => {
  let sum = 0;
  let gap = 0;
  let n = 0;
  let total = 0;
  for (let g = 0; g < groups.length; g++) {
    for (const item of groups[g]) {
      total++;
      const a = meanDistance(item, groups[g], dist);
      let b: number | null = null;
      for (let h = 0; h < groups.length; h++) {
        if (h === g) continue;
        const d = meanDistance(item, groups[h], dist);
        if (d !== null && (b === null || d < b)) b = d;
      }
      if (a === null || b === null) continue;
      const denom = Math.max(a, b);
      sum += denom > 0 ? (b - a) / denom : 0;
      gap += b - a;
      n++;
    }
  }
  return n >= 2 && n >= total / 2 ? { silhouette: sum / n, gap: gap / n } : null;
};

/** Normalized entropy of group sizes: 1 when even, towards 0 when lopsided. */
const balance = (sizes: number[]): number => {
  if (sizes.length < 2) return 0;
  const total = sizes.reduce((s, x) => s + x, 0);
  let h = 0;
  for (const x of sizes) {
    const p = x / total;
    if (p > 0) h -= p * Math.log(p);
  }
  return h / Math.log(sizes.length);
};

/**
 * Move each leftover note into the group it clearly belongs with: distinctly
 * nearer to it than to any other group, and no further out than the group's
 * own furthest member. Every decision uses the groups as given, so the
 * outcome doesn't depend on the order of the leftovers.
 */
const adoptLeftovers = (groups: Item[][], rest: Item[], dist: Distance): Item[][] => {
  if (rest.length === 0 || groups.length < 2) return groups;
  const reach = groups.map(g => {
    let max: number | null = null;
    for (const item of g) {
      const d = meanDistance(item, g, dist);
      if (d !== null && (max === null || d > max)) max = d;
    }
    return max;
  });
  const out = groups.map(g => [...g]);
  for (const item of rest) {
    let best = -1;
    let a = Infinity;
    let b = Infinity;
    for (let g = 0; g < groups.length; g++) {
      const d = meanDistance(item, groups[g], dist);
      if (d === null) continue;
      if (d < a) {
        b = a;
        a = d;
        best = g;
      } else if (d < b) {
        b = d;
      }
    }
    if (best < 0 || b === Infinity || reach[best] === null || a > reach[best]!) continue;
    if (b <= 0 || (b - a) / b < ADOPT_MARGIN) continue;
    out[best].push(item);
  }
  return out;
};

interface Scored {
  sections: MomentSection[];
  score: number;
  separation: Separation | null;
  /** The notes of each named section (no "Other"), in section order. */
  members: Item[][];
}

/**
 * Turn proposed groups into sections and score them, or null when the
 * grouping isn't worth showing. Groups sharing a label are merged, groups
 * that are too small join "Other".
 */
const finalize = (
  groups: Group[],
  items: Item[],
  dist: Distance,
  { order = 'rank', adopt = false }: { order?: 'rank' | 'given'; adopt?: boolean } = {},
): Scored | null => {
  const itemById = new Map(items.map(i => [i.id, i]));
  const rankOf = (id: string) => itemById.get(id)!.rank;

  // Merge groups with the same label; a note belongs to its first group.
  const merged = new Map<string, Group>();
  const taken = new Set<string>();
  for (const g of groups) {
    const label = g.label.replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const ids = g.ids.filter(id => itemById.has(id) && !taken.has(id));
    ids.forEach(id => taken.add(id));
    const existing = merged.get(key);
    if (existing) {
      existing.ids.push(...ids);
      existing.quality = Math.min(existing.quality, g.quality);
    } else {
      merged.set(key, { label, ids, quality: g.quality });
    }
  }

  const bestRank = (g: Group) => Math.min(...g.ids.map(rankOf));
  let kept = [...merged.values()].filter(g => g.ids.length >= MIN_SECTION_SIZE);
  if (kept.length > MAX_SECTIONS) {
    const largest = [...kept]
      .sort((a, b) => b.ids.length - a.ids.length || bestRank(a) - bestRank(b))
      .slice(0, MAX_SECTIONS);
    kept = kept.filter(g => largest.includes(g));
  }
  if (kept.length < 2) return null;

  if (adopt) {
    const named = new Set(kept.flatMap(g => g.ids));
    const adopted = adoptLeftovers(
      kept.map(g => g.ids.map(id => itemById.get(id)!)),
      items.filter(i => !named.has(i.id)),
      dist,
    );
    kept.forEach((g, i) => (g.ids = adopted[i].map(x => x.id)));
  }

  const sectioned = kept.reduce((s, g) => s + g.ids.length, 0);
  const coverage = sectioned / items.length;
  if (1 - coverage > MAX_OTHER_SHARE) return null;

  if (order === 'rank') kept.sort((a, b) => bestRank(a) - bestRank(b));
  const sections: MomentSection[] = kept.map(g => ({
    key: g.label.toLowerCase(),
    label: g.label,
    noteIds: [...g.ids].sort((a, b) => rankOf(a) - rankOf(b)),
  }));
  const inSection = new Set(sections.flatMap(s => s.noteIds));
  const rest = items.filter(i => !inSection.has(i.id)).map(i => i.id);
  if (rest.length > 0) sections.push({ key: OTHER_SECTION_KEY, label: 'Other', noteIds: rest });

  const members = kept.map(g => g.ids.map(id => itemById.get(id)!));
  const sep = separation(members, dist);
  const coherence = Math.max(sep?.silhouette ?? WEAK_COHERENCE, WEAK_COHERENCE);
  const quality = kept.reduce((s, g) => s + g.quality * g.ids.length, 0) / sectioned;
  const score = coherence * coverage * balance(kept.map(g => g.ids.length)) * quality;
  return { sections, score, separation: sep, members };
};

// --- Labels from the notes' own words ---------------------------------------

const cleanLabel = (raw: unknown): string => String(raw ?? '').replace(/^#/, '').replace(/\s+/g, ' ').trim();

/** Words the moment itself already says; a section label must add something. */
const momentTokens = (moment: Moment): Set<string> =>
  new Set([...moment.terms, ...(moment.concepts || []).flat()].flatMap(w => tokenize(String(w))));

const impliedByMoment = (key: string, tokens: Set<string>): boolean => key.split(' ').every(t => tokens.has(t));

const humanize = (s: string): string => {
  const t = s.replace(/[_-]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

/**
 * Enrichment puts the kind of place ("South Indian Restaurant") in the entity
 * subtitle, but only for places: for a book the subtitle is its author.
 */
const PLACE_ENTITY = /\b(place|restaurant|caf[eé]|bar|hotel|location|venue|shop|store|attraction|landmark)\b/i;

/**
 * The kind of place a note is about, from most to least specific:
 * "South Indian Restaurant", "Indian Restaurant", "Restaurant". The head noun
 * comes last, so dropping leading words generalizes the phrase.
 */
const placeTypePhrases = (item: Item): string[] => {
  const e = item.m.enrichment;
  const subtitle = cleanLabel(e?.entityContext?.subtitle);
  if (!subtitle) return [];
  const isPlace =
    String(e?.contentType || '').toLowerCase() === 'place_restaurant' ||
    PLACE_ENTITY.test(String(e?.entityContext?.type || ''));
  if (!isPlace) return [];
  const words = subtitle.split(' ').map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
  if (words.length === 0 || words.length > 5 || words.some(w => /\p{N}/u.test(w))) return [];
  return words.map((_, i) => capitalize(words.slice(i).join(' ')));
};

/** Keywords a note carries, as normalized key to the spelling used. */
const noteKeywords = (item: Item, implied: Set<string>): Map<string, string> => {
  const e = item.m.enrichment;
  const words = [
    ...(item.m.tags || []),
    ...(e?.suggestedTags || []),
    ...(Array.isArray(e?.themes) ? e!.themes! : []),
    e?.entityContext?.type || '',
    ...placeTypePhrases(item),
    e?.contentType ? humanize(e.contentType) : '',
    e?.locationIsRelevant !== false ? e?.locationContext?.name || '' : '',
    ...(item.matched || []),
  ];
  const out = new Map<string, string>();
  for (const raw of words) {
    const label = cleanLabel(raw);
    const key = label ? suggestionKey(label) : null;
    if (!key || out.has(key) || impliedByMoment(key, implied)) continue;
    out.set(key, label);
  }
  return out;
};

/** Distinctive words of a note's title, as stem to the word as written. */
const titleWords = (item: Item, implied: Set<string>): Map<string, string> => {
  const out = new Map<string, string>();
  for (const word of noteTitle(item.m).match(/[\p{L}\p{N}]+/gu) || []) {
    const stems = tokenize(word);
    if (stems.length !== 1) continue;
    const key = stems[0];
    if (key.length < 3 || /^\p{N}+$/u.test(key) || GENERIC_KEYWORDS.has(key) || implied.has(key) || out.has(key)) continue;
    out.set(key, word.toLowerCase());
  }
  return out;
};

/**
 * The keyword that best sets a cluster apart: common inside it, rare in the
 * other clusters. Null when nothing covers enough of the cluster.
 */
const distinctiveLabel = (
  cluster: Item[],
  others: Item[],
  words: (item: Item) => Map<string, string>,
): string | null => {
  const inside = new Map<string, { n: number; spellings: Map<string, number> }>();
  for (const item of cluster) {
    for (const [key, label] of words(item)) {
      let c = inside.get(key);
      if (!c) inside.set(key, (c = { n: 0, spellings: new Map() }));
      c.n++;
      c.spellings.set(label, (c.spellings.get(label) ?? 0) + 1);
    }
  }
  const outside = new Map<string, number>();
  for (const item of others) for (const key of words(item).keys()) outside.set(key, (outside.get(key) ?? 0) + 1);

  let best: { key: string; score: number; spellings: Map<string, number> } | null = null;
  for (const [key, c] of [...inside.entries()].sort((a, b) => byIdAsc(a[0], b[0]))) {
    const inShare = c.n / cluster.length;
    if (inShare < MIN_LABEL_SHARE) continue;
    const outShare = others.length > 0 ? (outside.get(key) ?? 0) / others.length : 0;
    const score = inShare * (1 - outShare);
    if (score > 0 && (!best || score > best.score)) best = { key, score, spellings: c.spellings };
  }
  return best ? pickLabel(best.spellings) : null;
};

const capitalize = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

const truncate = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

// --- Lens: topic ------------------------------------------------------------

/**
 * Average-linkage agglomerative clustering. Returns the clusters at every
 * size from maxK down to 2, as lists of indices into `items`.
 */
const agglomerate = (items: Item[], dist: Distance, maxK: number): number[][][] => {
  const n = items.length;
  // Linkage between clusters, addressed by each cluster's smallest index.
  const link = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) link[i * n + j] = link[j * n + i] = dist(items[i], items[j]) ?? 1;
  }
  const members: number[][] = items.map((_, i) => [i]);
  let active = items.map((_, i) => i);
  const levels: number[][][] = [];
  while (active.length > 1) {
    if (active.length <= maxK) levels.push(active.map(s => [...members[s]]));
    let bi = active[0];
    let bj = active[1];
    let bd = Infinity;
    for (let x = 0; x < active.length; x++) {
      for (let y = x + 1; y < active.length; y++) {
        const d = link[active[x] * n + active[y]];
        if (d < bd) {
          bd = d;
          bi = active[x];
          bj = active[y];
        }
      }
    }
    // Merge bj into bi (bi < bj, so the merged cluster keeps bi's address).
    const ni = members[bi].length;
    const nj = members[bj].length;
    for (const s of active) {
      if (s === bi || s === bj) continue;
      const d = (ni * link[bi * n + s] + nj * link[bj * n + s]) / (ni + nj);
      link[bi * n + s] = link[s * n + bi] = d;
    }
    members[bi] = [...members[bi], ...members[bj]].sort((p, q) => p - q);
    active = active.filter(s => s !== bj);
  }
  return levels;
};

/** Separation of topic clusters: centred for shape, raw for real distance. */
const topicSeparation = (clusters: Item[][], dist: Distances): Separation | null => {
  const sep = separation(clusters, dist.centred);
  if (!sep || sep.silhouette < MIN_TOPIC_SILHOUETTE) return null;
  const raw = separation(clusters, dist.raw);
  return raw && raw.gap >= MIN_TOPIC_GAP ? sep : null;
};

const topicLens = (moment: Moment, items: Item[], dist: Distances): Scored | null => {
  // Sorted by id so the clustering never depends on match order.
  const vectored = items.filter(i => i.c).sort((a, b) => byIdAsc(a.id, b.id));
  if (vectored.length < MIN_SECTIONED_NOTES) return null;

  // Pick the cut with the best separation, weighted by how many notes it keeps.
  let best: { clusters: Item[][]; value: number } | null = null;
  for (const level of agglomerate(vectored, dist.centred, MAX_SECTIONS)) {
    const large = level.filter(c => c.length >= MIN_SECTION_SIZE).map(c => c.map(i => vectored[i]));
    if (large.length < 2) continue;
    const inLarge = new Set(large.flat());
    const clusters = adoptLeftovers(large, vectored.filter(i => !inLarge.has(i)), dist.centred);
    const covered = clusters.reduce((s, c) => s + c.length, 0);
    if (1 - covered / items.length > MAX_OTHER_SHARE) continue;
    const sep = topicSeparation(clusters, dist);
    if (!sep) continue;
    const value = sep.silhouette * (covered / items.length);
    // Levels run from most to fewest clusters; on a tie the fewer win.
    if (!best || value >= best.value) best = { clusters, value };
  }
  if (!best) return null;

  const implied = momentTokens(moment);
  const keywords = new Map(vectored.map(i => [i.id, noteKeywords(i, implied)]));
  const titles = new Map(vectored.map(i => [i.id, titleWords(i, implied)]));

  const groups: Group[] = best.clusters.map(cluster => {
    const others = best!.clusters.filter(c => c !== cluster).flat();
    const ids = cluster.map(i => i.id);
    const keyword = distinctiveLabel(cluster, others, i => keywords.get(i.id)!);
    if (keyword) return { label: keyword, ids, quality: 1 };
    const word = distinctiveLabel(cluster, others, i => titles.get(i.id)!);
    if (word) return { label: humanize(word), ids, quality: 0.8 };
    // Last resort: name the cluster after its most central note.
    const center = centroid(cluster.map(i => i.v!));
    const central = [...cluster].sort((a, b) => dot(b.v!, center) - dot(a.v!, center) || byIdAsc(a.id, b.id))[0];
    return { label: `Like “${truncate(noteTitle(central.m).replace(/\s+/g, ' ').trim(), 40)}”`, ids, quality: 0.6 };
  });

  const scored = finalize(groups, items, dist.centred);
  // Merging same-label clusters can blur the separation; check it again.
  return scored && topicSeparation(scored.members, dist) ? scored : null;
};

// --- Lens: kind -------------------------------------------------------------

/** Enrichment content types grouped into the families a person would name. */
const CONTENT_FAMILIES: Record<string, string> = {
  recipe: 'Food & drink',
  place_restaurant: 'Food & drink',
  travel: 'Travel',
  book: 'Books',
  movie_tv: 'Films & TV',
  video: 'Videos',
  music: 'Music & podcasts',
  podcast: 'Music & podcasts',
  article_blog: 'Articles',
  social_media_post: 'Social posts',
  research_academic: 'Learning & research',
  learning: 'Learning & research',
  educational: 'Learning & research',
  reference: 'Reference',
  snippet: 'Reference',
  product: 'Shopping',
  wishlist: 'Shopping',
  comparison: 'Shopping',
  review: 'Reviews',
  recommendation: 'Recommendations',
  task_list: 'Plans & tasks',
  project: 'Plans & tasks',
  event: 'Events',
  meeting_notes: 'Meetings',
  contact: 'People',
  job_listing: 'Work',
  financial: 'Money & legal',
  legal: 'Money & legal',
  health: 'Health',
  journal: 'Personal notes',
  personal_note: 'Personal notes',
  observation: 'Personal notes',
  idea: 'Ideas',
  quote: 'Quotes',
};

interface TypeWord {
  key: string;
  /** How much the source says about what a note is; also the label quality. */
  weight: number;
  spellings: Map<string, number>;
  ids: Set<string>;
}

/**
 * Every word that says what kind of thing a note is, strongest source first:
 * kind of place, entity type, the word matched on a concept, content family,
 * genre, then the user's and the AI's tags.
 */
const typeWordsOf = (item: Item): { word: string; weight: number; matched?: boolean }[] => {
  const e = item.m.enrichment;
  const from = (weight: number, words: unknown[]) => words.map(w => ({ word: String(w ?? ''), weight }));
  return [
    ...from(1, placeTypePhrases(item)),
    ...from(1, [e?.entityContext?.type]),
    // A concept's synonyms are the moment's own words, yet which one a note
    // matched is exactly what tells the notes apart.
    ...from(1, item.matched || []).map(w => ({ ...w, matched: true })),
    ...from(0.9, [CONTENT_FAMILIES[String(e?.contentType || '').toLowerCase()]]),
    ...from(0.9, [typeof e?.genre === 'string' ? e.genre : '']),
    ...from(0.8, item.m.tags || []),
    ...from(0.7, e?.suggestedTags || []),
  ];
};

const collectTypeWords = (items: Item[], implied: Set<string>): TypeWord[] => {
  const byKey = new Map<string, TypeWord>();
  for (const item of items) {
    const seen = new Set<string>();
    for (const { word, weight, matched } of typeWordsOf(item)) {
      const label = cleanLabel(word);
      const key = label ? suggestionKey(label) : null;
      if (!key || seen.has(key) || (!matched && impliedByMoment(key, implied))) continue;
      seen.add(key);
      let w = byKey.get(key);
      if (!w) byKey.set(key, (w = { key, weight, spellings: new Map(), ids: new Set() }));
      w.weight = Math.max(w.weight, weight);
      w.ids.add(item.id);
      const spelling = capitalize(label);
      w.spellings.set(spelling, (w.spellings.get(spelling) ?? 0) + 1);
    }
  }
  return [...byKey.values()].filter(w => w.ids.size >= MIN_SECTION_SIZE).sort((a, b) => byIdAsc(a.key, b.key));
};

/**
 * Choose the type words that become sections: repeatedly take the word that
 * names the most notes not yet in a section (weighted by its source; on a
 * tie the more specific phrase wins). Each note lands in the first chosen
 * word it carries.
 */
const coverWithTypes = (words: TypeWord[], maxSize: number): Group[] => {
  const pool = words.filter(w => w.ids.size <= maxSize);
  const covered = new Set<string>();
  const groups: Group[] = [];
  const specificity = (w: TypeWord) => w.key.split(' ').length;
  while (groups.length < MAX_SECTIONS) {
    let best: { word: TypeWord; ids: string[]; gain: number } | null = null;
    for (const word of pool) {
      const ids = [...word.ids].filter(id => !covered.has(id));
      if (ids.length < MIN_SECTION_SIZE) continue;
      const gain = ids.length * word.weight;
      if (!best || gain > best.gain || (gain === best.gain && specificity(word) > specificity(best.word))) {
        best = { word, ids, gain };
      }
    }
    if (!best) break;
    best.ids.forEach(id => covered.add(id));
    groups.push({ label: pickLabel(best.word.spellings), ids: best.ids, quality: best.word.weight });
  }
  return groups;
};

const kindLens = (moment: Moment, items: Item[], dist: Distances): Scored | null => {
  const words = collectTypeWords(items, momentTokens(moment));
  let best: Scored | null = null;
  // Narrow words first: on a tie the finer grouping is kept.
  for (const maxSize of [Math.floor(items.length * MAX_KIND_SHARE), items.length - 1]) {
    const scored = finalize(coverWithTypes(words, maxSize), items, dist.centred, { adopt: true });
    if (scored && (!best || scored.score > best.score)) best = scored;
  }
  return best;
};

// --- Lens: place ------------------------------------------------------------

/** Great-circle distance between two points, in kilometres. */
export const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
};

interface Placed {
  item: Item;
  lat: number;
  lon: number;
  name?: string;
  address?: string;
}

const validCoords = (lat: unknown, lon: unknown): lat is number =>
  typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) &&
  Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** Where a note is about (or was saved), unless its place was judged irrelevant. */
const placeOf = (item: Item): Placed | null => {
  const e = item.m.enrichment;
  if (e?.locationIsRelevant === false) return null;
  const lc = e?.locationContext;
  if (lc && validCoords(lc.latitude, lc.longitude)) {
    return { item, lat: lc.latitude as number, lon: lc.longitude as number, name: lc.name, address: lc.address };
  }
  const loc = item.m.location;
  if (loc && validCoords(loc.latitude, loc.longitude)) {
    return { item, lat: loc.latitude, lon: loc.longitude, name: lc?.name, address: lc?.address };
  }
  return null;
};

/** Address as comma parts with postcodes and numbers removed: "MG Road, Bengaluru, India". */
const addressParts = (address: string): string[] =>
  address
    .split(',')
    .map(p => p.split(/\s+/).filter(w => w && !/\p{N}/u.test(w)).join(' ').trim())
    .filter(Boolean);

/** The most specific area every address in the group shares, e.g. the city. */
const sharedArea = (group: Placed[]): string | null => {
  const lists = group.filter(p => p.address).map(p => addressParts(p.address!));
  if (lists.length < Math.max(2, group.length / 2)) return null;
  let shared = 0;
  const shortest = Math.min(...lists.map(l => l.length));
  while (shared < shortest) {
    const part = lists[0][lists[0].length - 1 - shared].toLowerCase();
    if (!lists.every(l => l[l.length - 1 - shared].toLowerCase() === part)) break;
    shared++;
  }
  if (shared === 0) return null;
  return lists[0][lists[0].length - shared];
};

const placeLens = (items: Item[], dist: Distances): Scored | null => {
  const placed = items
    .map(placeOf)
    .filter((p): p is Placed => p !== null)
    .sort((a, b) => byIdAsc(a.item.id, b.item.id));
  if (placed.length < items.length * MIN_PLACE_SHARE) return null;

  // Connected components of places within PLACE_LINK_KM of each other.
  const seen = new Set<Placed>();
  const groups: Group[] = [];
  for (const start of placed) {
    if (seen.has(start)) continue;
    const component: Placed[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop()!;
      component.push(cur);
      for (const other of placed) {
        if (seen.has(other)) continue;
        if (haversineKm(cur.lat, cur.lon, other.lat, other.lon) <= PLACE_LINK_KM) {
          seen.add(other);
          stack.push(other);
        }
      }
    }
    const ids = component.map(p => p.item.id);
    const area = sharedArea(component);
    if (area) {
      groups.push({ label: area, ids, quality: 1 });
      continue;
    }
    const names = new Map<string, number>();
    for (const p of component) {
      const name = cleanLabel(p.name);
      if (name) names.set(name, (names.get(name) ?? 0) + 1);
    }
    if (names.size > 0) groups.push({ label: `Near ${pickLabel(names)}`, ids, quality: 0.8 });
  }
  return finalize(groups, items, dist.centred);
};

// --- Lens: time -------------------------------------------------------------

const timeLabel = (start: number, end: number): string => {
  const a = new Date(start);
  const b = new Date(end);
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' });
  if (a.getFullYear() !== b.getFullYear()) return `${a.getFullYear()}–${b.getFullYear()}`;
  if (a.getMonth() !== b.getMonth()) return `${month(a)}–${month(b)} ${a.getFullYear()}`;
  if (a.getDate() !== b.getDate()) return `${a.getDate()}–${b.getDate()} ${month(a)} ${a.getFullYear()}`;
  return `${a.getDate()} ${month(a)} ${a.getFullYear()}`;
};

const timeLens = (items: Item[], dist: Distances): Scored | null => {
  const sorted = [...items].sort((a, b) => a.m.timestamp - b.m.timestamp || byIdAsc(a.id, b.id));
  const gaps = sorted.slice(1).map((it, i) => it.m.timestamp - sorted[i].m.timestamp);
  if (gaps.length === 0) return null;
  const ordered = [...gaps].sort((a, b) => a - b);
  const median = ordered[Math.floor(ordered.length / 2)];
  const threshold = Math.max(3 * median, MIN_TIME_GAP_MS);

  const bursts: Item[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    if (gaps[i - 1] > threshold) bursts.push([]);
    bursts[bursts.length - 1].push(sorted[i]);
  }
  // Newest burst first.
  const groups: Group[] = bursts.reverse().map(b => ({
    label: timeLabel(b[0].m.timestamp, b[b.length - 1].m.timestamp),
    ids: b.map(i => i.id),
    quality: 1,
  }));
  return finalize(groups, items, dist.centred, { order: 'given' });
};

// --- Entry point ------------------------------------------------------------

/**
 * Ways to split a moment's notes into subsections, best first. Empty when the
 * moment is too small or no grouping is worth showing.
 */
export const sectionMoment = (
  moment: Moment,
  matches: MomentMatch[],
  byId: ReadonlyMap<string, Memory>,
): MomentSectioning[] => {
  const items: Item[] = [];
  for (const match of matches) {
    const m = byId.get(match.id);
    if (!m || m.isDeleted) continue;
    items.push({ id: m.id, m, rank: items.length, v: noteVector(m), c: null, matched: match.matched });
  }
  if (items.length < MIN_SECTIONED_NOTES) return [];

  centreVectors(items);
  const dist: Distances = { centred: makeDistance(i => i.c), raw: makeDistance(i => i.v) };
  const proposals: [SectionLens, Scored | null][] = [
    ['kind', kindLens(moment, items, dist)],
    ['topic', topicLens(moment, items, dist)],
    ['place', placeLens(items, dist)],
    ['time', timeLens(items, dist)],
  ];
  // Kinds lead unless the embeddings say the split cuts across what the notes
  // are about; everything else is ranked by score.
  const leads = (lens: SectionLens, s: Scored) =>
    lens === 'kind' && (s.separation === null || s.separation.silhouette >= 0) ? 0 : 1;
  return proposals
    .filter((p): p is [SectionLens, Scored] => p[1] !== null)
    .sort(
      (a, b) =>
        leads(a[0], a[1]) - leads(b[0], b[1]) ||
        b[1].score - a[1].score ||
        LENS_ORDER.indexOf(a[0]) - LENS_ORDER.indexOf(b[0]),
    )
    .map(([lens, s]) => ({ lens, sections: s.sections, score: s.score }));
};
