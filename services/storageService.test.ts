import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMemories, saveMemory, deleteMemory, getMemory, updateMemoryTags, saveMoment } from './storageService';
import { Memory, Moment } from '../types';

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

          await deleteMemory(id);
          expect(mockStore.delete).toHaveBeenCalledWith(id);
      });
  });

  describe('saveMoment tombstone protection', () => {
    // Drives the full save flow (transaction, get, oncomplete) against a
    // shared mock store. Returns a put spy + commit() so the test can fire
    // callbacks in the right order.
    const makeSaveDriver = (existingRecord: Moment | undefined) => {
      const putSpy = vi.fn();
      const txCallbacks: { oncomplete: (() => void) | null; onerror: (() => void) | null } = {
        oncomplete: null,
        onerror: null,
      };
      const getRequest: any = { result: existingRecord, onsuccess: null, onerror: null };

      const store = {
        get: vi.fn(() => getRequest),
        put: putSpy,
      };

      mockDB.transaction.mockImplementation(() => {
        const tx: any = {
          objectStore: () => store,
          get oncomplete() { return txCallbacks.oncomplete; },
          set oncomplete(v) { txCallbacks.oncomplete = v; },
          get onerror() { return txCallbacks.onerror; },
          set onerror(v) { txCallbacks.onerror = v; },
          error: null,
        };
        return tx;
      });

      const commit = () => {
        // Fire get success first, then transaction commit.
        if (getRequest.onsuccess) getRequest.onsuccess();
        if (txCallbacks.oncomplete) txCallbacks.oncomplete();
      };

      return { putSpy, commit };
    };

    const baseMoment: Moment = {
      id: 'm-1',
      objective: 'Test',
      title: 'Test',
      type: 'general',
      noteIds: [],
      createdAt: 1000,
      updatedAt: 2000,
    };

    it('refuses to overwrite a tombstone with an alive record (resurrection race)', async () => {
      const tombstone: Moment = { ...baseMoment, isDeleted: true, updatedAt: 5000 };
      const aliveLate: Moment = { ...baseMoment, updatedAt: 6000 };

      const { putSpy, commit } = makeSaveDriver(tombstone);

      const promise = saveMoment(aliveLate);
      await Promise.resolve(); // let openDB resolve
      await Promise.resolve();
      commit();
      await promise;

      expect(putSpy).not.toHaveBeenCalled();
    });

    it('allows tombstoning an alive record', async () => {
      const alive: Moment = { ...baseMoment };
      const tombstone: Moment = { ...baseMoment, isDeleted: true, updatedAt: 7000 };

      const { putSpy, commit } = makeSaveDriver(alive);

      const promise = saveMoment(tombstone);
      await Promise.resolve();
      await Promise.resolve();
      commit();
      await promise;

      expect(putSpy).toHaveBeenCalledWith(tombstone);
    });

    it('allows updating an alive record', async () => {
      const alive: Moment = { ...baseMoment };
      const updated: Moment = { ...baseMoment, title: 'Updated', updatedAt: 9000 };

      const { putSpy, commit } = makeSaveDriver(alive);

      const promise = saveMoment(updated);
      await Promise.resolve();
      await Promise.resolve();
      commit();
      await promise;

      expect(putSpy).toHaveBeenCalledWith(updated);
    });

    it('allows creating a new record (no existing entry)', async () => {
      const fresh: Moment = { ...baseMoment };

      const { putSpy, commit } = makeSaveDriver(undefined);

      const promise = saveMoment(fresh);
      await Promise.resolve();
      await Promise.resolve();
      commit();
      await promise;

      expect(putSpy).toHaveBeenCalledWith(fresh);
    });
  });
});
