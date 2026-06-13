import { useState, useEffect, useMemo, useRef } from 'react';
import { Memory } from '../types';
import { K_DISPLAY, MemoryVector } from '../services/relatedMemories';

export interface RelatedMemoryDisplayItem {
  id: string;
  title: string;
}

// Best human-readable label for a related-memory row: AI entity title, then
// summary, then the note content itself.
const titleForMemory = (memory: Memory): string => {
  const entityTitle = memory.enrichment?.entityContext?.title;
  if (entityTitle) return entityTitle;
  if (memory.enrichment?.summary) return memory.enrichment.summary;
  // Content may be HTML (rich editor) — strip tags for the label
  return memory.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
};

const hasEmbedding = (m: Memory): boolean =>
  !m.isDeleted && Array.isArray(m.enrichment?.embedding) && m.enrichment!.embedding!.length > 0;

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
      if (!liveById.has(memoryId)) continue;
      const items: RelatedMemoryDisplayItem[] = [];
      for (const id of relatedIdMap[memoryId]) {
        const target = liveById.get(id);
        if (!target) continue; // deleted — drop silently
        items.push({ id, title: titleForMemory(target) });
        if (items.length >= K_DISPLAY) break;
      }
      if (items.length > 0) result.set(memoryId, items);
    }
    return result;
  }, [relatedIdMap, memories]);

  return { relatedByMemory };
};
