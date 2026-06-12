import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMemories, saveMemory, deleteMemory, getMemory, updateMemoryTags } from './storageService';
import { Memory } from '../types';

// Mock Encryption Service
vi.mock('./encryptionService', () => ({
  encryptData: vi.fn(async (data) => ({ cipherText: 'encrypted', iv: 'iv' })),
  decryptData: vi.fn(async (payload) => ({ content: 'decrypted content' })),
  decryptBatch: vi.fn(async (payloads) => payloads.map((p: any) => ({ id: p.id, data: { content: 'decrypted content' } }))),
}));

// Mock IndexedDB
const mockDB = {
  transaction: vi.fn(),
  objectStoreNames: {
    contains: vi.fn(),
  },
  createObjectStore: vi.fn(),
};

const mockTransaction = {
  objectStore: vi.fn(),
  oncomplete: vi.fn(),
  onerror: vi.fn(),
  error: null,
};

const mockStore = {
  getAll: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

const mockRequest: {
  result: any;
  onsuccess: ReturnType<typeof vi.fn> | null;
  onerror: ReturnType<typeof vi.fn> | null;
  error: any;
} = {
  result: null,
  onsuccess: vi.fn(),
  onerror: vi.fn(),
  error: null,
};

// Setup global indexedDB mock
const setupIndexedDBMock = () => {
  const indexedDB = {
    open: vi.fn().mockReturnValue({
      onupgradeneeded: vi.fn(),
      onsuccess: vi.fn(),
      onerror: vi.fn(),
      result: mockDB,
    }),
  };
  global.indexedDB = indexedDB as any;
};

describe('storageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupIndexedDBMock();

    // Setup default successful transaction flow
    mockDB.transaction.mockReturnValue(mockTransaction);
    mockTransaction.objectStore.mockReturnValue(mockStore);
    
    // Setup request mocks to trigger callbacks immediately
    mockStore.getAll.mockReturnValue(mockRequest);
    mockStore.get.mockReturnValue(mockRequest);
    mockStore.put.mockReturnValue(mockRequest);
    mockStore.delete.mockReturnValue(mockRequest);

    // Mock openDB success flow manually for tests that need it
    const openRequest: any = {
      result: mockDB,
      onsuccess: null,
      onerror: null,
    };
    (global.indexedDB.open as any).mockImplementation(() => {
        setTimeout(() => {
            if (openRequest.onsuccess) openRequest.onsuccess();
        }, 0);
        return openRequest;
    });
  });

  describe('normalizeMemory migration (via getMemories)', () => {
    const runWithStored = async (stored: any[]) => {
      mockRequest.result = stored;
      mockStore.getAll.mockImplementation(() => {
        setTimeout(() => { if (mockRequest.onsuccess) mockRequest.onsuccess(); }, 0);
        return mockRequest;
      });
      return await getMemories();
    };

    it('migrates legacy processingError:true → enrichmentStatus:failed_submit', async () => {
      const memories = await runWithStored([
        { id: 'a', content: 'x', timestamp: 1, tags: [], processingError: true },
      ]);
      expect(memories[0].enrichmentStatus).toBe('failed_submit');
      // Legacy mirrors stay in sync
      expect(memories[0].processingError).toBe(true);
    });

    it('migrates legacy isPending:true → enrichmentStatus:processing (server-source-of-truth default)', async () => {
      const memories = await runWithStored([
        { id: 'a', content: 'x', timestamp: 1, tags: [], isPending: true },
      ]);
      expect(memories[0].enrichmentStatus).toBe('processing');
      expect(memories[0].isPending).toBe(true);
    });

    it('does not overwrite existing enrichmentStatus on read', async () => {
      const memories = await runWithStored([
        { id: 'a', content: 'x', timestamp: 1, tags: [], enrichmentStatus: 'failed_server', processingError: true },
      ]);
      expect(memories[0].enrichmentStatus).toBe('failed_server');
    });

    it('infers enrichmentStatus:completed when enrichment data is present', async () => {
      const memories = await runWithStored([
        { id: 'a', content: 'x', timestamp: 1, tags: [], enrichment: { summary: 'done' } },
      ]);
      expect(memories[0].enrichmentStatus).toBe('completed');
    });
  });

  describe('getMemories', () => {
    it('should return sorted memories (handling legacy and encrypted)', async () => {
      const mockStoredMemories = [
        // Legacy (plaintext)
        { id: '1', content: 'legacy', timestamp: 1000, tags: [] },
        // Encrypted
        { id: '2', timestamp: 2000, encryptedData: { cipherText: 'abc', iv: '123' } },
      ];

      mockRequest.result = mockStoredMemories;
      // Trigger onsuccess when getAll is called
      mockStore.getAll.mockImplementation(() => {
          setTimeout(() => {
             if(mockRequest.onsuccess) mockRequest.onsuccess();
          }, 0);
          return mockRequest;
      });

      // The mock decryptData returns { content: 'decrypted content' }
      const memories = await getMemories();
      
      expect(memories).toHaveLength(2);
      expect(memories[0].id).toBe('2'); // Newest first
      expect(memories[0].content).toBe('decrypted content'); // From mock decryption
      
      expect(memories[1].id).toBe('1');
      expect(memories[1].content).toBe('legacy'); // Legacy fallback
      
      expect(mockStore.getAll).toHaveBeenCalled();
    });
  });

  describe('saveMemory', () => {
    it('should encrypt and save a memory', async () => {
      const memory: Memory = { 
        id: '1', 
        content: 'test', 
        timestamp: 123, 
        tags: [], 
      };

      // Mock transaction completion
      mockDB.transaction.mockImplementation(() => {
          const tx = { ...mockTransaction, oncomplete: null };
          setTimeout(() => {
              if(tx.oncomplete) (tx.oncomplete as any)();
          }, 0);
          return tx;
      });
      // Mock store put
      mockStore.put.mockReturnValue(mockRequest);

      await saveMemory(memory);
      
      // Verify it called put with the transformed object
      expect(mockStore.put).toHaveBeenCalledWith(expect.objectContaining({
        id: '1',
        timestamp: 123,
        encryptedData: { cipherText: 'encrypted', iv: 'iv' }
      }));
      
      // Should NOT contain plain text content
      expect(mockStore.put).not.toHaveBeenCalledWith(expect.objectContaining({
        content: 'test'
      }));
    });
  });

  describe('deleteMemory', () => {
      it('should delete a memory', async () => {
          const id = '123';

          mockDB.transaction.mockImplementation(() => {
            const tx = { ...mockTransaction, oncomplete: null };
            setTimeout(() => {
                if(tx.oncomplete) (tx.oncomplete as any)();
            }, 0);
            return tx;
        });

          // deleteMemory cascades to the relatedMemories store via
          // tombstoneRelatedMemories, which reads the record first — service
          // the get request with "no record found".
          mockRequest.result = undefined;
          mockStore.get.mockImplementation(() => {
              setTimeout(() => {
                  if (mockRequest.onsuccess) mockRequest.onsuccess();
              }, 0);
              return mockRequest;
          });

          await deleteMemory(id);
          expect(mockStore.delete).toHaveBeenCalledWith(id);
      });
  });

});
