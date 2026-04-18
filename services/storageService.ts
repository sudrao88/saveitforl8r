
import { Memory, Moment, MomentSynthesis, CalendarEvent, TodoItem } from '../types.ts';
import { encryptData, decryptData, decryptBatch, EncryptedPayload } from './encryptionService';
import { db } from './db';
import { storage } from './platform';

const DB_NAME = 'SaveItForL8rDB';
const STORE_NAME = 'memories';
const MOMENTS_STORE = 'moments';
const MOMENT_SYNTHESIS_STORE = 'momentSyntheses';
const CALENDAR_EVENTS_STORE = 'calendarEvents';
const TODO_ITEMS_STORE = 'todoItems';
const DB_VERSION = 5;

export interface ReconcileReport {
    total: number;
    enriched: number;
    toQueue: number;
    alreadyIndexed: number;
    pendingInQueue: number;
    error: string | null;
    timestamp: number;
}

// Singleton IndexedDB connection — avoids opening a new connection per operation.
// Under load (hundreds of memories, rapid saves during sync), this eliminates
// connection churn and prevents browser IDB connection pool exhaustion.
let cachedDB: IDBDatabase | null = null;
let dbOpenPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> => {
  if (cachedDB) return Promise.resolve(cachedDB);
  // Deduplicate concurrent open requests during startup
  if (dbOpenPromise) return dbOpenPromise;

  dbOpenPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const dbInstance = (event.target as IDBOpenDBRequest).result;
      if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
        dbInstance.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      // v3: Replace rhythms + momentMeta with single moments store
      if (dbInstance.objectStoreNames.contains('rhythms')) {
        dbInstance.deleteObjectStore('rhythms');
      }
      if (dbInstance.objectStoreNames.contains('momentMeta')) {
        dbInstance.deleteObjectStore('momentMeta');
      }
      if (!dbInstance.objectStoreNames.contains(MOMENTS_STORE)) {
        dbInstance.createObjectStore(MOMENTS_STORE, { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains(MOMENT_SYNTHESIS_STORE)) {
        dbInstance.createObjectStore(MOMENT_SYNTHESIS_STORE, { keyPath: 'momentId' });
      }
      // v4: Calendar events store with index on startDate for range queries
      if (!dbInstance.objectStoreNames.contains(CALENDAR_EVENTS_STORE)) {
        const eventStore = dbInstance.createObjectStore(CALENDAR_EVENTS_STORE, { keyPath: 'id' });
        eventStore.createIndex('startDate', 'startDate', { unique: false });
        eventStore.createIndex('memoryId', 'memoryId', { unique: false });
      }
      // v5: Todo items store for action items extracted from notes
      if (!dbInstance.objectStoreNames.contains(TODO_ITEMS_STORE)) {
        const todoStore = dbInstance.createObjectStore(TODO_ITEMS_STORE, { keyPath: 'id' });
        todoStore.createIndex('memoryId', 'memoryId', { unique: false });
      }
    };

    request.onsuccess = () => {
      cachedDB = request.result;
      cachedDB.onclose = () => { cachedDB = null; };
      cachedDB.onversionchange = () => { cachedDB?.close(); cachedDB = null; };
      dbOpenPromise = null;
      resolve(cachedDB);
    };
    request.onerror = () => {
      dbOpenPromise = null;
      reject(request.error);
    };
  });

  return dbOpenPromise;
};

// Helper: Ensure a Memory always has valid required fields after deserialization.
// Data from IndexedDB, Google Drive sync, or older app versions may have
// null/undefined tags (or other missing fields). This prevents runtime crashes
// like "null is not an object (evaluating 'c.tags.map')" on iOS standalone PWA.
const normalizeMemory = (memory: Memory): Memory => {
  if (!Array.isArray(memory.tags)) {
    memory.tags = [];
  }
  return memory;
};

