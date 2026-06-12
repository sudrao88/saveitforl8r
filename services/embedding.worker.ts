import { pipeline, env } from '@xenova/transformers';
import { db, ProcessingQueueItem } from './db';
import { extractTextFromPDF, extractTextFromImage } from './fileProcessor';
import { create, insert, search, remove } from '@orama/orama';
import { dot, meanVector, topKRelated, K_STORE, MIN_SIMILARITY } from './relatedMemories';
import type { RelatedMemoriesRecord } from '../types';

// Declare self for TypeScript in Worker environment
declare const self: DedicatedWorkerGlobalScope;

// Skip local model checks if needed
env.allowLocalModels = false;
env.useBrowserCache = true;

// Track online/offline status (updated via messages from main thread)
let isOnline = true;

// Model name constant for cache checking
const MODEL_NAME = 'Xenova/bge-small-en-v1.5';

// --- Worker configuration (sent by main thread before any processing) ---
// On web the worker embeds with transformers.js itself; on native the main
// thread proxies embed calls to the TextEmbedder Capacitor plugin. Nothing may
// touch Orama or the pipeline until INIT_CONFIG arrives, or a wrong-dimension
// schema would race in.
interface WorkerConfig {
  modelId: string;
  dim: number;
  isNative: boolean;
}

let config: WorkerConfig | null = null;
let resolveConfig: (() => void) | null = null;
const configReady = new Promise<void>(resolve => { resolveConfig = resolve; });
const getConfig = async (): Promise<WorkerConfig> => {
  await configReady;
  return config!;
};

// Check if model files are already in the browser cache
// This allows us to know if we can work offline before attempting to load
const isModelCached = async (): Promise<boolean> => {
  try {
    // The transformers.js library caches models in the Cache API
    // under the 'transformers-cache' cache name
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();

    // Check if we have any files for our model in the cache
    // The model files are stored with URLs like:
    // https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/main/...
    const modelFiles = keys.filter(req =>
      req.url.includes(MODEL_NAME.replace('/', '/')) ||
      req.url.includes(encodeURIComponent(MODEL_NAME))
    );

    // We need at least the config and model files (onnx, tokenizer, etc.)
    // A fully cached model typically has 5+ files
    const isCached = modelFiles.length >= 3;
    console.log(`[RAG] Model cache check: ${modelFiles.length} files found, cached=${isCached}`);
    return isCached;
  } catch (e) {
    console.warn('[RAG] Cache check failed:', e);
    return false;
  }
};

// Singleton for the embedding pipeline
let embeddingPipeline: any = null;
const getPipeline = async (forceOffline?: boolean) => {
  if (!embeddingPipeline) {
    const useOfflineMode = forceOffline ?? !isOnline;

    // When offline, first check if model is cached
    if (useOfflineMode) {
      const cached = await isModelCached();
      if (!cached) {
        const error = new Error('Model not available offline. Please connect to the internet to download the search model first.');
        self.postMessage({ type: 'MODEL_STATUS', payload: 'error', error: error.message });
        throw error;
      }
      console.log('[RAG] Offline mode: loading model from cache');
    }

    // Notify start of download/loading
    self.postMessage({ type: 'MODEL_STATUS', payload: useOfflineMode ? 'loading' : 'downloading' });

    try {
        // Switched to bge-small-en-v1.5 (~33MB) for iOS stability
        // When offline, use local_files_only to prevent network requests
        embeddingPipeline = await pipeline('feature-extraction', MODEL_NAME, {
            progress_callback: (data: any) => {
                if (data.status === 'progress') {
                    self.postMessage({ type: 'MODEL_DOWNLOAD_PROGRESS', payload: data });
                }
            },
            // Critical: when offline, only use cached files - don't attempt network fetch
            local_files_only: useOfflineMode
        });
        self.postMessage({ type: 'MODEL_STATUS', payload: 'ready' });
    } catch (e: any) {
        // Provide better error message for offline failures
        const errorMessage = useOfflineMode
          ? 'Failed to load cached model. The model may not be fully downloaded.'
          : e.message;
        self.postMessage({ type: 'MODEL_STATUS', payload: 'error', error: errorMessage });
        throw e;
    }
  }
  return embeddingPipeline;
};

// --- Embedder abstraction: web (in-worker transformers.js) vs native proxy ---

interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

class WebEmbedder implements Embedder {
  async embed(texts: string[]): Promise<number[][]> {
    const pipe = await getPipeline();
    const vectors: number[][] = [];
    for (const text of texts) {
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      vectors.push(Array.from(output.data) as number[]);
    }
    return vectors;
  }
}

// Capacitor plugins are only callable from the main JS context, so native
// embedding is an RPC: the worker posts EMBED_REQUEST, the main thread calls
// the TextEmbedder plugin and replies EMBED_RESPONSE. A backgrounded WebView
// pauses the main thread, so timeouts requeue the item rather than fail it.
const EMBED_RPC_TIMEOUT_MS = 60_000;

class NativeProxyEmbedder implements Embedder {
  private pending = new Map<string, { resolve: (v: number[][]) => void; reject: (e: Error) => void; timer: any }>();
  private nextId = 0;

  embed(texts: string[]): Promise<number[][]> {
    const requestId = `embed_${++this.nextId}_${Date.now()}`;
    return new Promise<number[][]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Native embed request timed out'));
      }, EMBED_RPC_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      self.postMessage({ type: 'EMBED_REQUEST', payload: { requestId, texts } });
    });
  }

  handleResponse(requestId: string, vectors?: number[][], error?: string) {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    if (vectors) entry.resolve(vectors);
    else entry.reject(new Error(error || 'Native embed failed'));
  }
}

const nativeProxyEmbedder = new NativeProxyEmbedder();
let embedder: Embedder | null = null;
const getEmbedder = async (): Promise<Embedder> => {
  const cfg = await getConfig();
  if (!embedder) {
    embedder = cfg.isNative ? nativeProxyEmbedder : new WebEmbedder();
  }
  return embedder;
};

// Singleton for Orama index (in-memory)
let oramaDb: any = null;

const buildOramaSchema = (dim: number) => ({
    id: 'string' as const,
    text: 'string' as const,
    embedding: `vector[${dim}]` as const,
    originalId: 'string' as const,
    chunkIndex: 'number' as const
});

const initOrama = async () => {
  if (!oramaDb) {
    const cfg = await getConfig();
    oramaDb = await create({ schema: buildOramaSchema(cfg.dim) as any });
    // Load existing vectors from Dexie into Orama on startup
    const vectors = await db.vectors.toArray();
    const invalidIds: string[] = [];

    for (const v of vectors) {
        // Only vectors from the current model are usable; stale-model or
        // wrong-dimension vectors are dropped and their notes re-queued by
        // the next reconcileEmbeddings() pass on the main thread.
        if (v.modelId === cfg.modelId && v.vector.length === cfg.dim) {
             await insert(oramaDb, {
                id: v.id,
                text: v.extractedText,
                embedding: v.vector,
                originalId: v.metadata?.originalId || v.originalId || "",
                chunkIndex: v.metadata?.chunkIndex || 0
            });
        } else {
            invalidIds.push(v.id);
        }
    }

    // Auto-cleanup incompatible vectors
    if (invalidIds.length > 0) {
        console.log(`[RAG] Removing ${invalidIds.length} incompatible vectors.`);
        await db.vectors.bulkDelete(invalidIds);
        const staleMemoryVectors = await db.memoryVectors.where('modelId').notEqual(cfg.modelId).primaryKeys();
        if (staleMemoryVectors.length > 0) await db.memoryVectors.bulkDelete(staleMemoryVectors);
    }
  }
  return oramaDb;
};

// Rebuild the Orama index from Dexie (frees old index memory)
const rebuildOramaIndex = async () => {
    console.log('[RAG] Rebuilding Orama index from Dexie...');
    oramaDb = null;
    return await initOrama();
};

// Remove all Orama entries for a given noteId using the Dexie index
// instead of the fragile sequential `noteId_0`, `noteId_1`... loop
// that breaks on gaps and orphans chunks.
const removeNoteChunksFromOrama = async (odb: any, noteId: string) => {
    const chunkRecords = await db.vectors.where('originalId').equals(noteId).toArray();
    if (chunkRecords.length === 0) return;
    const ids = chunkRecords.map(r => r.id);
    for (const id of ids) {
        try { await remove(odb, id); } catch (_) { /* chunk may not be in index */ }
    }
};

