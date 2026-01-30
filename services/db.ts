import Dexie, { Table } from 'dexie';

export interface VectorRecord {
  id: string; // matches noteId_chunkId
  originalId: string; // Added for querying by note
  vector: number[];
  extractedText: string;
  metadata: any;
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
  processingQueue!: Table<ProcessingQueueItem, number>;

  constructor() {
    super('SaveItForL8rRAG');
    this.version(1).stores({
      vectors: 'id, originalId', // Index originalId
      processingQueue: '++id, noteId, status, timestamp'
    });
  }
}

export const db = new AppDatabase();
