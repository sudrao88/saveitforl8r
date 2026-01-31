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
        // Switched to bge-base-en-v1.5 (~110MB) for superior accuracy
        embeddingPipeline = await pipeline('feature-extraction', 'Xenova/bge-base-en-v1.5', {
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
        embedding: 'vector[768]', // bge-base-en-v1.5 uses 768 dimensions
        originalId: 'string',
        chunkIndex: 'number'
      }
    });
    // Load existing vectors from Dexie into Orama on startup
    const vectors = await db.vectors.toArray();
    const invalidIds: string[] = [];
    
    for (const v of vectors) {
        if (v.vector.length === 768) {
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
        console.log(`[RAG] Removing ${invalidIds.length} incompatible vectors (wrong dimension).`);
        await db.vectors.bulkDelete(invalidIds);
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

    // Remove existing vectors for this note from Orama (in-memory) to prevent duplicates
    // Dexie overwrite handles persistence, but Orama throws on duplicate ID.
    // Since we chunk, IDs are noteId_0, noteId_1.
    // If we re-embed, we might have fewer or more chunks.
    // It's safer to try removing possible existing chunks first or just catching the error?
    // Orama remove requires ID.
    // Since we don't know exactly how many chunks existed before in Orama (it's in-memory),
    // and we just reloaded from Dexie... 
    // Actually, `queueMemoriesForEmbedding` in storageService clears Dexie vectors.
    // But `initOrama` loads from Dexie.
    // If `handleEmbedding` runs, it means we are processing a queue item.
    // If `storageService` cleared Dexie, then `initOrama` won't load them on NEXT init.
    // But if `initOrama` was ALREADY initialized, it still has the old vectors in memory!
    // We MUST remove them from Orama index too.
    
    // We can use `remove` by ID. But we need to know the IDs.
    // We can search by `originalId` if Orama supports where clause in remove (it usually requires ID).
    // Alternatively, we iterate and try remove `noteId_0`, `noteId_1`... until failure?
    // Or we simply catch the insert error and ignore (if it exists, maybe it's fine? No, content might have changed).
    // If content changed, we want to update.
    // Orama `insert` throws if ID exists. `update` or `upsert` might be available?
    // `insert` is strict.
    // I will use a loop to try removing potential old chunks `noteId_0` to `noteId_100` (safe upper bound or until error).
    
    for (let j = 0; j < 50; j++) { // Heuristic cleanup
        try {
            await remove(odb, `${item.noteId}_${j}`);
        } catch (e) {
            // Ignore if not found
        }
    }

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const output = await pipe(chunk, { pooling: 'mean', normalize: true });
        const embedding = Array.from(output.data) as number[];
        const vectorId = `${item.noteId}_${i}`;

        // Store in Dexie (Persistent)
        await db.vectors.put({
            id: vectorId,
            originalId: item.noteId,
            vector: embedding,
            extractedText: chunk,
            metadata: { originalId: item.noteId, chunkIndex: i }
        });

        // Insert into Orama (In-Memory Search)
        // Check if exists to be safe? (Race condition if we didn't remove above)
        // If we removed above, we should be fine.
        try {
            await insert(odb, {
                id: vectorId,
                text: chunk,
                embedding: embedding,
                originalId: item.noteId,
                chunkIndex: i
            });
        } catch (e: any) {
             // If duplicate, try removing and inserting again (Upsert logic)
             if (e.message?.includes('already exists')) {
                 await remove(odb, vectorId);
                 await insert(odb, {
                    id: vectorId,
                    text: chunk,
                    embedding: embedding,
                    originalId: item.noteId,
                    chunkIndex: i
                });
             } else {
                 throw e;
             }
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
            metadata: {
                originalId: hit.document.originalId,
                chunkIndex: hit.document.chunkIndex
            }
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