// Purge completed queue items older than the threshold (default 1 hour)
const COMPLETED_RETENTION_MS = 60 * 60 * 1000;
const purgeCompletedQueueItems = async () => {
    try {
        const cutoff = Date.now() - COMPLETED_RETENTION_MS;
        const staleItems = await db.processingQueue
            .where('status').equals('completed')
            .filter(item => item.timestamp < cutoff)
            .toArray();
        if (staleItems.length > 0) {
            const ids = staleItems.map(i => i.id!).filter(Boolean);
            await db.processingQueue.bulkDelete(ids);
            console.log(`[RAG] Purged ${ids.length} completed queue items.`);
        }
    } catch (e) {
        console.error('[RAG] Purge completed items failed', e);
    }
};

const broadcastStats = async () => {
    try {
        const pending = await db.processingQueue
            .where('status').anyOf('pending_extraction', 'pending_embedding')
            .count();

        const failed = await db.processingQueue
            .where('status').equals('failed')
            .count();

        const uniqueIds = await db.vectors.orderBy('originalId').uniqueKeys();
        const completed = uniqueIds.length;

        self.postMessage({
            type: 'STATS_UPDATE',
            payload: { pending, failed, completed }
        });
    } catch (e) {
        console.error("[Worker] Stats broadcast failed", e);
    }
};

// --- Related Memories computation ---
// Notes whose embeddings changed since the last compute pass. When the queue
// drains, affected top-k lists are recomputed and posted to the main thread
// (which persists them with priority checks and skips unchanged lists).
const dirtyNoteIds = new Set<string>();
let relatedFullRecompute = false;
// Above this many dirty notes (backfill/reindex), incremental neighbor
// expansion would approach O(N²) — do one full recompute instead.
const FULL_RECOMPUTE_THRESHOLD = 25;

const computeRelatedMemories = async () => {
    const cfg = await getConfig();
    if (!relatedFullRecompute && dirtyNoteIds.size === 0) return;

    try {
        const memoryVectors = await db.memoryVectors.where('modelId').equals(cfg.modelId).toArray();
        if (memoryVectors.length === 0) {
            dirtyNoteIds.clear();
            relatedFullRecompute = false;
            return;
        }

        const byId = new Map(memoryVectors.map(v => [v.id, v]));
        const affected = new Set<string>();

        if (relatedFullRecompute || dirtyNoteIds.size > FULL_RECOMPUTE_THRESHOLD) {
            for (const v of memoryVectors) affected.add(v.id);
        } else {
            for (const dirtyId of dirtyNoteIds) {
                affected.add(dirtyId);
                const dirtyVec = byId.get(dirtyId);
                if (!dirtyVec) continue;
                // Any neighbor similar enough to enter a top-k list may change
                for (const other of memoryVectors) {
                    if (other.id === dirtyId) continue;
                    if (dot(dirtyVec.vector, other.vector) >= MIN_SIMILARITY) affected.add(other.id);
                }
            }
        }

        const now = Date.now();
        const records: RelatedMemoriesRecord[] = [];
        for (const id of affected) {
            const target = byId.get(id);
            if (!target) continue;
            records.push({
                memoryId: id,
                related: topKRelated(id, target.vector, memoryVectors, K_STORE, MIN_SIMILARITY),
                modelId: cfg.modelId,
                computedAt: now,
                updatedAt: now,
            });
        }

        dirtyNoteIds.clear();
        relatedFullRecompute = false;

        if (records.length > 0) {
            self.postMessage({ type: 'RELATED_COMPUTED', payload: { records } });
        }
    } catch (e) {
        console.error('[RAG] Related memories computation failed', e);
    }
};

let queueTimeout: any = null;
let isProcessing = false;
let processedSinceLastPurge = 0;

