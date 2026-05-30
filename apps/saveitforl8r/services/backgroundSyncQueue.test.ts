import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openDB, enqueue, dequeue, peekAll, remove, clear, registerBackgroundSync } from './backgroundSyncQueue';

// Mock IndexedDB
const mockDB = {
  transaction: vi.fn(),
  objectStoreNames: {
    contains: vi.fn(),
  },
  createObjectStore: vi.fn(),
  close: vi.fn(),
};

const mockTransaction = {
  objectStore: vi.fn(),
  oncomplete: null as (() => void) | null,
  onerror: null as ((e?: any) => void) | null,
  error: null as any,
};

const mockStore = {
  add: vi.fn(),
  getAll: vi.fn(),
  delete: vi.fn(),
  clear: vi.fn(),
  openCursor: vi.fn(),
};

const mockRequest: {
  result: any;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  error: any;
} = {
  result: null,
  onsuccess: null,
  onerror: null,
  error: null,
};

const setupIndexedDBMock = () => {
  const indexedDB = {
    open: vi.fn().mockReturnValue({
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      result: mockDB,
    }),
  };
  global.indexedDB = indexedDB as any;
};

const setupOpenDBSuccess = () => {
  const openRequest: any = {
    result: mockDB,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };
  (global.indexedDB.open as any).mockImplementation(() => {
    setTimeout(() => {
      if (openRequest.onsuccess) openRequest.onsuccess();
    }, 0);
    return openRequest;
  });
};

