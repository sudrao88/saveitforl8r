
import { useState, useMemo, useCallback } from 'react';
import { Memory } from '../types';

export const useMemoryFilters = (memories: Memory[]) => {
  const [filterType, setFilterType] = useState<string | null>(null);

  const { availableTypes, filteredMemories } = useMemo(() => {
    // 1. Extract Filter Options
    const types = new Set<string>();

    memories.forEach(m => {
        if (m.enrichment?.entityContext?.type) {
            types.add(m.enrichment.entityContext.type);
        }
    });

    // 2. Filter Memories
    const filtered = memories.filter(m => {
        if (filterType && m.enrichment?.entityContext?.type !== filterType) {
            return false;
        }
        return true;
    });

    return {
        availableTypes: Array.from(types).sort(),
        filteredMemories: filtered
    };
  }, [memories, filterType]);

  const clearFilters = useCallback(() => {
      setFilterType(null);
  }, []);

  const handleSetFilterType = useCallback((type: string | null) => {
    setFilterType(type);
  }, []);

  return {
    filterType,
    setFilterType: handleSetFilterType,
    availableTypes,
    filteredMemories,
    clearFilters
  };
};
