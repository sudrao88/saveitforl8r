
import { useState, useMemo } from 'react';
import { Memory } from '../types';

// Helper to extract strictly user-entered tags (approximated by diffing total tags vs AI tags)
const getUserTags = (memory: Memory): string[] => {
    const aiTags = new Set(memory.enrichment?.suggestedTags || []);
    return memory.tags.filter(t => !aiTags.has(t));
};

export const useMemoryFilters = (memories: Memory[]) => {
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);

  const { availableTypes, availableTags, filteredMemories } = useMemo(() => {
    // 1. Extract Filter Options
    const types = new Set<string>();
    const tags = new Set<string>();

    memories.forEach(m => {
        if (m.enrichment?.entityContext?.type) {
            types.add(m.enrichment.entityContext.type);
        }
        // Collect only user tags for the filter list
        getUserTags(m).forEach(t => tags.add(t));
    });

    // 2. Filter Memories
    const filtered = memories.filter(m => {
        if (filterType && m.enrichment?.entityContext?.type !== filterType) {
            return false;
        }
        if (filterTag && !m.tags.includes(filterTag)) {
            return false;
        }
        return true;
    });

    return {
        availableTypes: Array.from(types).sort(),
        availableTags: Array.from(tags).sort(),
        filteredMemories: filtered
    };
  }, [memories, filterType, filterTag]);

  const clearFilters = () => {
      setFilterType(null);
      setFilterTag(null);
  };

  return {
    filterType,
    setFilterType,
    filterTag,
    setFilterTag,
    availableTypes,
    availableTags,
    filteredMemories,
    clearFilters
  };
};
