import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMemoryFilters } from './useMemoryFilters';
import { Memory } from '../types';

const makeMemory = (overrides: Partial<Memory> = {}): Memory => ({
  id: 'id-' + Math.random().toString(36).slice(2),
  timestamp: Date.now(),
  content: '',
  tags: [],
  ...overrides,
});

describe('useMemoryFilters', () => {
  it('starts with no active filter', () => {
    const { result } = renderHook(() => useMemoryFilters([]));
    expect(result.current.filterType).toBeNull();
    expect(result.current.availableTypes).toEqual([]);
    expect(result.current.filteredMemories).toEqual([]);
  });

  it('extracts distinct entity types from memories and sorts them', () => {
    const memories = [
      makeMemory({ enrichment: { summary: '', suggestedTags: [], entityContext: { type: 'Movie' } } as Memory['enrichment'] }),
      makeMemory({ enrichment: { summary: '', suggestedTags: [], entityContext: { type: 'Book' } } as Memory['enrichment'] }),
      makeMemory({ enrichment: { summary: '', suggestedTags: [], entityContext: { type: 'Movie' } } as Memory['enrichment'] }),
      makeMemory(), // no enrichment — ignored
    ];
    const { result } = renderHook(() => useMemoryFilters(memories));
    expect(result.current.availableTypes).toEqual(['Book', 'Movie']);
  });

  it('returns all memories when no filter is active', () => {
    const memories = [
      makeMemory({ enrichment: { summary: '', suggestedTags: [], entityContext: { type: 'Movie' } } as Memory['enrichment'] }),
      makeMemory(),
    ];
    const { result } = renderHook(() => useMemoryFilters(memories));
    expect(result.current.filteredMemories).toHaveLength(2);
  });

  it('filters memories by active entity type', () => {
    const movie = makeMemory({ id: 'mv', enrichment: { summary: '', suggestedTags: [], entityContext: { type: 'Movie' } } as Memory['enrichment'] });
    const book = makeMemory({ id: 'bk', enrichment: { summary: '', suggestedTags: [], entityContext: { type: 'Book' } } as Memory['enrichment'] });
    const bare = makeMemory({ id: 'plain' });
    const { result } = renderHook(() => useMemoryFilters([movie, book, bare]));

    act(() => {
      result.current.setFilterType('Movie');
    });

    expect(result.current.filterType).toBe('Movie');
    expect(result.current.filteredMemories.map(m => m.id)).toEqual(['mv']);
  });

  it('excludes memories without enrichment when a filter is active', () => {
    const movie = makeMemory({ id: 'mv', enrichment: { summary: '', suggestedTags: [], entityContext: { type: 'Movie' } } as Memory['enrichment'] });
    const bare = makeMemory({ id: 'plain' });
    const { result } = renderHook(() => useMemoryFilters([movie, bare]));

    act(() => {
      result.current.setFilterType('Movie');
    });

    expect(result.current.filteredMemories.map(m => m.id)).toEqual(['mv']);
  });

  it('clearFilters resets the active filter', () => {
    const movie = makeMemory({ id: 'mv', enrichment: { summary: '', suggestedTags: [], entityContext: { type: 'Movie' } } as Memory['enrichment'] });
    const book = makeMemory({ id: 'bk', enrichment: { summary: '', suggestedTags: [], entityContext: { type: 'Book' } } as Memory['enrichment'] });
    const { result } = renderHook(() => useMemoryFilters([movie, book]));

    act(() => {
      result.current.setFilterType('Movie');
    });
    expect(result.current.filteredMemories).toHaveLength(1);

    act(() => {
      result.current.clearFilters();
    });
    expect(result.current.filterType).toBeNull();
    expect(result.current.filteredMemories).toHaveLength(2);
  });

  it('re-computes availableTypes when the memory list changes', () => {
    const initial = [
      makeMemory({ enrichment: { summary: '', suggestedTags: [], entityContext: { type: 'Movie' } } as Memory['enrichment'] }),
    ];
    const { result, rerender } = renderHook(
      ({ memories }: { memories: Memory[] }) => useMemoryFilters(memories),
      { initialProps: { memories: initial } },
    );
    expect(result.current.availableTypes).toEqual(['Movie']);

    rerender({
      memories: [
        ...initial,
        makeMemory({ enrichment: { summary: '', suggestedTags: [], entityContext: { type: 'Book' } } as Memory['enrichment'] }),
      ],
    });
    expect(result.current.availableTypes).toEqual(['Book', 'Movie']);
  });

  it('keeps filterType stable when memories change but the filter is still valid', () => {
    const movie = makeMemory({ id: 'mv', enrichment: { summary: '', suggestedTags: [], entityContext: { type: 'Movie' } } as Memory['enrichment'] });
    const { result, rerender } = renderHook(
      ({ memories }: { memories: Memory[] }) => useMemoryFilters(memories),
      { initialProps: { memories: [movie] } },
    );
    act(() => {
      result.current.setFilterType('Movie');
    });
    rerender({
      memories: [
        movie,
        makeMemory({ id: 'mv2', enrichment: { summary: '', suggestedTags: [], entityContext: { type: 'Movie' } } as Memory['enrichment'] }),
      ],
    });
    expect(result.current.filterType).toBe('Movie');
    expect(result.current.filteredMemories).toHaveLength(2);
  });

  it('returns an empty list when the active filter matches no memories', () => {
    const book = makeMemory({ enrichment: { summary: '', suggestedTags: [], entityContext: { type: 'Book' } } as Memory['enrichment'] });
    const { result } = renderHook(() => useMemoryFilters([book]));
    act(() => {
      result.current.setFilterType('Movie');
    });
    expect(result.current.filteredMemories).toEqual([]);
  });
});
