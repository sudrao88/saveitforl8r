import { useState, useEffect, useCallback, useRef } from 'react';
import { queryBrain } from '../services/geminiService';
import { Memory, ChatMessage } from '../types';
import { v4 as uuidv4 } from 'uuid';
import {
  isNativeEmbeddingAvailable,
  generateNativeEmbedding,
  getNativeModelStatus,
  downloadNativeModel,
} from '../services/nativeEmbedding';

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

export type ModelStatus = 'idle' | 'downloading' | 'loading' | 'ready' | 'error';

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
  const [isModelCached, setIsModelCached] = useState<boolean | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const searchResolvers = useRef<Map<string, (results: any) => void>>(new Map());
  const searchTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const isNative = useRef(isNativeEmbeddingAvailable());

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
        } else if (type === 'MODEL_CACHE_STATUS') {
          setIsModelCached(payload.isCached);
        } else if (type === 'NATIVE_EMBEDDING_REQUEST') {
          // Worker is requesting a native embedding — fulfill via bridge
          handleNativeEmbeddingRequest(payload);
        }
      };

      // Send initial online status to worker
      workerRef.current.postMessage({ type: 'SET_ONLINE_STATUS', payload: { isOnline: navigator.onLine } });

      // If on native platform, tell the worker to use native embeddings
      if (isNative.current) {
        initNativeMode();
      } else {
        // Web: check model cache and status as before
        workerRef.current.postMessage({ type: 'CHECK_MODEL_CACHE' });
        workerRef.current.postMessage({ type: 'CHECK_MODEL_STATUS' });
      }

      // Start processing queue
      workerRef.current.postMessage({ type: 'START_PROCESSING' });
    }

    const updateOnlineStatus = () => {
      const online = navigator.onLine;
      setIsOnline(online);
      // Send online status update to worker so it can adjust model loading strategy
      workerRef.current?.postMessage({ type: 'SET_ONLINE_STATUS', payload: { isOnline: online } });
    };
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

  /**
   * Initialize native embedding mode: check model status, download if
   * needed, then tell the worker to use native embeddings.
   */
  const initNativeMode = async () => {
    try {
      const status = await getNativeModelStatus();

      if (status.status === 'ready') {
        activateNativeMode();
      } else if (status.status === 'not_downloaded') {
        setModelStatus('downloading');
        const result = await downloadNativeModel();
        if (result.status === 'ready') {
          activateNativeMode();
        } else {
          console.warn('[NativeEmbedding] Download did not result in ready status:', result);
          setModelStatus('error');
          setLastError(result.error || 'Failed to download native model');
          // Fall back to web mode
          workerRef.current?.postMessage({ type: 'CHECK_MODEL_CACHE' });
          workerRef.current?.postMessage({ type: 'CHECK_MODEL_STATUS' });
        }
      } else if (status.status === 'error') {
        console.warn('[NativeEmbedding] Native model error, falling back to web:', status.error);
        setLastError(status.error || 'Native model error');
        // Fall back to web mode
        workerRef.current?.postMessage({ type: 'CHECK_MODEL_CACHE' });
        workerRef.current?.postMessage({ type: 'CHECK_MODEL_STATUS' });
      }
    } catch (err: any) {
      console.warn('[NativeEmbedding] Failed to init native mode, falling back to web:', err);
      // Fall back to web mode
      workerRef.current?.postMessage({ type: 'CHECK_MODEL_CACHE' });
      workerRef.current?.postMessage({ type: 'CHECK_MODEL_STATUS' });
    }
  };

  const activateNativeMode = () => {
    console.log('[NativeEmbedding] Activating native embedding mode (768-dim)');
    workerRef.current?.postMessage({
      type: 'SET_NATIVE_MODE',
      payload: { enabled: true }
    });
    setModelStatus('ready');
    setIsModelCached(true);
  };

  /**
   * Handle a NATIVE_EMBEDDING_REQUEST from the worker.
   * Generate the embedding via the native bridge and send it back.
   */
  const handleNativeEmbeddingRequest = async (payload: { text: string; requestId: string }) => {
    try {
      const result = await generateNativeEmbedding(payload.text);
      workerRef.current?.postMessage({
        type: 'NATIVE_EMBEDDING_RESPONSE',
        payload: {
          requestId: payload.requestId,
          embedding: result.embedding
        }
      });
    } catch (err: any) {
      console.error('[NativeEmbedding] Failed to generate embedding:', err);
      // Send zero vector so the worker doesn't hang
      const dimensions = 768;
      workerRef.current?.postMessage({
        type: 'NATIVE_EMBEDDING_RESPONSE',
        payload: {
          requestId: payload.requestId,
          embedding: new Array(dimensions).fill(0)
        }
      });
    }
  };

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

  const search = useCallback(async (query: string, memories: Memory[] = [], history: ChatMessage[] = []): Promise<{ mode: string; result: any; error?: any }> => {
    if (!query.trim()) {
      return { mode: 'empty', result: [] };
    }

    setIsSearching(true);

    try {
      if (isOnline) {
        // Online: use server proxy for AI-powered search
        const result = await queryBrain(query, memories, history);
        setIsSearching(false);
        return { mode: 'online', result };
      } else {
        // Offline: fall back to local embedding model
        if (modelStatus === 'error') {
             setIsSearching(false);
             return {
                 mode: 'offline_model_error',
                 result: [],
                 error: lastError || 'The search model failed to load. Please check Settings for details.'
             };
        }
        if (modelStatus !== 'ready' && modelStatus !== 'loading') {
             console.warn("Local model not ready, status:", modelStatus);
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
            mode: 'offline',
            result: results
        };
      }
    } catch (e) {
      console.error("Search failed", e);
      setIsSearching(false);
      return { mode: 'error', result: [], error: e };
    }
  }, [isOnline, modelStatus, lastError]);

  const retryDownload = () => {
       setLastError(null); // Clear error on retry
       if (isNative.current) {
           initNativeMode();
       } else {
           workerRef.current?.postMessage({ type: 'CHECK_MODEL_STATUS' });
       }
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

  const checkModelCache = () => {
       workerRef.current?.postMessage({ type: 'CHECK_MODEL_CACHE' });
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
    lastError,
    isModelCached,
    checkModelCache
  };
};
