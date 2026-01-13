import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMemories, saveMemory, deleteMemory, getMemory, updateMemoryTags } from './storageService';
import { Memory } from '../types';

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
};

const mockStore = {
  getAll: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

const mockRequest = {
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
    // Note: Since openDB is internal, we rely on indexedDB.open behavior
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

  describe('getMemories', () => {
    it('should return sorted memories', async () => {
      const mockMemories = [
        { id: '1', content: 'old', timestamp: 1000, tags: [], type: 'text' },
        { id: '2', content: 'new', timestamp: 2000, tags: [], type: 'text' },
      ];

      mockRequest.result = mockMemories;
      // Trigger onsuccess when getAll is called
      mockStore.getAll.mockImplementation(() => {
          setTimeout(() => {
             if(mockRequest.onsuccess) mockRequest.onsuccess();
          }, 0);
          return mockRequest;
      });

      const memories = await getMemories();
      
      expect(memories).toHaveLength(2);
      expect(memories[0].id).toBe('2'); // Newest first
      expect(memories[1].id).toBe('1');
      expect(mockStore.getAll).toHaveBeenCalled();
    });

    it('should return empty array on error', async () => {
      // Mock console.error to avoid polluting output
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockStore.getAll.mockImplementation(() => {
          setTimeout(() => {
              // Creating a DOMException-like object which is often what's expected
              mockRequest.error = { name: 'Error', message: 'Database Error' } as any; 
              if(mockRequest.onerror) mockRequest.onerror();
          }, 0);
          return mockRequest;
      });

      const memories = await getMemories();
      expect(memories).toEqual([]);
      
      consoleSpy.mockRestore();
    });
  });

  describe('saveMemory', () => {
    it('should save a memory', async () => {
      const memory: Memory = { 
        id: '1', 
        content: 'test', 
        timestamp: 123, 
        tags: [], 
        type: 'text' 
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
      expect(mockStore.put).toHaveBeenCalledWith(memory);
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

          await deleteMemory(id);
          expect(mockStore.delete).toHaveBeenCalledWith(id);
      });
  });
});
