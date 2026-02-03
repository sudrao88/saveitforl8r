
import { Memory } from '../types.ts';
import { encryptData, decryptData, EncryptedPayload } from './encryptionService';
import { db } from './db';

const DB_NAME = 'SaveItForL8rDB';
const STORE_NAME = 'memories';
const DB_VERSION = 1;

export interface ReconcileReport {
    total: number;
    enriched: number;
    toQueue: number;
    alreadyIndexed: number;
    pendingInQueue: number;
    error: string | null;
    timestamp: number;
}

// Open (or create) the IndexedDB database
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (event) => {
      const dbInstance = (event.target as IDBOpenDBRequest).result;
      if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
        dbInstance.createObjectStore(STORE_NAME, { keyPath: 'id' });
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
      return {
        id: stored.id,
        timestamp: stored.timestamp,
        ...decrypted
      };
    } catch (e: any) {
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

// Resilient helper to queue memories
const queueMemoriesForEmbedding = async (memories: Memory[]) => {
    if (memories.length === 0) return;
    
    const queueItems: any[] = [];
    
    for (const memory of memories) {
        if (!memory.enrichment) continue;

        // Clear existing state for this note
        try {
            await db.vectors.where('originalId').equals(memory.id).delete();
            await db.processingQueue.where('noteId').equals(memory.id).delete();
        } catch (e) { console.error(`[RAG] Reset error for ${memory.id}`, e); }

        // Construct Rich Text Payload
        let textPayload = "";
        if (memory.content) textPayload += `CONTENT: ${memory.content}\n`;
        if (memory.enrichment) {
            if (memory.enrichment.summary) textPayload += `SUMMARY: ${memory.enrichment.summary}\n`;
            if (memory.enrichment.visualDescription) textPayload += `VISUAL: ${memory.enrichment.visualDescription}\n`;
            if (memory.enrichment.suggestedTags?.length) textPayload += `TAGS: ${memory.enrichment.suggestedTags.join(', ')}\n`;
            if (memory.enrichment.locationContext?.name) textPayload += `LOCATION: ${memory.enrichment.locationContext.name}\n`;
            if (memory.enrichment.entityContext) {
                if (memory.enrichment.entityContext.type) textPayload += `TYPE: ${memory.enrichment.entityContext.type}\n`;
                if (memory.enrichment.entityContext.title) textPayload += `ENTITY: ${memory.enrichment.entityContext.title}\n`;
                if (memory.enrichment.entityContext.subtitle) textPayload += `SUBTITLE: ${memory.enrichment.entityContext.subtitle}\n`;
                if (memory.enrichment.entityContext.description) textPayload += `DESCRIPTION: ${memory.enrichment.entityContext.description}\n`;
            }
        }
        if (memory.tags?.length) textPayload += `USER TAGS: ${memory.tags.join(', ')}\n`;

        if (textPayload.trim().length > 0) {
            queueItems.push({
                noteId: memory.id,
                type: 'text',
                contentOrPath: textPayload.trim(),
                retryCount: 0,
                status: 'pending_embedding',
                timestamp: Date.now()
            });
        }

        // Attachments - Process lazily or with safety
        if (memory.attachments) {
            for (const att of memory.attachments) {
                if (att.data && (att.mimeType === 'application/pdf' || att.mimeType.startsWith('image/'))) {
                    // We add a 'pending_extraction' task. 
                    // To avoid fetch errors blocking the loop, we assume the worker handles the blob if we can get it.
                    // If we can't get the blob now, we skip this attachment but keep the note context task.
                    try {
                        // Data URI to Blob
                        const res = await fetch(att.data);
                        const blob = await res.blob();
                        queueItems.push({
                            noteId: memory.id,
                            type: att.mimeType === 'application/pdf' ? 'pdf' : 'image',
                            contentOrPath: blob,
                            retryCount: 0,
                            status: 'pending_extraction',
                            timestamp: Date.now()
                        });
                    } catch (err) {
                        console.error(`[RAG] Skip attachment for ${memory.id}`, err);
                    }
                }
            }
        }
    }

    if (queueItems.length > 0) {
        await db.processingQueue.bulkPut(queueItems);
    }
};

export const getMemories = async (): Promise<Memory[]> => {
  try {
    const dbInstance = await openDB();
    const storedMemories = await new Promise<StoredMemory[]>((resolve, reject) => {
      const tx = dbInstance.transaction(STORE_NAME, 'readonly');
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
  } catch (error) { return null; }
};

export const saveMemory = async (memory: Memory): Promise<void> => {
  const { id, timestamp, ...sensitiveData } = memory;
  if (sensitiveData.enrichment) {
      queueMemoriesForEmbedding([memory]).catch(e => console.error("RAG queue error", e));
  }
  const encryptedPayload = await encryptData(sensitiveData);
  const storedItem: StoredMemory = { id, timestamp, encryptedData: encryptedPayload };
  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(storedItem); 
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const deleteMemory = async (id: string): Promise<void> => {
  try {
      await db.vectors.where('originalId').equals(id).delete();
      await db.processingQueue.where('noteId').equals(id).delete();
  } catch (e) { console.error("Failed to delete from RAG DB", e); }

  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
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

export const reconcileEmbeddings = async (): Promise<ReconcileReport> => {
  const report: ReconcileReport = { total: 0, enriched: 0, toQueue: 0, alreadyIndexed: 0, pendingInQueue: 0, error: null, timestamp: Date.now() };
  try {
    // 1. Ensure DB is open and indices are ready
    await db.open();
    
    const memories = await getMemories();
    report.total = memories.length;
    
    const enrichedMemories = memories.filter(m => m.enrichment && !m.isDeleted && !m.processingError);
    report.enriched = enrichedMemories.length;

    if (enrichedMemories.length === 0) return report;

    // Use keys to minimize memory footprint on check
    const vectorKeys = await db.vectors.toArray();
    const embeddedIds = new Set(vectorKeys.map(v => v.originalId));
    report.alreadyIndexed = embeddedIds.size;

    const queueItems = await db.processingQueue.toArray();
    const activeQueueIds = new Set(queueItems.filter(q => q.status !== 'completed' && q.status !== 'failed').map(q => q.noteId));

    // Use uniqueKeys() to get only the distinct originalIds without loading
    // full vector records (which include large number[] arrays) into memory
    const embeddedIdKeys = await db.vectors.orderBy('originalId').uniqueKeys();
    const embeddedIds2 = new Set(embeddedIdKeys as string[]);
    report.alreadyIndexed = embeddedIds2.size;

    // Only load active queue items (pending states), not completed/failed
    const activeQueueItems = await db.processingQueue
        .where('status').anyOf('pending_extraction', 'pending_embedding')
        .toArray();
    const activeQueueIds2 = new Set(activeQueueItems.map(q => q.noteId));

    report.pendingInQueue = activeQueueIds2.size;

    const toQueue = enrichedMemories.filter(m => !embeddedIds2.has(m.id) && !activeQueueIds2.has(m.id));
    report.toQueue = toQueue.length;
    
    if (toQueue.length > 0) {
        await queueMemoriesForEmbedding(toQueue);
    }
    return report;
  } catch (error: any) {
      console.error("[RAG] Reconciliation failed:", error);
      report.error = error.message || String(error);
      return report;
  }
};

export const forceReindexAll = async (): Promise<ReconcileReport> => {
    try {
        console.log("[RAG] Force Reindexing All...");
        await db.vectors.clear();
        await db.processingQueue.clear();
        return await reconcileEmbeddings();
    } catch (e: any) {
        return { total: 0, enriched: 0, toQueue: 0, alreadyIndexed: 0, pendingInQueue: 0, error: e.message, timestamp: Date.now() };
    }
};

export const factoryReset = async () => {
    try {
        console.log("Starting Factory Reset...");
        try { db.close(); } catch (e) {}

        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) { await registration.unregister(); }
        }

        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(key => caches.delete(key)));
        }

        localStorage.clear();

        const dbsToReset = [
            { name: 'SaveItForL8rDB', stores: ['memories'] },
            { name: 'SaveItForL8rRAG', stores: ['vectors', 'processingQueue'] },
            { name: 'auth_db', stores: ['tokens'] },
            { name: 'saveitforl8r-share', stores: ['shares'] }
        ];

        for (const dbConfig of dbsToReset) {
            const dbName = dbConfig.name;
            try {
                const reqOpen = indexedDB.open(dbName);
                await new Promise((resolve) => {
                    reqOpen.onsuccess = (e) => {
                        const dbConn = (e.target as IDBOpenDBRequest).result;
                        const existingStores = Array.from(dbConn.objectStoreNames);
                        if (existingStores.length > 0) {
                            try {
                                const tx = dbConn.transaction(existingStores, 'readwrite');
                                existingStores.forEach(store => {
                                    if (dbConfig.stores.includes(store)) tx.objectStore(store).clear();
                                });
                                tx.oncomplete = () => { dbConn.close(); resolve(null); };
                            } catch (err) { dbConn.close(); resolve(null); }
                        } else { dbConn.close(); resolve(null); }
                    };
                    reqOpen.onerror = () => resolve(null);
                });
                indexedDB.deleteDatabase(dbName);
            } catch (e) { console.error(`Failed to reset DB ${dbName}`, e); }
        }

        window.location.href = window.location.origin + '/?reset=' + Date.now();
    } catch (error) {
        console.error("Factory Reset Failed:", error);
        alert("Reset failed. Please clear browser data manually.");
    }
};

interface StoredMemory {
  id: string;
  timestamp: number;
  encryptedData?: EncryptedPayload;
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
