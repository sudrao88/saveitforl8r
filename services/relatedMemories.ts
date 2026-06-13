import { RelatedMemoryEntry } from '../types';

/**
 * Pure similarity math + the incremental matcher core for Related Memories.
 *
 * Embeddings are produced server-side (a powerful model) and synced with each
 * memory. All matching happens locally: every device holds the same vectors
 * and runs this same deterministic top-k, so related lists are identical
 * everywhere with nothing extra to sync.
 *
 * Dependency-free (no Dexie/DOM/worker imports) so it runs in the matcher
 * worker and in unit tests unchanged.
 */

// How many entries are kept per memory vs displayed on the card.
export const K_STORE = 8;
export const K_DISPLAY = 5;
// Entries below this cosine similarity are noise, not "related". Tuned up from
// 0.5 for gemini-embedding-2: a 0.5 floor (~60° apart) let weakly-related notes
// through (e.g. a photo of a bar surfacing on an AI article); 0.6 keeps matches
// topically tighter without starving the list.
export const MIN_SIMILARITY = 0.6;

export interface MemoryVector {
  id: string;
  vector: number[];
}

/** Cosine similarity for unit-normalized vectors (server normalizes them). */
export const dot = (a: number[], b: number[]): number => {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
};

/**
 * Brute-force top-k most-similar memories for a target, excluding itself and
 * anything below the threshold. O(N) per call.
 */
export const topKRelated = (
  targetId: string,
  target: number[],
  vectors: MemoryVector[],
  k: number = K_STORE,
  minScore: number = MIN_SIMILARITY,
): RelatedMemoryEntry[] => {
  const scored: RelatedMemoryEntry[] = [];
  for (const v of vectors) {
    if (v.id === targetId) continue;
    if (v.vector.length !== target.length) continue;
    const score = dot(target, v.vector);
    if (score >= minScore) scored.push({ id: v.id, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return scored.slice(0, k);
};

/**
 * Insert a candidate into an existing top-k list if it qualifies (used to
 * propagate a newly-added memory into other memories' lists without a full
 * recompute). Returns the possibly-updated list and whether it changed.
 */
export const insertIfBetter = (
  list: RelatedMemoryEntry[],
  entry: RelatedMemoryEntry,
  k: number = K_STORE,
  minScore: number = MIN_SIMILARITY,
): { list: RelatedMemoryEntry[]; changed: boolean } => {
  if (entry.score < minScore) return { list, changed: false };
  const withoutEntry = list.filter(e => e.id !== entry.id);
  const existed = withoutEntry.length !== list.length;
  // Reject only if the new entry can't beat the current worst under the SAME
  // comparator topKRelated uses (score desc, then id asc). Using a plain
  // score >= here would drop an equal-score entry that should win the id
  // tiebreak, making incremental updates diverge from a bulk recompute.
  if (!existed && withoutEntry.length >= k) {
    const last = withoutEntry[withoutEntry.length - 1];
    if (last.score > entry.score || (last.score === entry.score && last.id < entry.id)) {
      return { list, changed: false };
    }
  }
  const next = [...withoutEntry, entry]
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    .slice(0, k);
  const changed = next.length !== list.length || next.some((e, i) => e.id !== list[i].id || e.score !== list[i].score);
  return { list: changed ? next : list, changed };
};

/**
 * Maintains per-memory top-k related lists incrementally as vectors are added,
 * changed, or removed. Steady-state updates are O(changes x N); the first bulk
 * load is O(N^2), done once off the main thread in the matcher worker.
 */
export class RelatedMatcher {
  private vectors = new Map<string, number[]>();
  private lists = new Map<string, RelatedMemoryEntry[]>();

  constructor(
    private k: number = K_STORE,
    private minScore: number = MIN_SIMILARITY,
  ) {}

  reset(): void {
    this.vectors.clear();
    this.lists.clear();
  }

  /** Apply a batch of vector additions/changes and removals. */
  update(added: MemoryVector[], removed: string[]): void {
    // An id in `added` that already has a vector is a change, not a new note.
    const stripIds = new Set<string>(removed);
    for (const a of added) {
      if (this.vectors.has(a.id)) stripIds.add(a.id);
    }

    // Apply removals.
    for (const id of removed) {
      this.vectors.delete(id);
      this.lists.delete(id);
    }

    // Drop stripped ids (removed + changed) from every list. A list that loses
    // an entry needs a full recompute to backfill the freed slot.
    const affected = new Set<string>();
    if (stripIds.size > 0) {
      for (const [sid, list] of this.lists) {
        const filtered = list.filter(e => !stripIds.has(e.id));
        if (filtered.length !== list.length) {
          this.lists.set(sid, filtered);
          affected.add(sid);
        }
      }
    }

    // Apply added/changed vectors; each needs its own list computed.
    for (const a of added) {
      this.vectors.set(a.id, a.vector);
      affected.add(a.id);
    }

    const all = this.toArray();

    // Full recompute for affected source notes.
    for (const sid of affected) {
      const v = this.vectors.get(sid);
      if (!v) continue;
      this.lists.set(sid, topKRelated(sid, v, all, this.k, this.minScore));
    }

    // Propagate each added/changed note into the lists of notes that were NOT
    // already fully recomputed above.
    for (const a of added) {
      const av = this.vectors.get(a.id);
      if (!av) continue;
      for (const [sid, list] of this.lists) {
        if (sid === a.id || affected.has(sid)) continue;
        const sv = this.vectors.get(sid);
        if (!sv || sv.length !== av.length) continue;
        const score = dot(av, sv);
        const { list: nextList, changed } = insertIfBetter(list, { id: a.id, score }, this.k, this.minScore);
        if (changed) this.lists.set(sid, nextList);
      }
    }
  }

  /** Current related lists as id-only arrays (scores aren't needed by the UI). */
  getMap(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [id, list] of this.lists) {
      if (list.length > 0) out[id] = list.map(e => e.id);
    }
    return out;
  }

  private toArray(): MemoryVector[] {
    const arr: MemoryVector[] = [];
    for (const [id, vector] of this.vectors) arr.push({ id, vector });
    return arr;
  }
}