// Helper: Convert StoredMemory to Application Memory
const rehydrateMemory = async (stored: StoredMemory): Promise<Memory> => {
  if (stored.encryptedData) {
    try {
      const decrypted = await decryptData(stored.encryptedData);
      return normalizeMemory({
        id: stored.id,
        timestamp: stored.timestamp,
        ...decrypted
      });
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
  return normalizeMemory(stored as unknown as Memory);
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

    // Batch decrypt all encrypted memories in the worker to avoid main-thread blocking
    const encrypted = storedMemories.filter(s => s.encryptedData);
    const unencrypted = storedMemories.filter(s => !s.encryptedData);

    let decryptedMap: Map<string, any> | undefined;
    if (encrypted.length > 0) {
      const payloads = encrypted.map(s => ({
        id: s.id,
        cipherText: s.encryptedData!.cipherText,
        iv: s.encryptedData!.iv,
      }));
      const results = await decryptBatch(payloads);
      decryptedMap = new Map(results.map(r => [r.id, r]));
    }

    const memories: Memory[] = [];
    for (const stored of storedMemories) {
      if (stored.encryptedData && decryptedMap) {
        const result = decryptedMap.get(stored.id);
        if (result?.data) {
          memories.push(normalizeMemory({ id: stored.id, timestamp: stored.timestamp, ...result.data }));
        } else {
          console.error(`Failed to decrypt memory ${stored.id}`, result?.error);
          memories.push({
            id: stored.id,
            timestamp: stored.timestamp,
            content: "Error: Could not decrypt memory.",
            tags: [],
            processingError: true,
          });
        }
      } else {
        memories.push(normalizeMemory(stored as unknown as Memory));
      }
    }

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

// --- Moments CRUD ---

export const getMoments = async (): Promise<Moment[]> => {
  try {
    const dbInstance = await openDB();
    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction(MOMENTS_STORE, 'readonly');
      const store = tx.objectStore(MOMENTS_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result as Moment[]).filter(m => !m.isDeleted));
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("Failed to get moments:", error);
    return [];
  }
};

export const getAllMomentsIncludingDeleted = async (): Promise<Moment[]> => {
  try {
    const dbInstance = await openDB();
    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction(MOMENTS_STORE, 'readonly');
      const store = tx.objectStore(MOMENTS_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as Moment[]);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("Failed to get all moments:", error);
    return [];
  }
};

export const saveMoment = async (moment: Moment): Promise<void> => {
  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(MOMENTS_STORE, 'readwrite');
    const store = tx.objectStore(MOMENTS_STORE);
    store.put(moment);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const deleteMomentHard = async (id: string): Promise<void> => {
  const dbInstance = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = dbInstance.transaction(MOMENTS_STORE, 'readwrite');
    const store = tx.objectStore(MOMENTS_STORE);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  // Also clean up the associated synthesis cache
  await deleteMomentSynthesis(id).catch(e => console.warn(`[Storage] Failed to delete synthesis for moment ${id}:`, e));
};

// --- MomentSynthesis Cache ---

export const getMomentSynthesis = async (momentId: string): Promise<MomentSynthesis | null> => {
  try {
    const dbInstance = await openDB();
    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction(MOMENT_SYNTHESIS_STORE, 'readonly');
      const store = tx.objectStore(MOMENT_SYNTHESIS_STORE);
      const request = store.get(momentId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("Failed to get moment synthesis:", error);
    return null;
  }
};

export const deleteMomentSynthesis = async (momentId: string): Promise<void> => {
  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(MOMENT_SYNTHESIS_STORE, 'readwrite');
    const store = tx.objectStore(MOMENT_SYNTHESIS_STORE);
    store.delete(momentId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const saveMomentSynthesis = async (synthesis: MomentSynthesis): Promise<void> => {
  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(MOMENT_SYNTHESIS_STORE, 'readwrite');
    const store = tx.objectStore(MOMENT_SYNTHESIS_STORE);
    store.put(synthesis);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

// --- CalendarEvent CRUD ---

export const getCalendarEvents = async (): Promise<CalendarEvent[]> => {
  try {
    const dbInstance = await openDB();
    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction(CALENDAR_EVENTS_STORE, 'readonly');
      const store = tx.objectStore(CALENDAR_EVENTS_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result as CalendarEvent[]).filter(e => !e.isDeleted));
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("Failed to get calendar events:", error);
    return [];
  }
};

export const getAllCalendarEventsIncludingDeleted = async (): Promise<CalendarEvent[]> => {
  try {
    const dbInstance = await openDB();
    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction(CALENDAR_EVENTS_STORE, 'readonly');
      const store = tx.objectStore(CALENDAR_EVENTS_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as CalendarEvent[]);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("Failed to get all calendar events:", error);
    return [];
  }
};

export const saveCalendarEvent = async (event: CalendarEvent): Promise<void> => {
  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(CALENDAR_EVENTS_STORE, 'readwrite');
    const store = tx.objectStore(CALENDAR_EVENTS_STORE);
    store.put(event);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const saveCalendarEvents = async (events: CalendarEvent[]): Promise<void> => {
  if (events.length === 0) return;
  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(CALENDAR_EVENTS_STORE, 'readwrite');
    const store = tx.objectStore(CALENDAR_EVENTS_STORE);
    for (const event of events) {
      store.put(event);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const getCalendarEventsByMemoryId = async (memoryId: string): Promise<CalendarEvent[]> => {
  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(CALENDAR_EVENTS_STORE, 'readonly');
    const store = tx.objectStore(CALENDAR_EVENTS_STORE);
    const index = store.index('memoryId');
    const request = index.getAll(IDBKeyRange.only(memoryId));
    request.onsuccess = () => resolve(request.result as CalendarEvent[]);
    request.onerror = () => reject(request.error);
  });
};

export const softDeleteCalendarEventsByMemoryId = async (memoryId: string): Promise<CalendarEvent[]> => {
  const events = await getCalendarEventsByMemoryId(memoryId);
  if (events.length === 0) return [];
  const now = Date.now();
  const tombstones = events.map(e => ({ ...e, isDeleted: true, updatedAt: now }));
  await saveCalendarEvents(tombstones);
  return tombstones;
};

/**
 * Atomically replace all calendar events for a memory: soft-delete existing
 * events and save new ones in a single IDB transaction. This prevents data
 * loss if the save step were to fail after a non-atomic soft-delete.
 *
 * Returns the tombstones of the old events (for sync).
 */
export const replaceCalendarEventsForMemory = async (
  memoryId: string,
  newEvents: CalendarEvent[],
): Promise<CalendarEvent[]> => {
  const dbInstance = await openDB();
  const now = Date.now();

  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(CALENDAR_EVENTS_STORE, 'readwrite');
    const store = tx.objectStore(CALENDAR_EVENTS_STORE);
    const index = store.index('memoryId');

    const tombstones: CalendarEvent[] = [];

    // Phase 1: read existing events for this memory and tombstone them
    const cursorReq = index.openCursor(IDBKeyRange.only(memoryId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const existing = cursor.value as CalendarEvent;
        const tombstone: CalendarEvent = { ...existing, isDeleted: true, updatedAt: now };
        tombstones.push(tombstone);
        cursor.update(tombstone);
        cursor.continue();
      } else {
        // Phase 2: cursor exhausted — write all new events in the same tx
        for (const event of newEvents) {
          store.put(event);
        }
      }
    };

    tx.oncomplete = () => resolve(tombstones);
    tx.onerror = () => reject(tx.error);
  });
};

export const deleteCalendarEventsByMemoryId = async (memoryId: string): Promise<void> => {
  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(CALENDAR_EVENTS_STORE, 'readwrite');
    const store = tx.objectStore(CALENDAR_EVENTS_STORE);
    const index = store.index('memoryId');
    const request = index.openCursor(IDBKeyRange.only(memoryId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const deleteCalendarEventHard = async (id: string): Promise<void> => {
  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(CALENDAR_EVENTS_STORE, 'readwrite');
    const store = tx.objectStore(CALENDAR_EVENTS_STORE);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

// --- TodoItem CRUD ---

export const getTodoItems = async (): Promise<TodoItem[]> => {
  try {
    const dbInstance = await openDB();
    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction(TODO_ITEMS_STORE, 'readonly');
      const store = tx.objectStore(TODO_ITEMS_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result as TodoItem[]).filter(item => !item.isDeleted));
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("Failed to get todo items:", error);
    return [];
  }
};

export const getAllTodoItemsIncludingDeleted = async (): Promise<TodoItem[]> => {
  try {
    const dbInstance = await openDB();
    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction(TODO_ITEMS_STORE, 'readonly');
      const store = tx.objectStore(TODO_ITEMS_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as TodoItem[]);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("Failed to get all todo items:", error);
    return [];
  }
};

export const saveTodoItems = async (items: TodoItem[]): Promise<void> => {
  if (items.length === 0) return;
  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(TODO_ITEMS_STORE, 'readwrite');
    const store = tx.objectStore(TODO_ITEMS_STORE);
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const updateTodoItem = async (item: TodoItem): Promise<void> => {
  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(TODO_ITEMS_STORE, 'readwrite');
    const store = tx.objectStore(TODO_ITEMS_STORE);
    store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const getTodoItemsByMemoryId = async (memoryId: string): Promise<TodoItem[]> => {
  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(TODO_ITEMS_STORE, 'readonly');
    const store = tx.objectStore(TODO_ITEMS_STORE);
    const index = store.index('memoryId');
    const request = index.getAll(IDBKeyRange.only(memoryId));
    request.onsuccess = () => resolve(request.result as TodoItem[]);
    request.onerror = () => reject(request.error);
  });
};

export const softDeleteTodoItemsByMemoryId = async (memoryId: string): Promise<TodoItem[]> => {
  const items = await getTodoItemsByMemoryId(memoryId);
  if (items.length === 0) return [];
  const now = Date.now();
  const tombstones = items.map(item => ({ ...item, isDeleted: true, updatedAt: now }));
  await saveTodoItems(tombstones);
  return tombstones;
};

export const replaceTodoItemsForMemory = async (
  memoryId: string,
  newItems: TodoItem[],
): Promise<{ tombstones: TodoItem[]; preserved: TodoItem[] }> => {
  const dbInstance = await openDB();
  const now = Date.now();

  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(TODO_ITEMS_STORE, 'readwrite');
    const store = tx.objectStore(TODO_ITEMS_STORE);
    const index = store.index('memoryId');

    const tombstones: TodoItem[] = [];
    const preserved: TodoItem[] = [];

    const cursorReq = index.openCursor(IDBKeyRange.only(memoryId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const existing = cursor.value as TodoItem;
        // Skip already-deleted items — don't resurrect them
        if (existing.isDeleted) {
          // no-op: leave tombstone as-is
        } else if (existing.isDismissed || existing.isCompleted) {
          // Preserve dismissed and completed items — don't tombstone them
          preserved.push(existing);
        } else {
          const tombstone: TodoItem = { ...existing, isDeleted: true, updatedAt: now };
          tombstones.push(tombstone);
          cursor.update(tombstone);
        }
        cursor.continue();
      } else {
        for (const item of newItems) {
          store.put(item);
        }
      }
    };

    tx.oncomplete = () => resolve({ tombstones, preserved });
    tx.onerror = () => reject(tx.error);
  });
};

export const deleteTodoItemsByMemoryId = async (memoryId: string): Promise<void> => {
  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(TODO_ITEMS_STORE, 'readwrite');
    const store = tx.objectStore(TODO_ITEMS_STORE);
    const index = store.index('memoryId');
    const request = index.openCursor(IDBKeyRange.only(memoryId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const deleteTodoItemHard = async (id: string): Promise<void> => {
  const dbInstance = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(TODO_ITEMS_STORE, 'readwrite');
    const store = tx.objectStore(TODO_ITEMS_STORE);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const factoryReset = async () => {
    try {
        console.log("Starting Factory Reset...");
        try { db.close(); } catch (e) { console.warn('[FactoryReset] RAG DB close failed (non-fatal):', e); }
        // Close the singleton IDB connection so deleteDatabase can proceed
        try { cachedDB?.close(); } catch (e) { console.warn('[FactoryReset] Main DB close failed (non-fatal):', e); } finally { cachedDB = null; dbOpenPromise = null; }

        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) { await registration.unregister(); }
        }

        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(key => caches.delete(key)));
        }

        localStorage.clear();

        // Clear ALL Capacitor Preferences (native) — localStorage.clear() only
        // covers web storage, not Capacitor Preferences used on native.
        // Using storage.clear() instead of selective key removal ensures no
        // stale state (e.g. pkce_verifier, sync snapshots) survives the reset,
        // which could corrupt subsequent auth flows on Android.
        try {
            await storage.clear();
        } catch (e) {
            console.warn('Failed to clear native preferences:', e);
        }

        const dbsToReset = [
            { name: 'SaveItForL8rDB', stores: ['memories', 'moments', 'momentSyntheses', 'calendarEvents', 'todoItems'] },
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
