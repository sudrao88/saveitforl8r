import { useCallback, useMemo, useRef, useState } from 'react';
import { postProxy } from '@l8r/shared/ai';
import type { Album, Photo } from '../types';

// Natural-language gallery search. Builds a compact per-photo context block from
// the locally-enriched metadata (caption/tags/date/albums), POSTs it to
// /api/query-gallery, and resolves the returned ids back to Photos (preserving
// the model's relevance order).

// Server caps photoContexts at 1000; prefer the enriched ones so the budget is
// spent on photos that actually carry searchable text.
const MAX_CONTEXTS = 1000;

export type SearchStatus = 'idle' | 'searching' | 'done' | 'error';

interface GalleryQueryResponse {
  photoIds: string[];
  reasoning?: string;
}

interface PhotoContext {
  id: string;
  caption?: string;
  tags: string[];
  capturedAt: number;
  albumTitles: string[];
}

export const useGallerySearch = (photos: Photo[], albums: Album[] = []) => {
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [results, setResults] = useState<Photo[]>([]);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Guard against an out-of-order response landing after a newer search.
  const searchSeq = useRef(0);

  const albumTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of albums) m.set(a.id, a.title);
    return m;
  }, [albums]);

  const photoById = useMemo(() => {
    const m = new Map<string, Photo>();
    for (const p of photos) m.set(p.id, p);
    return m;
  }, [photos]);

  const buildContexts = useCallback((): PhotoContext[] => {
    const toContext = (p: Photo): PhotoContext => ({
      id: p.id,
      caption: p.caption,
      tags: p.tags ?? [],
      capturedAt: p.capturedAt,
      albumTitles: (p.albumIds ?? [])
        .map((id) => albumTitleById.get(id))
        .filter((t): t is string => Boolean(t)),
    });

    // Enriched photos first; fall back to including everything (so search still
    // works on dates/albums) only when nothing has been captioned yet.
    const enriched = photos.filter((p) => p.caption || (p.tags && p.tags.length > 0));
    const source = enriched.length > 0 ? enriched : photos;
    return source.slice(0, MAX_CONTEXTS).map(toContext);
  }, [photos, albumTitleById]);

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    setQuery(q);
    if (!trimmed) {
      setStatus('idle');
      setResults([]);
      setReasoning(null);
      return;
    }

    const seq = ++searchSeq.current;
    setStatus('searching');
    setError(null);
    setReasoning(null);

    try {
      const photoContexts = buildContexts();
      const res = await postProxy<GalleryQueryResponse>('/api/query-gallery', {
        query: trimmed,
        photoContexts,
      });
      if (seq !== searchSeq.current) return; // superseded

      const matched = (res.photoIds ?? [])
        .map((id) => photoById.get(id))
        .filter((p): p is Photo => Boolean(p));
      setResults(matched);
      setReasoning(res.reasoning ?? null);
      setStatus('done');
    } catch (e) {
      if (seq !== searchSeq.current) return;
      console.error('[l8rgram] Gallery search failed', e);
      setError(e instanceof Error ? e.message : 'Search failed.');
      setStatus('error');
    }
  }, [buildContexts, photoById]);

  const clear = useCallback(() => {
    searchSeq.current++;
    setQuery('');
    setResults([]);
    setReasoning(null);
    setError(null);
    setStatus('idle');
  }, []);

  return { query, status, results, reasoning, error, search, clear };
};
