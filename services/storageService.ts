
import { Memory } from '../types.ts';
import { encryptData, decryptData, EncryptedPayload } from './encryptionService';
import { db } from './db';

const DB_NAME = 'SaveItForL8rDB';
const STORE_NAME = 'memories';
const DB_VERSION = 1;

// Internal type for what is actually stored in IndexedDB
interface StoredMemory {
  id: string;
  timestamp: number;
  encryptedData?: EncryptedPayload; // New encrypted blob
  
  // Legacy fields (kept for migration or unencrypted fallback)
  content?: string;
  image?: string;
  attachments?: any[];
  location?: any;
  enrichment?: any;
  tags?: string[];
  isPending?: boolean;
  isDeleting?: boolean;
  processingError?: boolean;
}

// Open (or create) the IndexedDB database
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// Helper: Convert StoredMemory to Application Memory
const rehydrateMemory = async (stored: StoredMemory): Promise<Memory> => {
  if (stored.encryptedData) {
    try {
      const decrypted = await decryptData(stored.encryptedData);
      const mem = {
        id: stored.id,
        timestamp: stored.timestamp,
        ...decrypted // Spread decrypted fields (content, tags, etc.)
      };
      
      // Check if embedded (async check might be too heavy here for list views, 
      // typically we load this flag separately or rely on UI to not show it in list)
      // For now, we won't block rehydration on DB check.
      return mem;
    } catch (e) {
      console.error(`Failed to decrypt memory ${stored.id}`, e);
      return {
        id: stored.id,
        timestamp: stored.timestamp,
        content: "Error: Could not decrypt memory.",
        tags: [],
        processingError: true
      };
    }
  }

  return stored as unknown as Memory;
};

// Helper to queue memories for embedding
const queueMemoriesForEmbedding = async (memories: Memory[]) => {
    const queueItems: any[] = [];
    
    for (const memory of memories) {
        // Double check enrichment constraint
        if (!memory.enrichment) continue;

        console.log(`[RAG] Queuing memory ${memory.id} for embedding...`);

        // Clear old vectors first (if any exist, to avoid duplicates on update)
        try {
            const vectorIds = await db.vectors.where('originalId').equals(memory.id).primaryKeys();
            if (vectorIds.length > 0) {
                 await db.vectors.bulkDelete(vectorIds);
            }
        } catch (e) {
            console.error(`[RAG] Error clearing vectors for ${memory.id}`, e);
        }

        // Text Content
        if (memory.content) {
            queueItems.push({
                noteId: memory.id,
                type: 'text',
                contentOrPath: memory.content,
                retryCount: 0,
                status: 'pending_embedding',
                timestamp: Date.now()
            });
        }

        // Attachments
        if (memory.attachments) {
            for (const att of memory.attachments) {
                if (att.data) {
                    let type: 'pdf' | 'image' | null = null;
                    if (att.mimeType === 'application/pdf') type = 'pdf';
                    else if (att.mimeType.startsWith('image/')) type = 'image';

                    if (type) {
                        try {
                            const res = await fetch(att.data);
                            const blob = await res.blob();
                            
                            queueItems.push({
                                noteId: memory.id,
                                type: type,
                                contentOrPath: blob,
                                retryCount: 0,
                                status: 'pending_extraction',
                                timestamp: Date.now()
                            });
                        } catch (err) {
                            console.error(`[RAG] Failed to process attachment for ${memory.id}`, err);
                        }
                    }
                }
            }
        }
    }

    if (queueItems.length > 0) {
        await db.processingQueue.bulkAdd(queueItems);
        console.log(`[RAG] Added ${queueItems.length} items to processing queue.`);
    }
};

export const getMemories = async (): Promise<Memory[]> => {
  try {
    const db = await openDB();
    const storedMemories = await new Promise<StoredMemory[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as StoredMemory[]);
      request.onerror = () => reject(request.error);
    });

    const memories = await Promise.all(storedMemories.map(rehydrateMemory));
    return memories.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error("Storage Error:", error);
    return [];
  }
};

export const getMemory = async (id: string): Promise<Memory | null> => {
  try {
    const dbInstance = await openDB();
    const stored = await new Promise<StoredMemory>((resolve, reject) => {
      const tx = dbInstance.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });

    if (!stored) return null;
    return await rehydrateMemory(stored);
  } catch (error) {
    return null;
  }
};