// Queue Processor
const processQueue = async () => {
  if (isProcessing) return;
  isProcessing = true;

  try {
    // Broadcast stats on every cycle
    await broadcastStats();

    // Periodically purge completed items to prevent unbounded IndexedDB growth
    if (processedSinceLastPurge >= 20) {
        await purgeCompletedQueueItems();
        processedSinceLastPurge = 0;
    }

    const pendingItems = await db.processingQueue
        .where('status')
        .anyOf('pending_extraction', 'pending_embedding')
        .sortBy('timestamp');

    if (pendingItems.length === 0) {
        // No work — purge any remaining completed items before going idle
        await purgeCompletedQueueItems();
        processedSinceLastPurge = 0;
        // Queue drained: refresh related-memories lists for changed notes
        await computeRelatedMemories();
        isProcessing = false;
        queueTimeout = setTimeout(processQueue, 5000);
        return;
    }

    const item = pendingItems[0];

    try {
        if (item.status === 'pending_extraction') {
            await handleExtraction(item);
        } else if (item.status === 'pending_embedding') {
            await handleEmbedding(item);
        }
        processedSinceLastPurge++;
    } catch (error: any) {
        console.error(`Error processing item ${item.noteId}:`, error);
        await db.processingQueue.update(item.id!, {
            retryCount: (item.retryCount || 0) + 1,
            error: error.message
        });

        if ((item.retryCount || 0) >= 3) {
            await db.processingQueue.update(item.id!, { status: 'failed' });
        }
    }

    isProcessing = false;
    queueTimeout = setTimeout(processQueue, 100);

  } catch (err) {
      console.error("Queue loop error", err);
      isProcessing = false;
      queueTimeout = setTimeout(processQueue, 5000);
  }
};

const handleExtraction = async (item: ProcessingQueueItem) => {
  let text = '';

  if (item.type === 'pdf' && item.contentOrPath instanceof Blob) {
    text = await extractTextFromPDF(item.contentOrPath);
  } else if (item.type === 'image' && item.contentOrPath instanceof Blob) {
    text = await extractTextFromImage(item.contentOrPath);
  } else if (typeof item.contentOrPath === 'string') {
    text = item.contentOrPath;
  }

  await db.processingQueue.update(item.id!, {
    status: 'pending_embedding',
    contentOrPath: text,
    type: 'text'
  });
};

