import { useState, useEffect, useCallback, useRef } from 'react';
import { queryBrain } from '../services/geminiService';
import { Memory, ChatMessage, RelatedMemoriesRecord } from '../types';
import { v4 as uuidv4 } from 'uuid';
import TextEmbedder, { isNativeEmbedderReady } from '../services/textEmbedderPlugin';
import { WEB_EMBEDDING_MODEL, NATIVE_EMBEDDING_MODEL, EmbeddingModelInfo } from '../services/embeddingModels';
import { persistComputedRelatedMemories } from '../services/storageService';
import { RELATED_MEMORIES_UPDATED_EVENT, RELATED_MEMORIES_NEED_SYNC_EVENT } from '../services/relatedMemories';

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

  const [activeModel, setActiveModel] = useState<EmbeddingModelInfo | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const searchResolvers = useRef<Map<string, (results: any) => void>>(new Map());
  const searchTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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

  // Service a native embed RPC from the worker (Capacitor plugins are only
  // callable from the main JS context).
  const handleEmbedRequest = async (worker: Worker, requestId: string, texts: string[]) => {
    try {
      const { vectors } = await TextEmbedder.embed({ texts });
      worker.postMessage({ type: 'EMBED_RESPONSE', payload: { requestId, vectors } });
    } catch (e: any) {
      worker.postMessage({ type: 'EMBED_RESPONSE', payload: { requestId, error: e?.message || 'Native embed failed' } });
    }
  };

  // Persist worker-computed related lists; notify UI and sync layer about
  // the ones that actually changed.
  const handleRelatedComputed = async (records: RelatedMemoriesRecord[]) => {
    try {
      const written = await persistComputedRelatedMemories(records);
      if (written.length > 0) {
        window.dispatchEvent(new CustomEvent(RELATED_MEMORIES_UPDATED_EVENT));
        window.dispatchEvent(new CustomEvent(RELATED_MEMORIES_NEED_SYNC_EVENT, { detail: { records: written } }));
      }
    } catch (e) {
      console.error('[Related] Failed to persist computed records', e);
    }
  };

  const createWorker = useCallback(() => {
    const worker = new Worker(new URL('../services/embedding.worker.ts', import.meta.url), {
      type: 'module'
    });

    // Handle Worker Errors (e.g. initialization failure, OOM)
    worker.onerror = (err) => {
        console.error("Worker Error:", err);
        setModelStatus('error');
        setLastError(err.message || "Unknown Worker Error");
    };

    worker.onmessage = (e) => {
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
      } else if (type === 'EMBED_REQUEST') {
        handleEmbedRequest(worker, payload.requestId, payload.texts);
      } else if (type === 'RELATED_COMPUTED') {
        handleRelatedComputed(payload.records);
      }
    };

    // Configure the worker for the platform model. The worker queue stays
    // gated until INIT_CONFIG arrives, so this async hop is safe.
    (async () => {
      const useNativeModel = await isNativeEmbedderReady();
      const model = useNativeModel ? NATIVE_EMBEDDING_MODEL : WEB_EMBEDDING_MODEL;
      setActiveModel(model);
      worker.postMessage({
        type: 'INIT_CONFIG',
        payload: { modelId: model.modelId, dim: model.dim, isNative: useNativeModel }
      });
      // Send initial online status to worker
      worker.postMessage({ type: 'SET_ONLINE_STATUS', payload: { isOnline: navigator.onLine } });
      // Check if model is cached (useful for offline status display)
      worker.postMessage({ type: 'CHECK_MODEL_CACHE' });
      // Check model status on init
      worker.postMessage({ type: 'CHECK_MODEL_STATUS' });
      // Start processing queue
      worker.postMessage({ type: 'START_PROCESSING' });
    })();

    return worker;
  }, []);

  // Initialize Worker
  useEffect(() => {
    if (!workerRef.current) {
      workerRef.current = createWorker();
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

  const checkModelCache = () => {
       workerRef.current?.postMessage({ type: 'CHECK_MODEL_CACHE' });
  };

  // Recompute all related-memories lists on the next idle queue cycle
  const recomputeRelated = () => {
       workerRef.current?.postMessage({ type: 'RECOMPUTE_RELATED' });
  };

  // Tear down and recreate the worker so it re-detects the platform model.
  // Used after the native EmbeddingGemma model is downloaded or deleted.
  const reinitializeWorker = useCallback(() => {
       workerRef.current?.terminate();
       setModelStatus('idle');
       setLastError(null);
       workerRef.current = createWorker();
  }, [createWorker]);

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
    checkModelCache,
    activeModel,
    recomputeRelated,
    reinitializeWorker
  };
};