describe('backgroundSyncQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupIndexedDBMock();

    mockDB.transaction.mockReturnValue(mockTransaction);
    mockTransaction.objectStore.mockReturnValue(mockStore);
    mockTransaction.oncomplete = null;
    mockTransaction.onerror = null;
    mockTransaction.error = null;

    mockStore.add.mockReturnValue(mockRequest);
    mockStore.getAll.mockReturnValue(mockRequest);
    mockStore.delete.mockReturnValue(mockRequest);
    mockStore.clear.mockReturnValue(mockRequest);
    mockStore.openCursor.mockReturnValue(mockRequest);
    mockRequest.result = null;
    mockRequest.onsuccess = null;
    mockRequest.onerror = null;
    mockRequest.error = null;

    // Remove SyncManager and serviceWorker for isolation
    delete (window as any).SyncManager;
    delete (navigator as any).serviceWorker;
  });

  describe('openDB', () => {
    it('should open the IndexedDB and resolve with the database', async () => {
      setupOpenDBSuccess();

      const db = await openDB();
      expect(db).toBe(mockDB);
      expect(global.indexedDB.open).toHaveBeenCalledWith('saveitforl8r-bg-sync', 1);
    });

    it('should create object store on upgrade if it does not exist', async () => {
      const openRequest: any = {
        result: mockDB,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      mockDB.objectStoreNames.contains.mockReturnValue(false);

      (global.indexedDB.open as any).mockImplementation(() => {
        setTimeout(() => {
          if (openRequest.onupgradeneeded) {
            openRequest.onupgradeneeded({ target: openRequest });
          }
          if (openRequest.onsuccess) openRequest.onsuccess();
        }, 0);
        return openRequest;
      });

      await openDB();
      expect(mockDB.createObjectStore).toHaveBeenCalledWith('operations', {
        keyPath: 'id',
        autoIncrement: true,
      });
    });

    it('should not create object store if it already exists', async () => {
      const openRequest: any = {
        result: mockDB,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      mockDB.objectStoreNames.contains.mockReturnValue(true);

      (global.indexedDB.open as any).mockImplementation(() => {
        setTimeout(() => {
          if (openRequest.onupgradeneeded) {
            openRequest.onupgradeneeded({ target: openRequest });
          }
          if (openRequest.onsuccess) openRequest.onsuccess();
        }, 0);
        return openRequest;
      });

      await openDB();
      expect(mockDB.createObjectStore).not.toHaveBeenCalled();
    });

    it('should reject when IndexedDB open fails', async () => {
      const openRequest: any = {
        result: null,
        onsuccess: null,
        onerror: null,
        error: new Error('IndexedDB open failed'),
      };
      (global.indexedDB.open as any).mockImplementation(() => {
        setTimeout(() => {
          if (openRequest.onerror) openRequest.onerror();
        }, 0);
        return openRequest;
      });

      await expect(openDB()).rejects.toEqual(new Error('IndexedDB open failed'));
    });
  });

  describe('enqueue', () => {
    it('should add operation to queue and close db', async () => {
      setupOpenDBSuccess();

      mockDB.transaction.mockImplementation(() => {
        const tx = { ...mockTransaction, oncomplete: null, onerror: null };
        setTimeout(() => {
          if (tx.oncomplete) (tx.oncomplete as any)();
        }, 0);
        return tx;
      });

      await enqueue({ type: 'enrich', payload: { memoryId: 'mem-1' } });

      expect(mockStore.add).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'enrich',
          payload: { memoryId: 'mem-1' },
          createdAt: expect.any(Number),
        }),
      );
      expect(mockDB.close).toHaveBeenCalled();
    });

    it('should register background sync with enrich-memory tag for enrich type', async () => {
      setupOpenDBSuccess();

      const mockSync = { register: vi.fn().mockResolvedValue(undefined) };
      const mockRegistration = { sync: mockSync };
      (window as any).SyncManager = vi.fn();
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { ready: Promise.resolve(mockRegistration) },
        configurable: true,
      });

      mockDB.transaction.mockImplementation(() => {
        const tx = { ...mockTransaction, oncomplete: null, onerror: null };
        setTimeout(() => {
          if (tx.oncomplete) (tx.oncomplete as any)();
        }, 0);
        return tx;
      });

      await enqueue({ type: 'enrich', payload: {} });

      expect(mockSync.register).toHaveBeenCalledWith('enrich-memory');
    });

    it('should register background sync with sync-drive tag for sync-drive type', async () => {
      setupOpenDBSuccess();

      const mockSync = { register: vi.fn().mockResolvedValue(undefined) };
      const mockRegistration = { sync: mockSync };
      (window as any).SyncManager = vi.fn();
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { ready: Promise.resolve(mockRegistration) },
        configurable: true,
      });

      mockDB.transaction.mockImplementation(() => {
        const tx = { ...mockTransaction, oncomplete: null, onerror: null };
        setTimeout(() => {
          if (tx.oncomplete) (tx.oncomplete as any)();
        }, 0);
        return tx;
      });

      await enqueue({ type: 'sync-drive', payload: {} });

      expect(mockSync.register).toHaveBeenCalledWith('sync-drive');
    });

    it('should handle errors gracefully without throwing', async () => {
      const openRequest: any = {
        result: null,
        onsuccess: null,
        onerror: null,
        error: new Error('DB failure'),
      };
      (global.indexedDB.open as any).mockImplementation(() => {
        setTimeout(() => {
          if (openRequest.onerror) openRequest.onerror();
        }, 0);
        return openRequest;
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw
      await enqueue({ type: 'enrich', payload: {} });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('dequeue', () => {
    it('should remove and return the oldest operation', async () => {
      setupOpenDBSuccess();

      const mockCursorValue = {
        id: 1,
        type: 'enrich',
        payload: { memoryId: 'mem-1' },
        createdAt: 1000,
      };
      const mockCursor = {
        value: mockCursorValue,
        delete: vi.fn(),
      };

      mockDB.transaction.mockImplementation(() => {
        const tx = { ...mockTransaction, oncomplete: null, onerror: null, objectStore: vi.fn().mockReturnValue(mockStore) };
        mockStore.openCursor.mockImplementation(() => {
          const req: any = { result: mockCursor, onsuccess: null, onerror: null };
          setTimeout(() => {
            if (req.onsuccess) req.onsuccess();
            // Fire oncomplete after cursor resolves
            setTimeout(() => {
              if (tx.oncomplete) (tx.oncomplete as any)();
            }, 0);
          }, 0);
          return req;
        });
        return tx;
      });

      const result = await dequeue();

      expect(result).toEqual(mockCursorValue);
      expect(mockCursor.delete).toHaveBeenCalled();
      expect(mockDB.close).toHaveBeenCalled();
    });

    it('should return null when queue is empty', async () => {
      setupOpenDBSuccess();

      mockDB.transaction.mockImplementation(() => {
        const tx = { ...mockTransaction, oncomplete: null, onerror: null, objectStore: vi.fn().mockReturnValue(mockStore) };
        mockStore.openCursor.mockImplementation(() => {
          const req: any = { result: null, onsuccess: null, onerror: null };
          setTimeout(() => {
            if (req.onsuccess) req.onsuccess();
            // Fire oncomplete after cursor resolves
            setTimeout(() => {
              if (tx.oncomplete) (tx.oncomplete as any)();
            }, 0);
          }, 0);
          return req;
        });
        return tx;
      });

      const result = await dequeue();

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      const openRequest: any = {
        result: null,
        onsuccess: null,
        onerror: null,
        error: new Error('DB failure'),
      };
      (global.indexedDB.open as any).mockImplementation(() => {
        setTimeout(() => {
          if (openRequest.onerror) openRequest.onerror();
        }, 0);
        return openRequest;
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await dequeue();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('peekAll', () => {
    it('should return all operations without removing them', async () => {
      setupOpenDBSuccess();

      const operations = [
        { id: 1, type: 'enrich', payload: {}, createdAt: 1000 },
        { id: 2, type: 'sync-drive', payload: {}, createdAt: 2000 },
      ];

      mockStore.getAll.mockImplementation(() => {
        const req: any = { result: operations, onsuccess: null, onerror: null };
        setTimeout(() => {
          if (req.onsuccess) req.onsuccess();
        }, 0);
        return req;
      });

      const result = await peekAll();

      expect(result).toEqual(operations);
      expect(mockDB.transaction).toHaveBeenCalledWith('operations', 'readonly');
      expect(mockDB.close).toHaveBeenCalled();
    });

    it('should return empty array when no operations exist', async () => {
      setupOpenDBSuccess();

      mockStore.getAll.mockImplementation(() => {
        const req: any = { result: [], onsuccess: null, onerror: null };
        setTimeout(() => {
          if (req.onsuccess) req.onsuccess();
        }, 0);
        return req;
      });

      const result = await peekAll();

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      const openRequest: any = {
        result: null,
        onsuccess: null,
        onerror: null,
        error: new Error('DB failure'),
      };
      (global.indexedDB.open as any).mockImplementation(() => {
        setTimeout(() => {
          if (openRequest.onerror) openRequest.onerror();
        }, 0);
        return openRequest;
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await peekAll();

      expect(result).toEqual([]);
      consoleSpy.mockRestore();
    });
  });

  describe('remove', () => {
    it('should remove a specific operation by id', async () => {
      setupOpenDBSuccess();

      mockDB.transaction.mockImplementation(() => {
        const tx = { ...mockTransaction, oncomplete: null, onerror: null };
        setTimeout(() => {
          if (tx.oncomplete) (tx.oncomplete as any)();
        }, 0);
        return tx;
      });

      await remove(42);

      expect(mockStore.delete).toHaveBeenCalledWith(42);
      expect(mockDB.close).toHaveBeenCalled();
    });

    it('should handle errors gracefully without throwing', async () => {
      const openRequest: any = {
        result: null,
        onsuccess: null,
        onerror: null,
        error: new Error('DB failure'),
      };
      (global.indexedDB.open as any).mockImplementation(() => {
        setTimeout(() => {
          if (openRequest.onerror) openRequest.onerror();
        }, 0);
        return openRequest;
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw
      await remove(1);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('clear', () => {
    it('should remove all operations from the queue', async () => {
      setupOpenDBSuccess();

      mockDB.transaction.mockImplementation(() => {
        const tx = { ...mockTransaction, oncomplete: null, onerror: null };
        setTimeout(() => {
          if (tx.oncomplete) (tx.oncomplete as any)();
        }, 0);
        return tx;
      });

      await clear();

      expect(mockStore.clear).toHaveBeenCalled();
      expect(mockDB.close).toHaveBeenCalled();
    });

    it('should handle errors gracefully without throwing', async () => {
      const openRequest: any = {
        result: null,
        onsuccess: null,
        onerror: null,
        error: new Error('DB failure'),
      };
      (global.indexedDB.open as any).mockImplementation(() => {
        setTimeout(() => {
          if (openRequest.onerror) openRequest.onerror();
        }, 0);
        return openRequest;
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw
      await clear();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('registerBackgroundSync', () => {
    it('should register sync tag when SyncManager is available', async () => {
      const mockSync = { register: vi.fn().mockResolvedValue(undefined) };
      const mockRegistration = { sync: mockSync };
      (window as any).SyncManager = vi.fn();
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { ready: Promise.resolve(mockRegistration) },
        configurable: true,
      });

      await registerBackgroundSync('enrich-memory');

      expect(mockSync.register).toHaveBeenCalledWith('enrich-memory');
    });

    it('should no-op when SyncManager is not available', async () => {
      delete (window as any).SyncManager;

      // Should not throw
      await registerBackgroundSync('enrich-memory');
    });

    it('should no-op when serviceWorker is not available', async () => {
      (window as any).SyncManager = vi.fn();
      delete (navigator as any).serviceWorker;

      // Should not throw
      await registerBackgroundSync('enrich-memory');
    });

    it('should handle sync registration failure gracefully', async () => {
      const mockSync = { register: vi.fn().mockRejectedValue(new Error('Sync failed')) };
      const mockRegistration = { sync: mockSync };
      (window as any).SyncManager = vi.fn();
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { ready: Promise.resolve(mockRegistration) },
        configurable: true,
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Should not throw
      await registerBackgroundSync('enrich-memory');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
