
import { Memory } from '../types.ts';
import { encryptData, decryptData, EncryptedPayload } from './encryptionService';

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
      return {
        id: stored.id,
        timestamp: stored.timestamp,
        ...decrypted // Spread decrypted fields (content, tags, etc.)
      };
    } catch (e) {
      console.error(`Failed to decrypt memory ${stored.id}`, e);
      // Fallback: return as error state or try legacy fields if partial
      return {
        id: stored.id,
        timestamp: stored.timestamp,
        content: "Error: Could not decrypt memory.",
        tags: [],
        processingError: true
      };
    }
  }

  // Legacy: Not encrypted yet, return as is (casting strictly)
  return stored as unknown as Memory;
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

    // Decrypt all in parallel
    const memories = await Promise.all(storedMemories.map(rehydrateMemory));

    // Sort by timestamp descending (newest first)
    return memories.sort((a, b) => b.timestamp - a.timestamp);

  } catch (error) {
    console.error("Storage Error:", error);
    return [];
  }
};

export const getMemory = async (id: string): Promise<Memory | null> => {
  try {
    const db = await openDB();
    const stored = await new Promise<StoredMemory>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
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
  
  // Encrypt sensitive data
  const encryptedPayload = await encryptData(sensitiveData);

  const storedItem: StoredMemory = {
    id,
    timestamp,
    encryptedData: encryptedPayload
    // We intentionally do NOT save the other fields in plaintext anymore
  };

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(storedItem); 
    
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    request.onerror = () => reject(request.error);
  });
};

export const deleteMemory = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const updateMemoryTags = async (id: string, newTags: string[]): Promise<void> => {
  // To update tags, we must read -> decrypt -> update -> encrypt -> save
  // because the tags are now inside the encrypted blob.
  const memory = await getMemory(id);
  if (!memory) return;

  memory.tags = newTags;
  await saveMemory(memory);
};
