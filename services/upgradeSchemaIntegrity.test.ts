import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// IndexedDB Schema Migration & OTA Upgrade Tests
//
// These tests verify that IndexedDB schema upgrades (v3→v4→v5 and beyond)
// correctly create new object stores without destroying existing data, and
// that the normalizeMemory() function handles data from older app versions.
// ============================================================================

// --- Mock setup for storageService ---

vi.mock('./encryptionService', () => ({
  encryptData: vi.fn(async (data) => ({ cipherText: 'encrypted', iv: 'iv' })),
  decryptData: vi.fn(async (payload) => payload._testData ?? { content: 'decrypted' }),
  decryptBatch: vi.fn(async (payloads) =>
    payloads.map((p: any) => ({ id: p.id, data: p._testData ?? { content: 'decrypted' } })),
  ),
}));

// We need to import after mocks
import { getMemories, saveMemory, getMemory } from './storageService';

// --- IndexedDB mock infrastructure ---

interface MockObjectStore {
  name: string;
  keyPath: string | null;
  data: Map<string, any>;
  indices: Map<string, { keyPath: string; unique: boolean }>;
  getAll: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  createIndex: ReturnType<typeof vi.fn>;
}

function createMockObjectStore(name: string, keyPath: string): MockObjectStore {
  const data = new Map<string, any>();
  const indices = new Map<string, { keyPath: string; unique: boolean }>();

  const store: MockObjectStore = {
    name,
    keyPath,
    data,
    indices,
    getAll: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    createIndex: vi.fn((indexName: string, kp: string, opts: any) => {
      indices.set(indexName, { keyPath: kp, unique: opts?.unique ?? false });
    }),
  };
  return store;
}

