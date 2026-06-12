import { useState, useEffect, useMemo } from 'react';
import { Memory } from '../types';
import { getAllRelatedMemoriesIncludingDeleted } from '../services/storageService';
import { K_DISPLAY, RELATED_MEMORIES_UPDATED_EVENT } from '../services/relatedMemories';

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

/**
 * Resolves persisted related-memories records against the live memory list,
 * producing a per-memory display map for MemoryCard. Records are synced from
 * Drive (native devices are the source of truth) or computed locally by the
 * embedding worker; either path dispatches RELATED_MEMORIES_UPDATED_EVENT.
 */
export const useRelatedMemories = (memories: Memory[]) => {
  const [recordMap, setRecordMap] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const records = await getAllRelatedMemoriesIncludingDeleted();
        if (cancelled) return;
        const map = new Map<string, string[]>();
        for (const record of records) {
          if (record.isDeleted || record.related.length === 0) continue;
          map.set(record.memoryId, record.related.map(e => e.id));
        }
        setRecordMap(map);
      } catch (e) {
        console.error('[Related] Failed to load related memories:', e);
      }
    };

    load();
    const handleUpdate = () => { load(); };
    window.addEventListener(RELATED_MEMORIES_UPDATED_EVENT, handleUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener(RELATED_MEMORIES_UPDATED_EVENT, handleUpdate);
    };
  }, []);

  const relatedByMemory = useMemo(() => {
    const liveById = new Map(
      memories.filter(m => !m.isDeleted).map(m => [m.id, m])
    );
    const result = new Map<string, RelatedMemoryDisplayItem[]>();
    for (const [memoryId, relatedIds] of recordMap) {
      if (!liveById.has(memoryId)) continue;
      const items: RelatedMemoryDisplayItem[] = [];
      for (const id of relatedIds) {
        const target = liveById.get(id);
        if (!target) continue; // deleted or not yet synced — drop silently
        items.push({ id, title: titleForMemory(target) });
        if (items.length >= K_DISPLAY) break;
      }
      if (items.length > 0) result.set(memoryId, items);
    }
    return result;
  }, [recordMap, memories]);

  return { relatedByMemory };
};