export const saveMemory = async (memory: Memory): Promise<void> => {
  // Separate metadata from sensitive data
  const { id, timestamp, ...sensitiveData } = memory;

  // RAG Integration: Queue ONLY if enriched
  if (sensitiveData.enrichment) {
      // We pass the full memory because queueMemoriesForEmbedding expects it
      // But we need to make sure we don't accidentally pass stale data. 
      // 'memory' arg is the latest state.
      // Fire and forget the queueing to not block UI save? 
      // Better to await to ensure data integrity or catch errors.
      // But we wrap in try/catch in helper.
      await queueMemoriesForEmbedding([memory]);
  }
  
  // Encrypt sensitive data
  const encryptedPayload = await encryptData(sensitiveData);

  const storedItem: StoredMemory = {
    id,
    timestamp,
    encryptedData: encryptedPayload
  };

  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(storedItem); 
    
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    request.onerror = () => reject(request.error);
  });
};

export const deleteMemory = async (id: string): Promise<void> => {
  try {
      const vectorIds = await db.vectors.where('originalId').equals(id).primaryKeys();
      await db.vectors.bulkDelete(vectorIds);
  } catch (e) {
      console.error("Failed to delete from RAG DB", e);
  }

  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const updateMemoryTags = async (id: string, newTags: string[]): Promise<void> => {
  const memory = await getMemory(id);
  if (!memory) return;

  memory.tags = newTags;
  await saveMemory(memory);
};

// New function for Reconciliation
export const reconcileEmbeddings = async () => {
  try {
    console.log("[RAG] Starting reconciliation...");
    const memories = await getMemories();
    // Filter for enriched memories only
    const enrichedMemories = memories.filter(m => m.enrichment && !m.processingError);

    if (enrichedMemories.length === 0) {
        console.log("[RAG] No enriched memories to reconcile.");
        return;
    }

    // Get all IDs that have vectors
    const embeddedIds = new Set(await db.vectors.orderBy('originalId').uniqueKeys());

    // Get all IDs currently in queue (pending OR failed)
    // If failed, we might want to retry automatically during reconciliation?
    // The requirement says: "attempt to do the embeddings if it had failed previously"
    // So if it is in queue but 'failed', we should probably re-queue it (or reset status).
    // But queueMemoriesForEmbedding adds NEW items. 
    // If we simply re-add, we might have duplicates in queue?
    // queueMemoriesForEmbedding doesn't check if already in queue.
    
    // Let's check which ones are NOT embedded AND NOT in pending queue.
    // If it is in 'failed' state in queue, we should probably pick it up too?
    // Let's get IDs of items that are 'pending_...'.
    const pendingIds = new Set(
        await db.processingQueue
            .where('status').anyOf('pending_extraction', 'pending_embedding')
            .toArray()
            .then(items => items.map(i => i.noteId))
    );

    const toQueue: Memory[] = [];

    for (const mem of enrichedMemories) {
        // If it's already embedded, skip.
        if (embeddedIds.has(mem.id)) continue;
        
        // If it's currently pending processing, skip.
        if (pendingIds.has(mem.id)) continue;

        // If we are here, it's either:
        // 1. Never queued.
        // 2. Queued but 'failed' (since we only checked pending statuses).
        // 3. Queued but 'completed' (but not in vectors?? Inconsistent state).
        
        // We add to queue.
        toQueue.push(mem);
    }
    
    if (toQueue.length > 0) {
        console.log(`[RAG] Reconciling: Found ${toQueue.length} notes needing embedding.`);
        // We should first clear any 'failed' or stale queue items for these notes to avoid duplicates?
        // queueMemoriesForEmbedding just appends.
        // Let's clean up queue for these IDs first.
        const idsToQueue = toQueue.map(m => m.id);
        await db.processingQueue.where('noteId').anyOf(idsToQueue).delete();
        
        await queueMemoriesForEmbedding(toQueue);
    } else {
        console.log("[RAG] Reconciliation complete. All notes embedded or pending.");
    }

  } catch (error) {
      console.error("[RAG] Reconciliation failed:", error);
  }
};
