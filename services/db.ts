import Dexie, { Table } from 'dexie';

export interface VectorRecord {
  id: string; // matches noteId_chunkId
  originalId: string; // Added for querying by note
  vector: number[];
  extractedText: string;
  metadata: any;
  modelId: string; // Embedding model that produced this vector
}

// One vector per note: L2-normalized mean of its chunk vectors.
// Used for memory-to-memory similarity (Related Memories).
export interface MemoryVectorRecord {
  id: string; // noteId
  vector: number[];
  modelId: string;
  updatedAt: number;
}

export interface ProcessingQueueItem {
  id?: number; // Auto-incremented
  noteId: string;
  type: 'text' | 'image' | 'pdf';
  contentOrPath: string | Blob; // content for text, blob for file
  retryCount: number;
  status: 'pending_extraction' | 'pending_embedding' | 'failed' | 'completed';
  error?: string;
  timestamp: number;
}

export class AppDatabase extends Dexie {
  vectors!: Table<VectorRecord, string>;
  memoryVectors!: Table<MemoryVectorRecord, string>;
  processingQueue!: Table<ProcessingQueueItem, number>;

  constructor() {
    super('SaveItForL8rRAG');
    // Bump version to 2 to ensure originalId index is created on existing clients
    this.version(2).stores({
      vectors: 'id, originalId',
      processingQueue: '++id, noteId, status, timestamp'
    });
    // v3: modelId on vectors (versioning across web/native models) + per-note
    // memoryVectors store for Related Memories similarity
    this.version(3).stores({
      vectors: 'id, originalId, modelId',
      memoryVectors: 'id, modelId',
      processingQueue: '++id, noteId, status, timestamp'
    }).upgrade(tx => {
      // Pre-v3 vectors were all produced by the web model
      return tx.table('vectors').toCollection().modify((v: any) => {
        if (!v.modelId) v.modelId = 'bge-small-en-v1.5';
      });
    });
  }
}

export const db = new AppDatabase();
