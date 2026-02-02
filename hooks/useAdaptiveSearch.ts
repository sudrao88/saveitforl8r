import { useState, useEffect, useCallback, useRef } from 'react';
import { queryBrain } from '../services/geminiService';
import { Memory } from '../types';
import { v4 as uuidv4 } from 'uuid';

export interface SearchResultItem {
  id: string;
  text: string;
  score?: number;
  metadata?: any;
}

export interface EmbeddingStats {
  pending: number;
  failed: number;
  completed: number;
}

export type ModelStatus = 'idle' | 'downloading' | 'ready' | 'error';

// Timeout for worker search queries (30 seconds)
const SEARCH_TIMEOUT_MS = 30_000;

export const useAdaptiveSearch = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle');
  const [downloadProgress, setDownloadProgress] = useState<any>(null);
  const [embeddingStats, setEmbeddingStats] = useState<EmbeddingStats>({ pending: 0, failed: 0, completed: 0 });
  const [lastError, setLastError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const searchResolvers = useRef<Map<string, (results: any) => void>>(new Map());
  const searchTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Initialize Worker
  useEffect(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../services/embedding.worker.ts', import.meta.url), {
        type: 'module'
      });

      // Handle Worker Errors (e.g. initialization failure, OOM)
      workerRef.current.onerror = (err) => {
          console.error("Worker Error:", err);
          setModelStatus('error');
          setLastError(err.message || "Unknown Worker Error");
      };

      workerRef.current.onmessage = (e) => {
        const { type, payload, queryId, error } = e.data;

        if (type === 'MODEL_STATUS') {
          setModelStatus(payload);
          if (payload === 'error' && error) {
              setLastError(error.message || String(error));
          }
        } else if (type === 'MODEL_DOWNLOAD_PROGRESS') {
          setDownloadProgress(payload);
        } else if (type === 'STATS_UPDATE') {
          setEmbeddingStats(payload);
        } else if (type === 'SEARCH_RESULTS') {
          resolveSearch(queryId, payload);
        } else if (type === 'SEARCH_ERROR') {
          resolveSearch(queryId, []);
          console.error("Worker Search Error:", error);
        }
      };

      // Check model status on init
      workerRef.current.postMessage({ type: 'CHECK_MODEL_STATUS' });
      // Start processing queue
      workerRef.current.postMessage({ type: 'START_PROCESSING' });
    }

    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
      // Clean up all pending search resolvers and timers on unmount
      for (const [queryId, timer] of searchTimers.current) {
          clearTimeout(timer);
      }
      searchTimers.current.clear();
      // Resolve any remaining search promises with empty results
      for (const [, resolve] of searchResolvers.current) {
          resolve([]);
      }
      searchResolvers.current.clear();
      // Terminate the worker to free memory (model + Orama index)
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Resolve a search query and clean up its timeout timer
  const resolveSearch = (queryId: string, results: any) => {
      const resolve = searchResolvers.current.get(queryId);
      if (resolve) {
          resolve(results);
          searchResolvers.current.delete(queryId);
      }
      const timer = searchTimers.current.get(queryId);
      if (timer) {
          clearTimeout(timer);
          searchTimers.current.delete(queryId);
      }
  };

  const search = useCallback(async (query: string, memories: Memory[] = []) => {
    if (!query.trim()) return;

    setIsSearching(true);

    const apiKey = localStorage.getItem('gemini_api_key');
    const hasKey = !!apiKey;

    try {
      if (isOnline && hasKey) {
        const result = await queryBrain(query, memories);
        setIsSearching(false);
        return { mode: 'online', result };
      } else {
        if (modelStatus !== 'ready') {
             console.warn("Local model not ready");
        }

        const queryId = uuidv4();
        const promise = new Promise<SearchResultItem[]>((resolve) => {
          searchResolvers.current.set(queryId, resolve);

          // Auto-timeout to prevent resolver from leaking if the worker
          // never responds (e.g., crash, OOM, or stalled processing)
          const timer = setTimeout(() => {
              if (searchResolvers.current.has(queryId)) {
                  console.warn(`[Search] Query ${queryId} timed out after ${SEARCH_TIMEOUT_MS}ms`);
                  resolveSearch(queryId, []);
              }
          }, SEARCH_TIMEOUT_MS);
          searchTimers.current.set(queryId, timer);
        });

        workerRef.current?.postMessage({
          type: 'SEARCH',
          payload: { query, queryId }
        });

        const results = await promise;
        setIsSearching(false);

        return {
            mode: (isOnline && !hasKey) ? 'offline_no_key' : 'offline',
            result: results
        };
      }
    } catch (e) {
      console.error("Search failed", e);
      setIsSearching(false);
      return { mode: 'error', error: e };
    }
  }, [isOnline, modelStatus]);

  const retryDownload = () => {
       setLastError(null); // Clear error on retry
       workerRef.current?.postMessage({ type: 'CHECK_MODEL_STATUS' });
  };

  const retryFailedEmbeddings = () => {
       workerRef.current?.postMessage({ type: 'RETRY_FAILED' });
  };

  const deleteNoteFromIndex = (noteId: string) => {
       workerRef.current?.postMessage({ type: 'DELETE_NOTE', payload: { noteId } });
  };

  const rebuildIndex = () => {
       workerRef.current?.postMessage({ type: 'REBUILD_INDEX' });
  };

  const closeWorkerDB = () => {
       workerRef.current?.postMessage({ type: 'CLOSE_DB' });
  };

  return {
    search,
    isOnline,
    isSearching,
    modelStatus,
    downloadProgress,
    retryDownload,
    embeddingStats,
    retryFailedEmbeddings,
    deleteNoteFromIndex,
    rebuildIndex,
    closeWorkerDB,
    lastError
  };
};
