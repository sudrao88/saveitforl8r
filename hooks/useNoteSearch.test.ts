import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Memory, EMBEDDING_MODEL_ID } from '../types';

vi.mock('../services/geminiService', () => ({
  embedTexts: vi.fn(),
}));

import { embedTexts } from '../services/geminiService';
import { useNoteSearch, EMBED_DEBOUNCE_MS } from './useNoteSearch';

const mockEmbed = embedTexts as unknown as ReturnType<typeof vi.fn>;

const memories: Memory[] = [
  {
    id: 'espresso', content: '', timestamp: 0, tags: [],
    enrichment: {
      summary: '', suggestedTags: [], entityContext: { type: 'Other', title: 'Espresso bar' },
      embedding: [1, 0], embeddingModel: EMBEDDING_MODEL_ID,
    } as Memory['enrichment'],
  },
  {
    id: 'shoes', content: 'running shoes', timestamp: 0, tags: [],
    enrichment: { summary: '', suggestedTags: [], embedding: [0, 1], embeddingModel: EMBEDDING_MODEL_ID } as Memory['enrichment'],
  },
];

const setOnline = (value: boolean) =>
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });

describe('useNoteSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockEmbed.mockReset();
    setOnline(true);
  });
  afterEach(() => vi.useRealTimers());

  it('shows keyword results immediately, then merges semantic ones after the debounce', async () => {
    mockEmbed.mockResolvedValue([[1, 0]]);
    const { result } = renderHook(({ q }) => useNoteSearch(memories, q), { initialProps: { q: 'caffeine' } });

    expect(result.current.results).toEqual([]);
    expect(result.current.semanticStatus).toBe('pending');
    expect(mockEmbed).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(EMBED_DEBOUNCE_MS); });

    expect(mockEmbed).toHaveBeenCalledWith(['caffeine']);
    expect(result.current.semanticStatus).toBe('ready');
    expect(result.current.results.map(r => r.id)).toEqual(['espresso']);
  });

  it('embeds only the settled query while typing', async () => {
    mockEmbed.mockResolvedValue([[1, 0]]);
    const { rerender } = renderHook(({ q }) => useNoteSearch(memories, q), { initialProps: { q: 'c' } });
    rerender({ q: 'ca' });
    rerender({ q: 'caf' });
    await act(async () => { await vi.advanceTimersByTimeAsync(EMBED_DEBOUNCE_MS); });
    expect(mockEmbed).toHaveBeenCalledTimes(1);
    expect(mockEmbed).toHaveBeenCalledWith(['caf']);
  });

  it('reuses a cached vector for a repeated query', async () => {
    mockEmbed.mockResolvedValue([[1, 0]]);
    const { rerender } = renderHook(({ q }) => useNoteSearch(memories, q), { initialProps: { q: 'espresso' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(EMBED_DEBOUNCE_MS); });
    rerender({ q: 'shoes' });
    await act(async () => { await vi.advanceTimersByTimeAsync(EMBED_DEBOUNCE_MS); });
    rerender({ q: 'Espresso' });
    await act(async () => { await vi.advanceTimersByTimeAsync(EMBED_DEBOUNCE_MS); });
    expect(mockEmbed).toHaveBeenCalledTimes(2);
  });

  it('stays keyword-only offline', async () => {
    setOnline(false);
    const { result } = renderHook(() => useNoteSearch(memories, 'shoes'));
    await act(async () => { await vi.advanceTimersByTimeAsync(EMBED_DEBOUNCE_MS); });
    expect(mockEmbed).not.toHaveBeenCalled();
    expect(result.current.semanticStatus).toBe('offline');
    expect(result.current.results.map(r => r.id)).toEqual(['shoes']);
  });

  it('falls back to keyword results when embedding fails', async () => {
    mockEmbed.mockRejectedValue(new Error('429'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useNoteSearch(memories, 'shoes'));
    await act(async () => { await vi.advanceTimersByTimeAsync(EMBED_DEBOUNCE_MS); });
    expect(result.current.semanticStatus).toBe('error');
    expect(result.current.results.map(r => r.id)).toEqual(['shoes']);
  });
});