const handleEmbedding = async (item: ProcessingQueueItem) => {
    const cfg = await getConfig();
    const emb = await getEmbedder();
    const odb = await initOrama();

    const text = item.contentOrPath as string;
    const chunks = text.match(new RegExp(`.{1,1000}`, 'g')) || [text];

    // Remove old chunks using the Dexie originalId index (reliable, no orphans)
    await removeNoteChunksFromOrama(odb, item.noteId);

    const embeddings = await emb.embed(chunks);

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings[i];
        const vectorId = `${item.noteId}_${i}`;

        await db.vectors.put({
            id: vectorId,
            originalId: item.noteId,
            vector: embedding,
            extractedText: chunk,
            metadata: { originalId: item.noteId, chunkIndex: i },
            modelId: cfg.modelId
        });

        try {
            await insert(odb, {
                id: vectorId,
                text: chunk,
                embedding: embedding,
                originalId: item.noteId,
                chunkIndex: i
            });
        } catch (e: any) {
             if (e.message?.includes('already exists')) {
                 await remove(odb, vectorId);
                 await insert(odb, { id: vectorId, text: chunk, embedding, originalId: item.noteId, chunkIndex: i });
             } else { throw e; }
        }
    }

    // Memory-level vector for Related Memories: normalized mean over ALL of
    // this note's chunks (text payload + extracted attachments), not just the
    // chunks of this queue item.
    const allChunks = await db.vectors.where('originalId').equals(item.noteId).toArray();
    const noteVectors = allChunks.filter(v => v.modelId === cfg.modelId).map(v => v.vector);
    if (noteVectors.length > 0) {
        await db.memoryVectors.put({
            id: item.noteId,
            vector: meanVector(noteVectors),
            modelId: cfg.modelId,
            updatedAt: Date.now()
        });
        dirtyNoteIds.add(item.noteId);
    }

    await db.processingQueue.update(item.id!, { status: 'completed' });
};

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  if (type === 'INIT_CONFIG') {
    if (!config) {
        config = { modelId: payload.modelId, dim: payload.dim, isNative: !!payload.isNative };
        console.log(`[RAG] Worker configured: ${config.modelId} (${config.dim}d, native=${config.isNative})`);
        // Native inference happens in the platform layer — the model is
        // already downloaded and loaded there, so report ready immediately.
        if (config.isNative) {
            self.postMessage({ type: 'MODEL_STATUS', payload: 'ready' });
        }
        resolveConfig?.();
    }
  } else if (type === 'EMBED_RESPONSE') {
    nativeProxyEmbedder.handleResponse(payload.requestId, payload.vectors, payload.error);
  } else if (type === 'START_PROCESSING') {
    await configReady;
    if (!isProcessing) processQueue();
  } else if (type === 'SEARCH') {
    const { query, limit = 10, threshold = 0.3, queryId } = payload;
    try {
        const emb = await getEmbedder();
        const [queryEmbedding] = await emb.embed([query]);
        const odb = await initOrama();

        const searchResult = await search(odb, {
            mode: 'hybrid',
            term: query,
            vector: { value: queryEmbedding, property: 'embedding' },
            similarity: threshold,
            limit: limit
        });

        const results = searchResult.hits.map((hit: any) => ({
            id: hit.id,
            text: hit.document.text,
            score: hit.score,
            metadata: { originalId: hit.document.originalId, chunkIndex: hit.document.chunkIndex }
        }));
        self.postMessage({ type: 'SEARCH_RESULTS', payload: results, queryId: queryId });
    } catch (err) {
        self.postMessage({ type: 'SEARCH_ERROR', error: err, queryId: queryId });
    }
  } else if (type === 'CHECK_MODEL_STATUS') {
      const cfg = config;
      if (cfg?.isNative || embeddingPipeline) self.postMessage({ type: 'MODEL_STATUS', payload: 'ready' });
      else if (cfg) getPipeline().catch(() => {});
      // Before INIT_CONFIG we don't know the platform — stay silent.
  } else if (type === 'RETRY_FAILED') {
      await db.processingQueue.where('status').equals('failed').modify((item: any) => {
          item.retryCount = 0;
          item.status = (item.type !== 'text' && item.contentOrPath instanceof Blob) ? 'pending_extraction' : 'pending_embedding';
      });
      if (queueTimeout) clearTimeout(queueTimeout);
      isProcessing = false;
      await configReady;
      processQueue();
  } else if (type === 'GET_STATS') {
      broadcastStats();
  } else if (type === 'DELETE_NOTE') {
      const { noteId } = payload;
      const odb = await initOrama();
      // Use Dexie index for reliable cleanup (no orphaned chunks)
      await removeNoteChunksFromOrama(odb, noteId);
      // Also clean up Dexie vectors and queue items for this note
      await db.vectors.where('originalId').equals(noteId).delete();
      await db.memoryVectors.delete(noteId);
      await db.processingQueue.where('noteId').equals(noteId).delete();
      // Other notes' lists may reference the deleted note — recompute all
      // (the main thread skips lists that didn't actually change).
      relatedFullRecompute = true;
      dirtyNoteIds.delete(noteId);
      broadcastStats();
  } else if (type === 'RECOMPUTE_RELATED') {
      relatedFullRecompute = true;
      // Picked up on the next idle queue cycle; trigger one now if idle
      if (!isProcessing && config) computeRelatedMemories().catch(() => {});
  } else if (type === 'REBUILD_INDEX') {
      // Destroy and rebuild the Orama index from Dexie data.
      // Use this to reclaim memory if the index grows too large.
      await rebuildOramaIndex();
      broadcastStats();
      self.postMessage({ type: 'INDEX_REBUILT' });
  } else if (type === 'CLOSE_DB') {
      db.close();
      self.postMessage({ type: 'DB_CLOSED' });
  } else if (type === 'SET_ONLINE_STATUS') {
      // Update online/offline status from the main thread
      const wasOnline = isOnline;
      isOnline = payload.isOnline;
      console.log(`[RAG] Online status updated: ${isOnline}`);

      // If we just came online and model isn't loaded, try to load it (web only)
      if (!wasOnline && isOnline && !embeddingPipeline && config && !config.isNative) {
          getPipeline().catch(() => {});
      }
  } else if (type === 'CHECK_MODEL_CACHE') {
      // Check if model is cached without attempting to load
      const cached = await isModelCached();
      self.postMessage({ type: 'MODEL_CACHE_STATUS', payload: { isCached: cached } });
  }
};

// Set initial online status based on navigator (worker has access to navigator)
isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

// Queue processing starts when the main thread sends INIT_CONFIG followed by
// START_PROCESSING — never unconditionally, to avoid racing the model config.
