import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encryptData, decryptData, exportEncryptionKey, restoreEncryptionKey, _clearCachedKey } from './encryptionService';

// Mock IndexedDB for the keystore
const mockKeyStore: Record<string, any> = {};

const mockKeyDBTransaction = {
  objectStore: vi.fn(),
  oncomplete: null as any,
  onerror: null as any,
  error: null,
};

const mockKeyObjectStore = {
  put: vi.fn(),
  get: vi.fn(),
};

const setupKeyDBMock = () => {
  mockKeyDBTransaction.objectStore.mockReturnValue(mockKeyObjectStore);

  const mockDB = {
    transaction: vi.fn().mockReturnValue(mockKeyDBTransaction),
    objectStoreNames: { contains: vi.fn().mockReturnValue(true) },
    createObjectStore: vi.fn(),
  };

  const mockOpenRequest: any = {
    result: mockDB,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };

  vi.stubGlobal('indexedDB', {
    open: vi.fn().mockImplementation(() => {
      setTimeout(() => {
        if (mockOpenRequest.onsuccess) mockOpenRequest.onsuccess();
      }, 0);
      return mockOpenRequest;
    }),
  });

  // Mock put to store values and trigger transaction complete
  mockKeyObjectStore.put.mockImplementation((value: any, key: string) => {
    mockKeyStore[key] = value;
    const req = { onsuccess: null, onerror: null, error: null };
    setTimeout(() => {
      if (mockKeyDBTransaction.oncomplete) mockKeyDBTransaction.oncomplete();
    }, 0);
    return req;
  });

  // Mock get to retrieve values
  mockKeyObjectStore.get.mockImplementation((key: string) => {
    const req: any = { result: mockKeyStore[key] || null, onsuccess: null, onerror: null };
    setTimeout(() => {
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  });
};

describe('encryptionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearCachedKey();
    // Clear mock store
    Object.keys(mockKeyStore).forEach(k => delete mockKeyStore[k]);
    // Clear legacy localStorage
    localStorage.removeItem('sifl_encryption_key_v1');
    setupKeyDBMock();
  });

  describe('encryptData / decryptData round-trip', () => {
    it('should encrypt and decrypt data correctly', async () => {
      const original = { content: 'Hello World', tags: ['test', 'encryption'] };
      const encrypted = await encryptData(original);

      expect(encrypted).toHaveProperty('cipherText');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted.cipherText).not.toBe('');
      expect(encrypted.iv).not.toBe('');

      // cipherText should not contain the original plaintext
      expect(encrypted.cipherText).not.toContain('Hello World');

      const decrypted = await decryptData(encrypted);
      expect(decrypted).toEqual(original);
    });

    it('should produce different ciphertext for the same input (random IV)', async () => {
      const data = { content: 'same input' };
      const encrypted1 = await encryptData(data);
      const encrypted2 = await encryptData(data);

      // IVs should differ
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      // Ciphertext should differ due to different IVs
      expect(encrypted1.cipherText).not.toBe(encrypted2.cipherText);

      // Both should decrypt to the same value
      const decrypted1 = await decryptData(encrypted1);
      const decrypted2 = await decryptData(encrypted2);
      expect(decrypted1).toEqual(decrypted2);
    });

    it('should handle complex nested objects', async () => {
      const complex = {
        content: 'A memory with attachments',
        tags: ['movie', 'sci-fi'],
        enrichment: {
          summary: 'A great movie',
          entityContext: { type: 'Movie', title: 'Inception', rating: '8.8' },
        },
        location: { latitude: 37.7749, longitude: -122.4194 },
      };

      const encrypted = await encryptData(complex);
      const decrypted = await decryptData(encrypted);
      expect(decrypted).toEqual(complex);
    });

    it('should handle empty objects', async () => {
      const encrypted = await encryptData({});
      const decrypted = await decryptData(encrypted);
      expect(decrypted).toEqual({});
    });
  });

  describe('decryptData error handling', () => {
    it('should throw on corrupted ciphertext', async () => {
      const encrypted = await encryptData({ content: 'test' });
      // Corrupt the ciphertext
      encrypted.cipherText = 'corrupted_base64_data_that_is_invalid';

      await expect(decryptData(encrypted)).rejects.toThrow('Failed to decrypt data');
    });

    it('should throw on corrupted IV', async () => {
      const encrypted = await encryptData({ content: 'test' });
      // Corrupt the IV
      encrypted.iv = 'bad_iv';

      await expect(decryptData(encrypted)).rejects.toThrow('Failed to decrypt data');
    });
  });

  describe('exportEncryptionKey', () => {
    it('should return a valid JWK JSON string after key generation', async () => {
      // Trigger key generation via encrypt
      await encryptData({ test: true });

      const exported = await exportEncryptionKey();
      expect(exported).not.toBe('');

      const jwk = JSON.parse(exported);
      expect(jwk.kty).toBe('oct');
      expect(jwk.alg).toBe('A256GCM');
      expect(jwk.k).toBeDefined();
    });
  });

  describe('restoreEncryptionKey', () => {
    it('should accept a valid JWK and store it', async () => {
      // First generate a key
      await encryptData({ test: true });
      const originalExport = await exportEncryptionKey();

      // Generate a second key by clearing cache
      _clearCachedKey();
      // Clear the stored key from mock
      Object.keys(mockKeyStore).forEach(k => delete mockKeyStore[k]);

      await encryptData({ test2: true });

      // Restore the original key
      const success = await restoreEncryptionKey(originalExport);
      expect(success).toBe(true);
    });

    it('should reject invalid JSON', async () => {
      const success = await restoreEncryptionKey('not json');
      expect(success).toBe(false);
    });

    it('should reject JWK missing required fields', async () => {
      const success = await restoreEncryptionKey(JSON.stringify({ kty: 'oct' }));
      expect(success).toBe(false);
    });

    it('should reject JWK with wrong algorithm', async () => {
      const success = await restoreEncryptionKey(
        JSON.stringify({ kty: 'oct', k: 'test', alg: 'A128GCM' })
      );
      expect(success).toBe(false);
    });
  });

  describe('key migration from localStorage', () => {
    it('should migrate a legacy key from localStorage and remove it', async () => {
      // Create a valid JWK and store in localStorage (legacy location)
      const legacyKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
      const legacyJWK = await crypto.subtle.exportKey('jwk', legacyKey);
      localStorage.setItem('sifl_encryption_key_v1', JSON.stringify(legacyJWK));

      // Clear cache so getMasterKey re-discovers key
      _clearCachedKey();

      // Trigger key loading — should migrate
      await encryptData({ migration: 'test' });

      // Legacy key should be removed from localStorage
      expect(localStorage.getItem('sifl_encryption_key_v1')).toBeNull();

      // Key should now be in IndexedDB (mock store)
      expect(mockKeyStore['master_key_v2']).toBeDefined();
    });
  });
});
