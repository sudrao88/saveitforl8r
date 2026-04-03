import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { AppDatabase, VectorRecord, ProcessingQueueItem } from './db';

describe('AppDatabase - Offline Vector DB Reading', () => {
  let testDb: AppDatabase;

  beforeEach(() => {
    // Create a fresh database instance for each test
    testDb = new AppDatabase();
  });

  afterEach(async () => {
    testDb.close();
    await Dexie.delete('SaveItForL8rRAG');
  });

  describe('VectorRecord storage and retrieval', () => {
    const makeVector = (id: string, originalId: string, text: string, chunkIndex = 0): VectorRecord => ({
      id,
      originalId,
      vector: new Array(384).fill(Math.random()),
      extractedText: text,
      metadata: { originalId, chunkIndex },
    });

    it('should store and retrieve a vector record by id', async () => {
      const record = makeVector('note1_0', 'note1', 'Hello world');
      await testDb.vectors.put(record);

      const retrieved = await testDb.vectors.get('note1_0');
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('note1_0');
      expect(retrieved!.originalId).toBe('note1');
      expect(retrieved!.extractedText).toBe('Hello world');
      expect(retrieved!.vector).toHaveLength(384);
    });

    it('should return undefined for non-existent id', async () => {
      const result = await testDb.vectors.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should retrieve all vector records', async () => {
      await testDb.vectors.bulkPut([
        makeVector('n1_0', 'n1', 'chunk 1'),
        makeVector('n1_1', 'n1', 'chunk 2', 1),
        makeVector('n2_0', 'n2', 'other note'),
      ]);

      const all = await testDb.vectors.toArray();
      expect(all).toHaveLength(3);
    });

    it('should query vectors by originalId index', async () => {
      await testDb.vectors.bulkPut([
        makeVector('n1_0', 'note1', 'first chunk'),
        makeVector('n1_1', 'note1', 'second chunk', 1),
        makeVector('n2_0', 'note2', 'different note'),
      ]);

      const note1Chunks = await testDb.vectors.where('originalId').equals('note1').toArray();
      expect(note1Chunks).toHaveLength(2);
      expect(note1Chunks.every(r => r.originalId === 'note1')).toBe(true);
    });

    it('should return empty array when querying non-existent originalId', async () => {
      await testDb.vectors.put(makeVector('n1_0', 'note1', 'text'));

      const results = await testDb.vectors.where('originalId').equals('nonexistent').toArray();
      expect(results).toHaveLength(0);
    });

    it('should overwrite existing vector on put with same id', async () => {
      const original = makeVector('n1_0', 'note1', 'original text');
      await testDb.vectors.put(original);

      const updated = { ...original, extractedText: 'updated text', vector: new Array(384).fill(0.99) };
      await testDb.vectors.put(updated);

      const result = await testDb.vectors.get('n1_0');
      expect(result!.extractedText).toBe('updated text');

      // Should not duplicate
      const all = await testDb.vectors.toArray();
      expect(all).toHaveLength(1);
    });

    it('should delete vectors by originalId', async () => {
      await testDb.vectors.bulkPut([
        makeVector('n1_0', 'note1', 'chunk 0'),
        makeVector('n1_1', 'note1', 'chunk 1', 1),
        makeVector('n2_0', 'note2', 'keep this'),
      ]);

      const deletedCount = await testDb.vectors.where('originalId').equals('note1').delete();
      expect(deletedCount).toBe(2);

      const remaining = await testDb.vectors.toArray();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].originalId).toBe('note2');
    });

    it('should bulk delete vectors by id list', async () => {
      await testDb.vectors.bulkPut([
        makeVector('n1_0', 'note1', 'a'),
        makeVector('n1_1', 'note1', 'b', 1),
        makeVector('n2_0', 'note2', 'c'),
      ]);

      await testDb.vectors.bulkDelete(['n1_0', 'n1_1']);

      const remaining = await testDb.vectors.toArray();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('n2_0');
    });

    it('should get unique originalIds via orderBy', async () => {
      await testDb.vectors.bulkPut([
        makeVector('n1_0', 'note1', 'a'),
        makeVector('n1_1', 'note1', 'b', 1),
        makeVector('n2_0', 'note2', 'c'),
        makeVector('n3_0', 'note3', 'd'),
      ]);

      const uniqueIds = await testDb.vectors.orderBy('originalId').uniqueKeys();
      expect(uniqueIds).toHaveLength(3);
      expect(uniqueIds).toContain('note1');
      expect(uniqueIds).toContain('note2');
      expect(uniqueIds).toContain('note3');
    });

    it('should store and retrieve 384-dimensional embedding vectors', async () => {
      const embedding = Array.from({ length: 384 }, (_, i) => i / 384);
      const record: VectorRecord = {
        id: 'test_0',
        originalId: 'test',
        vector: embedding,
        extractedText: 'test',
        metadata: {},
      };

      await testDb.vectors.put(record);
      const retrieved = await testDb.vectors.get('test_0');

      expect(retrieved!.vector).toHaveLength(384);
      expect(retrieved!.vector[0]).toBeCloseTo(0);
      expect(retrieved!.vector[383]).toBeCloseTo(383 / 384);
    });

    it('should handle chunked text storage for long documents', async () => {
      const longText = 'x'.repeat(3000);
      const chunks = longText.match(/.{1,1000}/g)!;

      for (let i = 0; i < chunks.length; i++) {
        await testDb.vectors.put(makeVector(`doc_${i}`, 'doc', chunks[i], i));
      }

      const allChunks = await testDb.vectors.where('originalId').equals('doc').toArray();
      expect(allChunks).toHaveLength(3);

      // Verify chunk ordering via metadata
      const sorted = allChunks.sort((a, b) => a.metadata.chunkIndex - b.metadata.chunkIndex);
      expect(sorted[0].metadata.chunkIndex).toBe(0);
      expect(sorted[1].metadata.chunkIndex).toBe(1);
      expect(sorted[2].metadata.chunkIndex).toBe(2);
    });
  });

  describe('ProcessingQueue operations', () => {
    const makeQueueItem = (noteId: string, status: ProcessingQueueItem['status'], overrides: Partial<ProcessingQueueItem> = {}): Omit<ProcessingQueueItem, 'id'> => ({
      noteId,
      type: 'text',
      contentOrPath: `content for ${noteId}`,
      retryCount: 0,
      status,
      timestamp: Date.now(),
      ...overrides,
    });

    it('should auto-increment id on insert', async () => {
      const id1 = await testDb.processingQueue.put(makeQueueItem('n1', 'pending_embedding') as ProcessingQueueItem);
      const id2 = await testDb.processingQueue.put(makeQueueItem('n2', 'pending_extraction') as ProcessingQueueItem);

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id2).toBeGreaterThan(id1);
    });

    it('should query items by status', async () => {
      await testDb.processingQueue.bulkPut([
        makeQueueItem('n1', 'pending_embedding'),
        makeQueueItem('n2', 'pending_extraction'),
        makeQueueItem('n3', 'completed'),
        makeQueueItem('n4', 'failed'),
      ] as ProcessingQueueItem[]);

      const pending = await testDb.processingQueue
        .where('status')
        .anyOf('pending_extraction', 'pending_embedding')
        .toArray();
      expect(pending).toHaveLength(2);

      const failed = await testDb.processingQueue
        .where('status')
        .equals('failed')
        .toArray();
      expect(failed).toHaveLength(1);
      expect(failed[0].noteId).toBe('n4');
    });

    it('should query and sort pending items by timestamp', async () => {
      await testDb.processingQueue.bulkPut([
        makeQueueItem('n2', 'pending_embedding', { timestamp: 200 }),
        makeQueueItem('n1', 'pending_embedding', { timestamp: 100 }),
        makeQueueItem('n3', 'pending_embedding', { timestamp: 300 }),
      ] as ProcessingQueueItem[]);

      const sorted = await testDb.processingQueue
        .where('status')
        .equals('pending_embedding')
        .sortBy('timestamp');

      expect(sorted[0].noteId).toBe('n1');
      expect(sorted[1].noteId).toBe('n2');
      expect(sorted[2].noteId).toBe('n3');
    });

    it('should delete queue items by noteId', async () => {
      await testDb.processingQueue.bulkPut([
        makeQueueItem('n1', 'completed'),
        makeQueueItem('n1', 'pending_embedding'),
        makeQueueItem('n2', 'pending_embedding'),
      ] as ProcessingQueueItem[]);

      const deleted = await testDb.processingQueue.where('noteId').equals('n1').delete();
      expect(deleted).toBe(2);

      const remaining = await testDb.processingQueue.toArray();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].noteId).toBe('n2');
    });

    it('should count failed items', async () => {
      await testDb.processingQueue.bulkPut([
        makeQueueItem('n1', 'failed', { error: 'OOM', retryCount: 3 }),
        makeQueueItem('n2', 'failed', { error: 'timeout', retryCount: 3 }),
        makeQueueItem('n3', 'completed'),
      ] as ProcessingQueueItem[]);

      const failedCount = await testDb.processingQueue
        .where('status')
        .equals('failed')
        .count();
      expect(failedCount).toBe(2);
    });

    it('should update queue item status', async () => {
      const id = await testDb.processingQueue.put(
        makeQueueItem('n1', 'pending_extraction') as ProcessingQueueItem
      );

      await testDb.processingQueue.update(id, { status: 'pending_embedding', type: 'text' });

      const updated = await testDb.processingQueue.get(id);
      expect(updated!.status).toBe('pending_embedding');
    });

    it('should modify failed items to reset retryCount', async () => {
      await testDb.processingQueue.bulkPut([
        makeQueueItem('n1', 'failed', { retryCount: 3 }),
        makeQueueItem('n2', 'failed', { retryCount: 3 }),
      ] as ProcessingQueueItem[]);

      await testDb.processingQueue
        .where('status')
        .equals('failed')
        .modify((item: ProcessingQueueItem) => {
          item.retryCount = 0;
          item.status = 'pending_embedding';
        });

      const allItems = await testDb.processingQueue.toArray();
      expect(allItems.every(i => i.status === 'pending_embedding')).toBe(true);
      expect(allItems.every(i => i.retryCount === 0)).toBe(true);
    });

    it('should filter completed items by timestamp for purging', async () => {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;

      await testDb.processingQueue.bulkPut([
        makeQueueItem('old1', 'completed', { timestamp: oneHourAgo - 1000 }),
        makeQueueItem('old2', 'completed', { timestamp: oneHourAgo - 5000 }),
        makeQueueItem('recent', 'completed', { timestamp: now }),
      ] as ProcessingQueueItem[]);

      const staleItems = await testDb.processingQueue
        .where('status')
        .equals('completed')
        .filter(item => item.timestamp < oneHourAgo)
        .toArray();

      expect(staleItems).toHaveLength(2);
      expect(staleItems.every(i => i.timestamp < oneHourAgo)).toBe(true);
    });
  });

  describe('Cross-table operations (offline data flow)', () => {
    it('should support full note lifecycle: embed → query → delete', async () => {
      // 1. Simulate embedding: store vectors for a note
      const noteId = 'memory-abc';
      await testDb.vectors.bulkPut([
        {
          id: `${noteId}_0`,
          originalId: noteId,
          vector: new Array(384).fill(0.5),
          extractedText: 'Recipe for chocolate cake',
          metadata: { originalId: noteId, chunkIndex: 0 },
        },
        {
          id: `${noteId}_1`,
          originalId: noteId,
          vector: new Array(384).fill(0.6),
          extractedText: 'Mix flour and cocoa powder',
          metadata: { originalId: noteId, chunkIndex: 1 },
        },
      ]);

      // 2. Verify vectors are stored
      const stored = await testDb.vectors.where('originalId').equals(noteId).toArray();
      expect(stored).toHaveLength(2);

      // 3. Simulate reading for offline search (what initOrama does)
      const allVectors = await testDb.vectors.toArray();
      const validVectors = allVectors.filter(v => v.vector.length === 384);
      expect(validVectors).toHaveLength(2);

      // 4. Delete note from vector DB
      const deletedVectors = await testDb.vectors.where('originalId').equals(noteId).delete();
      expect(deletedVectors).toBe(2);

      // 5. Verify cleanup
      const remaining = await testDb.vectors.toArray();
      expect(remaining).toHaveLength(0);
    });

    it('should handle queue item progression: extraction → embedding → completed', async () => {
      // 1. Add to queue as pending_extraction
      const id = await testDb.processingQueue.put({
        noteId: 'note1',
        type: 'text',
        contentOrPath: 'Raw text to process',
        retryCount: 0,
        status: 'pending_extraction',
        timestamp: Date.now(),
      } as ProcessingQueueItem);

      // 2. Move to pending_embedding
      await testDb.processingQueue.update(id, {
        status: 'pending_embedding',
        contentOrPath: 'Extracted clean text',
        type: 'text',
      });

      let item = await testDb.processingQueue.get(id);
      expect(item!.status).toBe('pending_embedding');

      // 3. Simulate embedding completed - store vectors
      await testDb.vectors.put({
        id: 'note1_0',
        originalId: 'note1',
        vector: new Array(384).fill(0.3),
        extractedText: 'Extracted clean text',
        metadata: { originalId: 'note1', chunkIndex: 0 },
      });

      // 4. Mark completed
      await testDb.processingQueue.update(id, { status: 'completed' });

      item = await testDb.processingQueue.get(id);
      expect(item!.status).toBe('completed');

      // 5. Verify vector is readable offline
      const vectors = await testDb.vectors.where('originalId').equals('note1').toArray();
      expect(vectors).toHaveLength(1);
      expect(vectors[0].extractedText).toBe('Extracted clean text');
    });

    it('should filter out incompatible vector dimensions on read', async () => {
      // Simulate old vectors with wrong dimensions (e.g., 768 from a previous model)
      await testDb.vectors.bulkPut([
        {
          id: 'old_0',
          originalId: 'old',
          vector: new Array(768).fill(0.1), // Wrong dimension
          extractedText: 'old incompatible vector',
          metadata: {},
        },
        {
          id: 'new_0',
          originalId: 'new',
          vector: new Array(384).fill(0.2), // Correct dimension
          extractedText: 'new compatible vector',
          metadata: {},
        },
      ]);

      // Read all and filter (mimics initOrama logic)
      const allVectors = await testDb.vectors.toArray();
      const compatible = allVectors.filter(v => v.vector.length === 384);
      const incompatible = allVectors.filter(v => v.vector.length !== 384);

      expect(compatible).toHaveLength(1);
      expect(compatible[0].originalId).toBe('new');

      expect(incompatible).toHaveLength(1);
      expect(incompatible[0].originalId).toBe('old');

      // Clean up incompatible (mimics worker behavior)
      await testDb.vectors.bulkDelete(incompatible.map(v => v.id));
      const remaining = await testDb.vectors.toArray();
      expect(remaining).toHaveLength(1);
    });
  });
});
