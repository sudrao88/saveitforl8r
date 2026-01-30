import { pipeline, env } from '@xenova/transformers';
import { db, ProcessingQueueItem } from './db';
import { extractTextFromPDF, extractTextFromImage } from './fileProcessor';
import { create, insert, search, SearchResult } from '@orama/orama';

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
        // Switched to bge-small-en-v1.5 for better accuracy (~30-40MB)
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
        embedding: 'vector[384]', // bge-small-en-v1.5 also uses 384 dimensions
        metadata: 'json'
      }
    });
    // Load existing vectors from Dexie into Orama on startup
    const vectors = await db.vectors.toArray();
    for (const v of vectors) {
        await insert(oramaDb, {
            id: v.id,
            text: v.extractedText,
            embedding: v.vector,
            metadata: v.metadata
        });
    }
  }
  return oramaDb;
};

const broadcastStats = async () => {
    const pending = await db.processingQueue
        .where('status').anyOf('pending_extraction', 'pending_embedding')
        .count();
    
    const failed = await db.processingQueue
        .where('status').equals('failed')
        .count();
        
    // Count actual embedded notes (unique by originalId)
    // Dexie's uniqueKeys returns an array of primary keys or index keys. 
    // uniqueKeys() on an index returns unique values of that index.
    const uniqueIds = await db.vectors.orderBy('originalId').uniqueKeys();
    const completed = uniqueIds.length;

    self.postMessage({
        type: 'STATS_UPDATE',
        payload: { pending, failed, completed }
    });
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
        queueTimeout = setTimeout(processQueue, 5000); // Poll every 5s if empty
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

    // Process next immediately
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
    
    // Chunking if necessary
    const MAX_CHARS = 1000; 
    const chunks = text.match(new RegExp(`.{1,${MAX_CHARS}}`, 'g')) || [text];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const output = await pipe(chunk, { pooling: 'mean', normalize: true });
        const embedding = Array.from(output.data) as number[];

        // Store in Dexie (Persistent)
        await db.vectors.put({
            id: `${item.noteId}_${i}`,
            originalId: item.noteId,
            vector: embedding,
            extractedText: chunk,
            metadata: { originalId: item.noteId, chunkIndex: i }
        });

        // Insert into Orama (In-Memory Search)
        await insert(odb, {
            id: `${item.noteId}_${i}`,
            text: chunk,
            embedding: embedding,
            metadata: { originalId: item.noteId, chunkIndex: i }
        });
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
            mode: 'vector',
            vector: {
                value: queryEmbedding,
                property: 'embedding'
            },
            similarity: threshold, 
            limit: limit
        });

        const results = searchResult.hits.map((hit: any) => ({
            id: hit.id,
            text: hit.document.text,
            score: hit.score,
            metadata: hit.document.metadata
        }));

        self.postMessage({ type: 'SEARCH_RESULTS', payload: results, queryId: queryId });

    } catch (err) {
        console.error("Search error", err);
        self.postMessage({ type: 'SEARCH_ERROR', error: err, queryId: queryId });
    }
  } else if (type === 'CHECK_MODEL_STATUS') {
      if (embeddingPipeline) {
          self.postMessage({ type: 'MODEL_STATUS', payload: 'ready' });
      } else {
          // Trigger load
          getPipeline().catch(() => {});
      }
  } else if (type === 'RETRY_FAILED') {
      await db.processingQueue.where('status').equals('failed').modify((item: any) => {
          item.retryCount = 0;
          // Determine status based on type and content
          if (item.type !== 'text' && item.contentOrPath instanceof Blob) {
             item.status = 'pending_extraction';
          } else {
             item.status = 'pending_embedding';
          }
      });
      // Force wake up
      if (queueTimeout) clearTimeout(queueTimeout);
      isProcessing = false; // Reset flag to allow start
      processQueue();
  } else if (type === 'GET_STATS') {
      broadcastStats();
  }
};

processQueue();