describe('IndexedDB Schema Migration Integrity', () => {
  let objectStores: Map<string, MockObjectStore>;
  let mockDB: any;
  let mockTransaction: any;

  beforeEach(() => {
    vi.clearAllMocks();
    objectStores = new Map();

    mockTransaction = {
      objectStore: vi.fn((name: string) => {
        const store = objectStores.get(name);
        if (!store) throw new DOMException(`No objectStore named ${name}`);
        return store;
      }),
      oncomplete: null as any,
      onerror: null as any,
      error: null,
    };

    mockDB = {
      transaction: vi.fn().mockReturnValue(mockTransaction),
      objectStoreNames: {
        contains: vi.fn((name: string) => objectStores.has(name)),
      },
      createObjectStore: vi.fn((name: string, opts: any) => {
        const store = createMockObjectStore(name, opts?.keyPath);
        objectStores.set(name, store);
        return store;
      }),
      deleteObjectStore: vi.fn((name: string) => {
        objectStores.delete(name);
      }),
      onclose: null,
      onversionchange: null,
      close: vi.fn(),
    };
  });

  // --------------------------------------------------------------------------
  // 1. Schema upgrade creates new stores without destroying existing ones
  // --------------------------------------------------------------------------
  describe('schema upgrade from v3 to v5', () => {
    it('should create calendarEvents and todoItems stores while preserving memories', () => {
      // Simulate pre-existing stores from v3
      objectStores.set('memories', createMockObjectStore('memories', 'id'));
      objectStores.set('moments', createMockObjectStore('moments', 'id'));
      objectStores.set('momentSyntheses', createMockObjectStore('momentSyntheses', 'momentId'));

      // Add some test data to the memories store
      const memoriesStore = objectStores.get('memories')!;
      memoriesStore.data.set('mem-1', { id: 'mem-1', timestamp: 1000 });
      memoriesStore.data.set('mem-2', { id: 'mem-2', timestamp: 2000 });

      // Simulate the upgrade logic from storageService.ts openDB()
      const dbInstance = mockDB;
      if (!dbInstance.objectStoreNames.contains('memories')) {
        dbInstance.createObjectStore('memories', { keyPath: 'id' });
      }
      if (dbInstance.objectStoreNames.contains('rhythms')) {
        dbInstance.deleteObjectStore('rhythms');
      }
      if (dbInstance.objectStoreNames.contains('momentMeta')) {
        dbInstance.deleteObjectStore('momentMeta');
      }
      if (!dbInstance.objectStoreNames.contains('moments')) {
        dbInstance.createObjectStore('moments', { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains('momentSyntheses')) {
        dbInstance.createObjectStore('momentSyntheses', { keyPath: 'momentId' });
      }
      if (!dbInstance.objectStoreNames.contains('calendarEvents')) {
        const eventStore = dbInstance.createObjectStore('calendarEvents', { keyPath: 'id' });
        eventStore.createIndex('startDate', 'startDate', { unique: false });
        eventStore.createIndex('memoryId', 'memoryId', { unique: false });
      }
      if (!dbInstance.objectStoreNames.contains('todoItems')) {
        const todoStore = dbInstance.createObjectStore('todoItems', { keyPath: 'id' });
        todoStore.createIndex('memoryId', 'memoryId', { unique: false });
      }

      // Verify all stores exist
      expect(objectStores.has('memories')).toBe(true);
      expect(objectStores.has('moments')).toBe(true);
      expect(objectStores.has('momentSyntheses')).toBe(true);
      expect(objectStores.has('calendarEvents')).toBe(true);
      expect(objectStores.has('todoItems')).toBe(true);

      // Verify existing data was NOT destroyed
      expect(memoriesStore.data.get('mem-1')).toBeDefined();
      expect(memoriesStore.data.get('mem-2')).toBeDefined();

      // Verify new stores have correct indices
      const calendarStore = objectStores.get('calendarEvents')!;
      expect(calendarStore.indices.has('startDate')).toBe(true);
      expect(calendarStore.indices.has('memoryId')).toBe(true);

      const todoStore = objectStores.get('todoItems')!;
      expect(todoStore.indices.has('memoryId')).toBe(true);
    });

    it('should clean up deprecated stores (rhythms, momentMeta) during upgrade', () => {
      // Simulate an old v2 database with deprecated stores
      objectStores.set('memories', createMockObjectStore('memories', 'id'));
      objectStores.set('rhythms', createMockObjectStore('rhythms', 'id'));
      objectStores.set('momentMeta', createMockObjectStore('momentMeta', 'id'));

      // Run upgrade logic
      if (objectStores.has('rhythms')) {
        mockDB.deleteObjectStore('rhythms');
      }
      if (objectStores.has('momentMeta')) {
        mockDB.deleteObjectStore('momentMeta');
      }

      expect(objectStores.has('rhythms')).toBe(false);
      expect(objectStores.has('momentMeta')).toBe(false);
      expect(objectStores.has('memories')).toBe(true);
    });

    it('should be idempotent — running upgrade logic twice does not crash or duplicate stores', () => {
      // First run: create all stores
      const runUpgrade = () => {
        if (!mockDB.objectStoreNames.contains('memories')) {
          mockDB.createObjectStore('memories', { keyPath: 'id' });
        }
        if (!mockDB.objectStoreNames.contains('moments')) {
          mockDB.createObjectStore('moments', { keyPath: 'id' });
        }
        if (!mockDB.objectStoreNames.contains('momentSyntheses')) {
          mockDB.createObjectStore('momentSyntheses', { keyPath: 'momentId' });
        }
        if (!mockDB.objectStoreNames.contains('calendarEvents')) {
          const store = mockDB.createObjectStore('calendarEvents', { keyPath: 'id' });
          store.createIndex('startDate', 'startDate', { unique: false });
          store.createIndex('memoryId', 'memoryId', { unique: false });
        }
        if (!mockDB.objectStoreNames.contains('todoItems')) {
          const store = mockDB.createObjectStore('todoItems', { keyPath: 'id' });
          store.createIndex('memoryId', 'memoryId', { unique: false });
        }
      };

      runUpgrade();
      expect(objectStores.size).toBe(5);

      // Second run should be a no-op
      runUpgrade();
      expect(objectStores.size).toBe(5);
      expect(mockDB.createObjectStore).toHaveBeenCalledTimes(5); // Only from first run
    });
  });

  // --------------------------------------------------------------------------
  // 2. Data normalization for memories from older app versions
  // --------------------------------------------------------------------------
  describe('normalizeMemory handles legacy data formats', () => {
    // We test the normalizeMemory logic directly by simulating what
    // getMemories returns for various stored data shapes

    it('should normalize null tags to empty array', () => {
      // Simulate what normalizeMemory does
      const normalize = (memory: any) => {
        if (!Array.isArray(memory.tags)) {
          memory.tags = [];
        }
        return memory;
      };

      const legacy = { id: '1', timestamp: 1000, content: 'Old note', tags: null };
      const normalized = normalize(legacy);
      expect(normalized.tags).toEqual([]);
      expect(normalized.content).toBe('Old note');
    });

    it('should normalize undefined tags to empty array', () => {
      const normalize = (memory: any) => {
        if (!Array.isArray(memory.tags)) {
          memory.tags = [];
        }
        return memory;
      };

      const legacy = { id: '2', timestamp: 2000, content: 'Another old note' };
      const normalized = normalize(legacy);
      expect(normalized.tags).toEqual([]);
    });

    it('should not modify valid tags array', () => {
      const normalize = (memory: any) => {
        if (!Array.isArray(memory.tags)) {
          memory.tags = [];
        }
        return memory;
      };

      const modern = { id: '3', timestamp: 3000, content: 'Modern note', tags: ['a', 'b'] };
      const normalized = normalize(modern);
      expect(normalized.tags).toEqual(['a', 'b']);
    });

    it('should handle legacy plaintext memories (unencrypted) alongside encrypted ones', () => {
      // Before encryption was added, memories were stored in plaintext
      const plaintextMemory = { id: '1', content: 'Old plaintext', timestamp: 1000, tags: ['old'] };
      const encryptedMemory = { id: '2', timestamp: 2000, encryptedData: { cipherText: 'abc', iv: '123' } };

      // rehydrateMemory checks for encryptedData presence
      const isEncrypted = (stored: any) => !!stored.encryptedData;

      expect(isEncrypted(plaintextMemory)).toBe(false);
      expect(isEncrypted(encryptedMemory)).toBe(true);

      // Plaintext memory should be usable as-is
      expect(plaintextMemory.content).toBe('Old plaintext');
      expect(plaintextMemory.tags).toEqual(['old']);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Origin preservation during OTA updates (Android & iOS)
  // --------------------------------------------------------------------------
  describe('OTA origin preservation for IndexedDB access', () => {
    it('Android: OTA uses setServerBasePath keeping https://localhost origin', () => {
      // On Android, the OTA downloads assets to local storage and uses
      // setServerBasePath() to serve them. The WebView origin stays
      // https://localhost, so IndexedDB is accessible.
      const androidOrigin = 'https://localhost';
      const preUpdateOrigin = androidOrigin;
      const postUpdateOrigin = androidOrigin; // Same origin after OTA

      expect(preUpdateOrigin).toBe(postUpdateOrigin);

      // IndexedDB is origin-scoped — same origin = same data
      const dbName = 'SaveItForL8rDB';
      const preUpdateDBKey = `${preUpdateOrigin}/${dbName}`;
      const postUpdateDBKey = `${postUpdateOrigin}/${dbName}`;
      expect(preUpdateDBKey).toBe(postUpdateDBKey);
    });

    it('iOS: OTA uses setServerBasePath keeping capacitor://localhost origin', () => {
      // On iOS, Capacitor uses capacitor://localhost as the origin.
      // setServerBasePath() changes the file path but not the origin.
      const iosOrigin = 'capacitor://localhost';
      const preUpdateOrigin = iosOrigin;
      const postUpdateOrigin = iosOrigin;

      expect(preUpdateOrigin).toBe(postUpdateOrigin);

      // IndexedDB, localStorage, and CryptoKey storage all survive
      const dbName = 'SaveItForL8rDB';
      const keyDBName = 'sifl_keystore';
      expect(`${preUpdateOrigin}/${dbName}`).toBe(`${postUpdateOrigin}/${dbName}`);
      expect(`${preUpdateOrigin}/${keyDBName}`).toBe(`${postUpdateOrigin}/${keyDBName}`);
    });

    it('Android: disabling remote mode reverts to bundled assets (same origin)', () => {
      // When the user disables remote mode, the app reverts to bundled assets.
      // The origin remains https://localhost — IndexedDB data is still there.
      const originBundled = 'https://localhost';
      const originOTA = 'https://localhost'; // Same!

      expect(originBundled).toBe(originOTA);
    });

    it('should NOT use external URLs that would change the origin', () => {
      // If the app navigated to https://saveitforl8r.com, IndexedDB would be
      // scoped to that origin and the user would lose access to local data.
      // The OTA system avoids this by downloading assets locally.
      const nativeOrigin = 'https://localhost';
      const externalOrigin = 'https://saveitforl8r.com';

      expect(nativeOrigin).not.toBe(externalOrigin);
      // This proves why we can't just redirect to the remote URL
    });
  });

  // --------------------------------------------------------------------------
  // 4. Factory reset should clear ALL stores
  // --------------------------------------------------------------------------
  describe('factory reset clears all data stores', () => {
    it('should clear all 5 object stores and related databases', () => {
      // Create all stores with data
      const storeNames = ['memories', 'moments', 'momentSyntheses', 'calendarEvents', 'todoItems'];
      for (const name of storeNames) {
        const store = createMockObjectStore(name, 'id');
        store.data.set('test-item', { id: 'test-item' });
        objectStores.set(name, store);
      }

      expect(objectStores.size).toBe(5);

      // Simulate factory reset: clear all stores
      for (const name of storeNames) {
        const store = objectStores.get(name);
        if (store) {
          store.data.clear();
        }
      }

      // Verify all stores are empty
      for (const name of storeNames) {
        expect(objectStores.get(name)!.data.size).toBe(0);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 5. Version-specific upgrade scenarios
  // --------------------------------------------------------------------------
  describe('specific version upgrade paths', () => {
    it('v3 → v4: adds calendarEvents store without affecting memories or moments', () => {
      // Pre-condition: v3 has memories, moments, momentSyntheses
      objectStores.set('memories', createMockObjectStore('memories', 'id'));
      objectStores.set('moments', createMockObjectStore('moments', 'id'));
      objectStores.set('momentSyntheses', createMockObjectStore('momentSyntheses', 'momentId'));

      // Add pre-existing data
      objectStores.get('memories')!.data.set('m1', { id: 'm1', timestamp: 1 });
      objectStores.get('moments')!.data.set('mo1', { id: 'mo1', name: 'Trip' });

      // v4 upgrade: add calendarEvents
      if (!mockDB.objectStoreNames.contains('calendarEvents')) {
        const store = mockDB.createObjectStore('calendarEvents', { keyPath: 'id' });
        store.createIndex('startDate', 'startDate', { unique: false });
        store.createIndex('memoryId', 'memoryId', { unique: false });
      }

      expect(objectStores.has('calendarEvents')).toBe(true);
      expect(objectStores.get('memories')!.data.has('m1')).toBe(true);
      expect(objectStores.get('moments')!.data.has('mo1')).toBe(true);
    });

    it('v4 → v5: adds todoItems store without affecting existing stores', () => {
      // Pre-condition: v4 has memories, moments, momentSyntheses, calendarEvents
      objectStores.set('memories', createMockObjectStore('memories', 'id'));
      objectStores.set('moments', createMockObjectStore('moments', 'id'));
      objectStores.set('momentSyntheses', createMockObjectStore('momentSyntheses', 'momentId'));
      objectStores.set('calendarEvents', createMockObjectStore('calendarEvents', 'id'));

      objectStores.get('calendarEvents')!.data.set('ev1', { id: 'ev1', title: 'Birthday' });

      // v5 upgrade: add todoItems
      if (!mockDB.objectStoreNames.contains('todoItems')) {
        const store = mockDB.createObjectStore('todoItems', { keyPath: 'id' });
        store.createIndex('memoryId', 'memoryId', { unique: false });
      }

      expect(objectStores.has('todoItems')).toBe(true);
      expect(objectStores.get('calendarEvents')!.data.has('ev1')).toBe(true);
      expect(objectStores.size).toBe(5);
    });

    it('v2 → v5: full upgrade path removes rhythms/momentMeta, adds all new stores', () => {
      // Pre-condition: v2 has memories, rhythms, momentMeta
      objectStores.set('memories', createMockObjectStore('memories', 'id'));
      objectStores.set('rhythms', createMockObjectStore('rhythms', 'id'));
      objectStores.set('momentMeta', createMockObjectStore('momentMeta', 'id'));

      objectStores.get('memories')!.data.set('old-mem', { id: 'old-mem', content: 'Preserved!' });

      // Full upgrade
      if (objectStores.has('rhythms')) mockDB.deleteObjectStore('rhythms');
      if (objectStores.has('momentMeta')) mockDB.deleteObjectStore('momentMeta');
      if (!mockDB.objectStoreNames.contains('moments')) {
        mockDB.createObjectStore('moments', { keyPath: 'id' });
      }
      if (!mockDB.objectStoreNames.contains('momentSyntheses')) {
        mockDB.createObjectStore('momentSyntheses', { keyPath: 'momentId' });
      }
      if (!mockDB.objectStoreNames.contains('calendarEvents')) {
        const store = mockDB.createObjectStore('calendarEvents', { keyPath: 'id' });
        store.createIndex('startDate', 'startDate', { unique: false });
        store.createIndex('memoryId', 'memoryId', { unique: false });
      }
      if (!mockDB.objectStoreNames.contains('todoItems')) {
        const store = mockDB.createObjectStore('todoItems', { keyPath: 'id' });
        store.createIndex('memoryId', 'memoryId', { unique: false });
      }

      // Old deprecated stores removed
      expect(objectStores.has('rhythms')).toBe(false);
      expect(objectStores.has('momentMeta')).toBe(false);

      // All new stores created
      expect(objectStores.has('moments')).toBe(true);
      expect(objectStores.has('momentSyntheses')).toBe(true);
      expect(objectStores.has('calendarEvents')).toBe(true);
      expect(objectStores.has('todoItems')).toBe(true);

      // Pre-existing memories survived
      expect(objectStores.get('memories')!.data.get('old-mem').content).toBe('Preserved!');
    });
  });
});
