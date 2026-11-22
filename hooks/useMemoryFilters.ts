import { useState, useMemo, useCallback } from 'react';
import { Memory } from '../types';

export interface MemoryFilters {
  hasImage: boolean;
  hasAttachment: boolean;
}

export type MemoryFilterKey = keyof MemoryFilters;

const EMPTY_FILTERS: MemoryFilters = { hasImage: false, hasAttachment: false };

/**
 * True when the note carries at least one image — either an image attachment
 * or the legacy `image` field. Deferred-sync notes have their attachment data
 * blanked to '' but keep the entries, so we check presence, not content.
 */
export const memoryHasImage = (m: Memory): boolean => {
  if (m.attachments?.some(a => a.type === 'image')) return true;
  if (!m.attachments?.length && m.image !== undefined && m.image !== null) {
    return m.image !== '' || m._attachmentsDeferred === true;
  }
  return false;
};

/** True when the note carries at least one non-image file attachment (PDF, doc, etc.). */
export const memoryHasAttachment = (m: Memory): boolean =>
  m.attachments?.some(a => a.type === 'file') ?? false;

export const useMemoryFilters = (memories: Memory[]) => {
  const [filters, setFilters] = useState<MemoryFilters>(EMPTY_FILTERS);

  const filteredMemories = useMemo(() => {
    if (!filters.hasImage && !filters.hasAttachment) return memories;
    return memories.filter(m => {
      if (filters.hasImage && !memoryHasImage(m)) return false;
      if (filters.hasAttachment && !memoryHasAttachment(m)) return false;
      return true;
    });
  }, [memories, filters]);

  const toggleFilter = useCallback((key: MemoryFilterKey) => {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
  }, []);

  const hasActiveFilters = filters.hasImage || filters.hasAttachment;

  return {
    filters,
    toggleFilter,
    hasActiveFilters,
    filteredMemories,
    clearFilters
  };
};
