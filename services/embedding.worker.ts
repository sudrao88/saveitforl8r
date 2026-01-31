import { pipeline, env } from '@xenova/transformers';
import { db, ProcessingQueueItem } from './db';
import { extractTextFromPDF, extractTextFromImage } from './fileProcessor';
import { create, insert, search, remove, SearchResult } from '@orama/orama';

// Declare self for TypeScript in Worker environment
declare const self: DedicatedWorkerGlobalScope;

// Skip local model checks if needed
env.allowLocalModels = false;
env.useBrowserCache = true;

// Singleton for the embedding pipeline
let embeddingPipeline: any = null;
const getPipeline = async () => {
  if (!embeddingPipeline) {
    // Notify start of download
    self.postMessage({ type: 'MODEL_STATUS', payload: 'downloading' });
    try {
        // Switched to bge-small-en-v1.5 (~33MB) for iOS stability
        embeddingPipeline = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', {
            progress_callback: (data: any) => {
                if (data.status === 'progress') {
                    self.postMessage({ type: 'MODEL_DOWNLOAD_PROGRESS', payload: data });
                }
            }
        });
        self.postMessage({ type: 'MODEL_STATUS', payload: 'ready' });
    } catch (e) {
        self.postMessage({ type: 'MODEL_STATUS', payload: 'error', error: e });
        throw e;
    }
  }
  return embeddingPipeline;
};

// Singleton for Orama index (in-memory)
let oramaDb: any = null;

const initOrama = async () => {
  if (!oramaDb) {
    oramaDb = await create({
      schema: {
        id: 'string',
        text: 'string',
        embedding: 'vector[384]', // bge-small uses 384 dimensions
        originalId: 'string',
        chunkIndex: 'number'
      }
    });
    // Load existing vectors from Dexie into Orama on startup
    const vectors = await db.vectors.toArray();
    const invalidIds: string[] = [];
    
    for (const v of vectors) {
        if (v.vector.length === 384) {
             await insert(oramaDb, {
                id: v.id,
                text: v.extractedText,
                embedding: v.vector,
                originalId: v.metadata?.originalId || v.originalId || "", 
                chunkIndex: v.metadata?.chunkIndex || 0
            });
        } else {
            // Detected old/incompatible vector dimension
            invalidIds.push(v.id);
        }
    }
    
    // Auto-cleanup incompatible vectors
    if (invalidIds.length > 0) {
        console.log(`[RAG] Removing ${invalidIds.length} incompatible vectors.`);
        await db.vectors.bulkDelete(invalidIds);
    }
  }
  return oramaDb;
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

let queueTimeout: any = null;
let isProcessing = false;

// Queue Processor
const processQueue = async () => {
  if (isProcessing) return;
  isProcessing = true;

  try {
    // Broadcast stats on every cycle
    await broadcastStats();

    const pendingItems = await db.processingQueue
        .where('status')
        .anyOf('pending_extraction', 'pending_embedding')
        .sortBy('timestamp');

    if (pendingItems.length === 0) {
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
    const pipe = await getPipeline();
    const odb = await initOrama();
    
    const text = item.contentOrPath as string;
    const chunks = text.match(new RegExp(`.{1,1000}`, 'g')) || [text];

    // Optimized cleanup: stop at first missing chunk
    let j = 0;
    while (j < 50) {
        try {
            await remove(odb, `${item.noteId}_${j}`);
            j++;
        } catch (e) { break; }
    }

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const output = await pipe(chunk, { pooling: 'mean', normalize: true });
        const embedding = Array.from(output.data) as number[];
        const vectorId = `${item.noteId}_${i}`;

        await db.vectors.put({
            id: vectorId,
            originalId: item.noteId,
            vector: embedding,
            extractedText: chunk,
            metadata: { originalId: item.noteId, chunkIndex: i }
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

    await db.processingQueue.update(item.id!, { status: 'completed' });
};

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  if (type === 'START_PROCESSING') {
    if (!isProcessing) processQueue();
  } else if (type === 'SEARCH') {
    const { query, limit = 10, threshold = 0.3, queryId } = payload;
    try {
        const pipe = await getPipeline();
        const output = await pipe(query, { pooling: 'mean', normalize: true });
        const queryEmbedding = Array.from(output.data) as number[];
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
      if (embeddingPipeline) self.postMessage({ type: 'MODEL_STATUS', payload: 'ready' });
      else getPipeline().catch(() => {});
  } else if (type === 'RETRY_FAILED') {
      await db.processingQueue.where('status').equals('failed').modify((item: any) => {
          item.retryCount = 0;
          item.status = (item.type !== 'text' && item.contentOrPath instanceof Blob) ? 'pending_extraction' : 'pending_embedding';
      });
      if (queueTimeout) clearTimeout(queueTimeout);
      isProcessing = false;
      processQueue();
  } else if (type === 'GET_STATS') {
      broadcastStats();
  } else if (type === 'DELETE_NOTE') {
      const { noteId } = payload;
      const odb = await initOrama();
      let j = 0;
      while (j < 50) {
          try { await remove(odb, `${noteId}_${j}`); j++; } catch (e) { break; }
      }
      broadcastStats();
  } else if (type === 'CLOSE_DB') {
      db.close();
      self.postMessage({ type: 'DB_CLOSED' });
  }
};

processQueue();
