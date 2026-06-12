import { MODEL_PRIORITY, RelatedMemoriesRecord, RelatedMemoryEntry } from '../types';

/**
 * Pure similarity math + conflict rules for the Related Memories feature.
 * Kept dependency-free (no Dexie/worker imports) so it is shared between the
 * embedding worker, storage layer, sync layer, and unit tests.
 */

// How many entries are stored/synced per memory vs displayed on the card.
export const K_STORE = 8;
export const K_DISPLAY = 5;
// Entries below this cosine similarity are noise, not "related".
export const MIN_SIMILARITY = 0.5;

/** Fired whenever locally persisted related-memories lists change (worker compute or sync download). */
export const RELATED_MEMORIES_UPDATED_EVENT = 'related-memories-updated';
/** Fired with freshly written records ({ detail: { records } }) that still need uploading to Drive. */
export const RELATED_MEMORIES_NEED_SYNC_EVENT = 'related-memories-need-sync';

export const dot = (a: number[], b: number[]): number => {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) sum += a[i] * b[i];
  return sum;
};

export const normalize = (v: number[]): number[] => {
  const norm = Math.sqrt(dot(v, v));
  if (norm === 0) return v.slice();
  return v.map(x => x / norm);
};

/**
 * Memory-level vector = L2-normalized mean of its chunk vectors.
 * Chunk vectors are already normalized, so the centroid is a standard
 * cheap document embedding and keeps sim(a,b) symmetric.
 */
export const meanVector = (chunks: number[][]): number[] => {
  if (chunks.length === 0) return [];
  const dim = chunks[0].length;
  const mean = new Array<number>(dim).fill(0);
  for (const chunk of chunks) {
    for (let i = 0; i < dim; i++) mean[i] += chunk[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= chunks.length;
  return normalize(mean);
};

export interface MemoryVector {
  id: string;
  vector: number[];
}

/**
 * Brute-force top-k similar memories for a target. Excludes the target itself
 * and anything under MIN_SIMILARITY. Vectors must all come from the same model.
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
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
};

/**
 * Incremental update: insert a new candidate into an existing top-k list if it
 * qualifies. Returns the (possibly unchanged) list and whether it changed.
 */
export const insertIfBetter = (
  list: RelatedMemoryEntry[],
  entry: RelatedMemoryEntry,
  k: number = K_STORE,
  minScore: number = MIN_SIMILARITY,
): { list: RelatedMemoryEntry[]; changed: boolean } => {
  if (entry.score < minScore) return { list, changed: false };
  const withoutEntry = list.filter(e => e.id !== entry.id);
  const existing = list.find(e => e.id === entry.id);
  if (existing && existing.score === entry.score && withoutEntry.length === list.length - 1) {
    return { list, changed: false };
  }
  if (!existing && withoutEntry.length >= k && withoutEntry[withoutEntry.length - 1].score >= entry.score) {
    return { list, changed: false };
  }
  const next = [...withoutEntry, entry].sort((a, b) => b.score - a.score).slice(0, k);
  const changed = next.length !== list.length || next.some((e, i) => e.id !== list[i].id || e.score !== list[i].score);
  return { list: next, changed };
};

const priorityOf = (modelId: string | undefined): number => MODEL_PRIORITY[modelId ?? ''] ?? 0;

/**
 * Conflict rule applied identically at local write time and sync merge time:
 * 1. Tombstone always wins (reflects memory deletion, not model quality).
 * 2. Higher MODEL_PRIORITY wins regardless of updatedAt.
 * 3. Same priority: newer updatedAt wins (ties keep local to avoid churn).
 */
export const resolveRelatedConflict = (
  local: RelatedMemoriesRecord | null | undefined,
  remote: RelatedMemoriesRecord,
): 'keepLocal' | 'takeRemote' => {
  if (!local) return 'takeRemote';
  if (local.isDeleted && !remote.isDeleted) return 'keepLocal';
  if (remote.isDeleted && !local.isDeleted) return 'takeRemote';
  const localPriority = priorityOf(local.modelId);
  const remotePriority = priorityOf(remote.modelId);
  if (localPriority !== remotePriority) {
    return remotePriority > localPriority ? 'takeRemote' : 'keepLocal';
  }
  return remote.updatedAt > local.updatedAt ? 'takeRemote' : 'keepLocal';
};
