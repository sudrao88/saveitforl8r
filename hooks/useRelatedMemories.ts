import { useState, useEffect, useMemo, useRef } from 'react';
import { Memory, EMBEDDING_MODEL_ID } from '../types';
import { K_DISPLAY, MemoryVector } from '../services/relatedMemories';

export interface RelatedMemoryDisplayItem {
  id: string;
  title: string;
  // Tags shared with the source note — the human-readable "why" behind an
  // (otherwise opaque) embedding-driven match. Empty when the notes overlap
  // semantically but share no tags.
  sharedTags: string[];
}

// How many shared tags to surface per related row before truncating.
const MAX_SHARED_TAGS = 6;

// Effective tag set for explaining a match: the user's finalized tags plus the
// AI's suggested tags. Both feed the embedding, so either is a fair signal.
const tagsOf = (m: Memory): string[] => {
  const out: string[] = [];
  if (Array.isArray(m.tags)) out.push(...m.tags);
  const suggested = m.enrichment?.suggestedTags;
  if (Array.isArray(suggested)) out.push(...suggested);
  // Defend against non-string entries from legacy/synced data before any
  // string ops downstream (.trim()/.toLowerCase()).
  return out.filter((t): t is string => typeof t === 'string');
};

// Tags common to both notes (case-insensitive), keeping the source note's
// original casing for display and de-duplicating across its tags + suggestions.
const sharedTagsBetween = (source: Memory, target: Memory): string[] => {
  const targetSet = new Set(
    tagsOf(target).map(t => t.trim().toLowerCase()).filter(Boolean),
  );
  if (targetSet.size === 0) return [];
  const seen = new Set<string>();
  const shared: string[] = [];
  for (const raw of tagsOf(source)) {
    const norm = raw.trim().toLowerCase();
    if (!norm || seen.has(norm) || !targetSet.has(norm)) continue;
    seen.add(norm);
    shared.push(raw.trim());
    if (shared.length >= MAX_SHARED_TAGS) break;
  }
  return shared;
};

// Best human-readable label for a related-memory row: AI entity title, then
// summary, then the note content itself.
const titleForMemory = (memory: Memory): string => {
  const entityTitle = memory.enrichment?.entityContext?.title;
  if (entityTitle) return entityTitle;
  if (memory.enrichment?.summary) return memory.enrichment.summary;
  // Content may be HTML (rich editor) — strip tags for the label
  return memory.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
};

// Only match vectors from the CURRENT embedding model. A superseded model's
// vectors share the same dimensionality but live in a different space, so
// comparing across models produces bogus "related" notes. Stale-model notes are
// excluded here (showing no related notes) until useRelatedEmbeddingBackfill
// re-embeds them, at which point they re-enter the matcher.
const hasEmbedding = (m: Memory): boolean =>
  !m.isDeleted &&
  Array.isArray(m.enrichment?.embedding) &&
  m.enrichment!.embedding!.length > 0 &&
  m.enrichment!.embeddingModel === EMBEDDING_MODEL_ID;

/**
 * Computes per-memory "related notes" from the embeddings the server generated
 * and synced with each memory. Matching runs in a dedicated worker (pure cosine
 * math, no ML model); the worker is fed vector deltas whenever the embedding set
 * changes, and returns the full related-id map which we resolve against the
 * live memory list for display.
 */
export const useRelatedMemories = (memories: Memory[]) => {
  const [relatedIdMap, setRelatedIdMap] = useState<Record<string, string[]>>({});
  const workerRef = useRef<Worker | null>(null);
  // Last embedding array reference sent per memory id — lets us send only deltas
  // (a re-enriched note gets a new array reference, so it's detected as changed).
  const sentRef = useRef<Map<string, number[]>>(new Map());

  // Create the matcher worker once.
  useEffect(() => {
    const worker = new Worker(new URL('../services/relatedMatcher.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent) => {
      if (e.data?.type === 'RELATED_MAP') {
        setRelatedIdMap(e.data.payload.map || {});
      }
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
      sentRef.current.clear();
    };
  }, []);

  // Feed vector deltas to the worker whenever the embedding set changes.
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;

    const current = new Map<string, number[]>();
    for (const m of memories) {
      if (hasEmbedding(m)) current.set(m.id, m.enrichment!.embedding!);
    }

    const sent = sentRef.current;
    const added: MemoryVector[] = [];
    const removed: string[] = [];

    for (const [id, vector] of current) {
      if (sent.get(id) !== vector) added.push({ id, vector }); // new or changed reference
    }
    for (const id of sent.keys()) {
      if (!current.has(id)) removed.push(id);
    }

    if (added.length === 0 && removed.length === 0) return;

    sentRef.current = current;
    worker.postMessage({ type: 'UPDATE_VECTORS', payload: { added, removed } });
  }, [memories]);

  const relatedByMemory = useMemo(() => {
    const liveById = new Map(memories.filter(m => !m.isDeleted).map(m => [m.id, m]));
    const result = new Map<string, RelatedMemoryDisplayItem[]>();
    for (const memoryId of Object.keys(relatedIdMap)) {
      const source = liveById.get(memoryId);
      if (!source) continue;
      const items: RelatedMemoryDisplayItem[] = [];
      for (const id of relatedIdMap[memoryId]) {
        const target = liveById.get(id);
        if (!target) continue; // deleted — drop silently
        items.push({ id, title: titleForMemory(target), sharedTags: sharedTagsBetween(source, target) });
        if (items.length >= K_DISPLAY) break;
      }
      if (items.length > 0) result.set(memoryId, items);
    }
    return result;
  }, [relatedIdMap, memories]);

  return { relatedByMemory };
};
