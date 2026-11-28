import { useEffect, useMemo, useRef, useState } from 'react';
import { Memory } from '../types';
import { embedTexts } from '../services/geminiService';
import { MAX_QUERY_LENGTH, queryTerms, searchNotes, SearchResult } from '../utils/noteSearch';
import { useOnlineStatus } from './useOnlineStatus';

/** Wait this long after the last keystroke before embedding the query. */
export const EMBED_DEBOUNCE_MS = 450;
/** Query vectors kept for re-typed / revisited queries. */
const VECTOR_CACHE_SIZE = 50;

export type SemanticStatus = 'idle' | 'pending' | 'ready' | 'offline' | 'error';

/**
 * Hybrid search over the user's notes. Keyword results update on every
 * keystroke; once typing pauses the query (only the query) is embedded by the
 * server and semantic matches are merged in. Offline it stays keyword-only.
 */
export const useNoteSearch = (memories: Memory[], query: string) => {
  const isOnline = useOnlineStatus();
  const normalized = query.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
  const cacheKey = normalized.toLowerCase();

  const cache = useRef(new Map<string, number[]>());
  const [vectorFor, setVectorFor] = useState<{ key: string; vector: number[] } | null>(null);
  const [status, setStatus] = useState<SemanticStatus>('idle');

  useEffect(() => {
    if (!cacheKey || queryTerms(cacheKey).length === 0) {
      setStatus('idle');
      return;
    }
    const cached = cache.current.get(cacheKey);
    if (cached) {
      setVectorFor({ key: cacheKey, vector: cached });
      setStatus('ready');
      return;
    }
    if (!isOnline) {
      setStatus('offline');
      return;
    }

    setStatus('pending');
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const [vector] = await embedTexts([normalized]);
        if (!Array.isArray(vector) || vector.length === 0) throw new Error('Empty query embedding');
        cache.current.set(cacheKey, vector);
        if (cache.current.size > VECTOR_CACHE_SIZE) {
          const oldest = cache.current.keys().next().value;
          if (oldest !== undefined) cache.current.delete(oldest);
        }
        if (cancelled) return;
        setVectorFor({ key: cacheKey, vector });
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        console.warn('[Search] Query embedding failed, showing keyword results only', e);
        setStatus('error');
      }
    }, EMBED_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cacheKey, normalized, isOnline]);

  // Only use a vector that belongs to the current query.
  const queryVector = vectorFor && vectorFor.key === cacheKey ? vectorFor.vector : null;

  const results: SearchResult[] = useMemo(
    () => (normalized ? searchNotes(memories, normalized, queryVector) : []),
    [memories, normalized, queryVector],
  );

  const terms = useMemo(() => queryTerms(normalized), [normalized]);

  return { results, terms, semanticStatus: status, isOnline };
};
