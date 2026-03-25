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

  mockKeyObjectStore.put.mockImplementation((value: any, key: string) => {
    mockKeyStore[key] = value;
    const req = { onsuccess: null, onerror: null, error: null };
    setTimeout(() => {
      if (mockKeyDBTransaction.oncomplete) mockKeyDBTransaction.oncomplete();
    }, 0);
    return req;
  });

  mockKeyObjectStore.get.mockImplementation((key: string) => {
    const req: any = { result: mockKeyStore[key] || null, onsuccess: null, onerror: null };
    setTimeout(() => {
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  });
};

// ============================================================================
// Upgrade Data Integrity Tests
//
// These tests verify that user data survives app upgrades on Android and iOS.
// The app uses AES-GCM encryption with keys stored in IndexedDB. On native
// platforms, OTA updates download new web assets while keeping the same origin
// (Android: https://localhost, iOS: capacitor://localhost), which preserves
// IndexedDB, localStorage, and CryptoKey storage across updates.
// ============================================================================

describe('Upgrade Data Integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearCachedKey();
    Object.keys(mockKeyStore).forEach(k => delete mockKeyStore[k]);
    localStorage.removeItem('sifl_encryption_key_v1');
    setupKeyDBMock();
  });

  // --------------------------------------------------------------------------
  // 1. Encryption key survives app updates
  // --------------------------------------------------------------------------
  describe('encryption key persistence across updates', () => {
    it('should decrypt data with the same key after simulated app restart', async () => {
      // Simulate first app session: encrypt some data
      const originalData = {
        content: 'My important memory about a vacation',
        tags: ['travel', 'summer'],
        enrichment: { summary: 'A beach vacation in Hawaii' },
      };
      const encrypted = await encryptData(originalData);

      // Simulate app restart (clear in-memory cache, keep IndexedDB)
      _clearCachedKey();

      // Decrypt with key reloaded from IndexedDB — simulates post-update boot
      const decrypted = await decryptData(encrypted);
      expect(decrypted).toEqual(originalData);
    });

    it('should preserve key across multiple restart cycles', async () => {
      const data = { content: 'Persistent data', tags: ['test'] };
      const encrypted = await encryptData(data);

      // Export the key for verification
      const keyBefore = await exportEncryptionKey();

      // Simulate 3 restart cycles
      for (let i = 0; i < 3; i++) {
        _clearCachedKey();
        const decrypted = await decryptData(encrypted);
        expect(decrypted).toEqual(data);
      }

      // Key should still be the same
      _clearCachedKey();
      const keyAfter = await exportEncryptionKey();
      expect(keyAfter).toBe(keyBefore);
    });

    it('should decrypt all memories encrypted across different sessions', async () => {
      // Session 1: encrypt memory A
      const memoryA = { content: 'Memory A', tags: ['first'] };
      const encryptedA = await encryptData(memoryA);

      // Session 2: restart, encrypt memory B
      _clearCachedKey();
      const memoryB = { content: 'Memory B', tags: ['second'] };
      const encryptedB = await encryptData(memoryB);

      // Session 3: restart, both should decrypt
      _clearCachedKey();
      const decryptedA = await decryptData(encryptedA);
      const decryptedB = await decryptData(encryptedB);
      expect(decryptedA).toEqual(memoryA);
      expect(decryptedB).toEqual(memoryB);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Legacy key migration during upgrade
  // --------------------------------------------------------------------------
  describe('legacy key migration on upgrade', () => {
    it('should migrate localStorage key to IndexedDB and decrypt old data', async () => {
      // Simulate pre-upgrade state: key only in localStorage
      const legacyKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      );
      const legacyJWK = await crypto.subtle.exportKey('jwk', legacyKey);
      localStorage.setItem('sifl_encryption_key_v1', JSON.stringify(legacyJWK));

      // Encrypt data using the legacy key directly (simulating pre-migration data)
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const originalData = { content: 'Pre-upgrade memory', tags: ['legacy'] };
      const encoded = new TextEncoder().encode(JSON.stringify(originalData));
      const cipherBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        legacyKey,
        encoded,
      );

      // Convert to base64 payload (same format as encryptionService)
      const toBase64 = (buf: ArrayBuffer) => {
        let binary = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
      };
      const legacyEncrypted = {
        cipherText: toBase64(cipherBuffer),
        iv: toBase64(iv.buffer),
      };

      // Clear in-memory cache to force key reload (simulating app update)
      _clearCachedKey();

      // After migration, the key should move from localStorage to IndexedDB
      // and the legacy key should be removed
      const decrypted = await decryptData(legacyEncrypted);
      expect(decrypted).toEqual(originalData);
      expect(localStorage.getItem('sifl_encryption_key_v1')).toBeNull();
      expect(mockKeyStore['master_key_v2']).toBeDefined();
    });

    it('should handle corrupted localStorage key gracefully during migration', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      localStorage.setItem('sifl_encryption_key_v1', 'not-valid-json{{{');

      _clearCachedKey();

      // Should generate a new key instead of crashing
      const data = { content: 'New memory post-upgrade', tags: [] };
      const encrypted = await encryptData(data);
      expect(encrypted.cipherText).toBeDefined();
      expect(encrypted.iv).toBeDefined();

      const decrypted = await decryptData(encrypted);
      expect(decrypted).toEqual(data);
    });

    it('should not attempt migration when localStorage is empty', async () => {
      // No legacy key exists
      expect(localStorage.getItem('sifl_encryption_key_v1')).toBeNull();

      _clearCachedKey();

      // Should generate a new key cleanly
      const data = { content: 'Fresh install', tags: [] };
      const encrypted = await encryptData(data);
      const decrypted = await decryptData(encrypted);
      expect(decrypted).toEqual(data);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Key backup and restore for manual upgrade recovery
  // --------------------------------------------------------------------------
  describe('encryption key backup and restore across upgrades', () => {
    it('should export key, simulate data wipe, and restore to decrypt old data', async () => {
      // Encrypt data
      const data = { content: 'Critical memory', tags: ['important'] };
      const encrypted = await encryptData(data);

      // Backup the key
      const keyBackup = await exportEncryptionKey();
      expect(keyBackup).not.toBe('');

      // Simulate total data wipe (e.g., clearing app storage on iOS)
      _clearCachedKey();
      Object.keys(mockKeyStore).forEach(k => delete mockKeyStore[k]);

      // Verify decryption fails without the key
      await expect(decryptData(encrypted)).rejects.toThrow();

      // Restore the key from backup
      _clearCachedKey();
      const restored = await restoreEncryptionKey(keyBackup);
      expect(restored).toBe(true);

      // Now decryption should succeed
      _clearCachedKey();
      const decrypted = await decryptData(encrypted);
      expect(decrypted).toEqual(data);
    });

    it('should preserve access to data encrypted before and after key restore', async () => {
      // Encrypt data with original key
      const beforeData = { content: 'Before backup', tags: ['old'] };
      const encryptedBefore = await encryptData(beforeData);

      // Export key
      const keyBackup = await exportEncryptionKey();

      // Simulate key loss and restore
      _clearCachedKey();
      Object.keys(mockKeyStore).forEach(k => delete mockKeyStore[k]);
      await restoreEncryptionKey(keyBackup);

      // Encrypt new data with restored key
      _clearCachedKey();
      const afterData = { content: 'After restore', tags: ['new'] };
      const encryptedAfter = await encryptData(afterData);

      // Both should decrypt
      _clearCachedKey();
      expect(await decryptData(encryptedBefore)).toEqual(beforeData);
      expect(await decryptData(encryptedAfter)).toEqual(afterData);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Data format resilience across schema versions
  // --------------------------------------------------------------------------
  describe('data format resilience across schema versions', () => {
    it('should handle memories with null tags from older versions', async () => {
      // Older app versions may have saved memories with null tags
      const legacyData = { content: 'Old memory', tags: null };
      const encrypted = await encryptData(legacyData);

      _clearCachedKey();
      const decrypted = await decryptData(encrypted);

      // The raw decrypted data will have null tags — normalizeMemory() in
      // storageService handles this, but the encryption layer should not corrupt it
      expect(decrypted.content).toBe('Old memory');
      expect(decrypted.tags).toBeNull();
    });

    it('should handle memories with missing optional fields from older versions', async () => {
      // Minimal memory from an early app version (no enrichment, no attachments)
      const minimalMemory = { content: 'Just text', tags: [] };
      const encrypted = await encryptData(minimalMemory);

      _clearCachedKey();
      const decrypted = await decryptData(encrypted);
      expect(decrypted).toEqual(minimalMemory);
      expect(decrypted.enrichment).toBeUndefined();
      expect(decrypted.attachments).toBeUndefined();
      expect(decrypted.location).toBeUndefined();
    });

    it('should handle memories with extra fields from newer versions', async () => {
      // Future version might add new fields — old decryption should not lose them
      const futureMemory = {
        content: 'Future memory',
        tags: ['test'],
        newFeatureField: 'some value',
        anotherNewField: { nested: true },
      };
      const encrypted = await encryptData(futureMemory);

      _clearCachedKey();
      const decrypted = await decryptData(encrypted);
      expect(decrypted).toEqual(futureMemory);
      expect(decrypted.newFeatureField).toBe('some value');
    });

    it('should handle memories with legacy image field (pre-attachments)', async () => {
      // Before the attachments array, images were stored in a top-level image field
      const legacyImageMemory = {
        content: 'Photo of sunset',
        tags: ['photo'],
        image: 'data:image/jpeg;base64,/9j/4AAQ...',
      };
      const encrypted = await encryptData(legacyImageMemory);

      _clearCachedKey();
      const decrypted = await decryptData(encrypted);
      expect(decrypted.image).toBe('data:image/jpeg;base64,/9j/4AAQ...');
      expect(decrypted.content).toBe('Photo of sunset');
    });

    it('should handle memories with enrichment data from different enrichment versions', async () => {
      // Enrichment schema has grown over time — verify backward compatibility
      const memoryWithOldEnrichment = {
        content: 'A movie recommendation',
        tags: ['movie'],
        enrichment: {
          summary: 'A great sci-fi movie',
          suggestedTags: ['sci-fi'],
          // These fields were added in later versions
        },
      };
      const memoryWithNewEnrichment = {
        content: 'A recipe',
        tags: ['cooking'],
        enrichment: {
          summary: 'Pasta recipe',
          suggestedTags: ['food'],
          contentType: 'recipe',
          enrichmentStrategy: 'recipe',
          ingredients: ['pasta', 'tomato', 'basil'],
          instructions: ['Boil pasta', 'Add sauce'],
          detectedEvents: [],
          detectedActionItems: [{ title: 'Buy basil', completed: false }],
        },
      };

      const encOld = await encryptData(memoryWithOldEnrichment);
      const encNew = await encryptData(memoryWithNewEnrichment);

      _clearCachedKey();
      const decOld = await decryptData(encOld);
      const decNew = await decryptData(encNew);

      expect(decOld.enrichment.summary).toBe('A great sci-fi movie');
      expect(decOld.enrichment.contentType).toBeUndefined();
      expect(decNew.enrichment.ingredients).toEqual(['pasta', 'tomato', 'basil']);
    });

    it('should handle memories with location data', async () => {
      const memoryWithLocation = {
        content: 'Visit to the park',
        tags: ['outdoors'],
        location: { latitude: 37.7749, longitude: -122.4194, accuracy: 10 },
      };
      const encrypted = await encryptData(memoryWithLocation);

      _clearCachedKey();
      const decrypted = await decryptData(encrypted);
      expect(decrypted.location.latitude).toBe(37.7749);
      expect(decrypted.location.longitude).toBe(-122.4194);
    });

    it('should handle memories with attachments array', async () => {
      const memoryWithAttachments = {
        content: 'Meeting notes',
        tags: ['work'],
        attachments: [
          { id: 'att-1', mimeType: 'application/pdf', data: 'base64data...', name: 'notes.pdf' },
          { id: 'att-2', mimeType: 'image/png', data: 'base64data...', name: 'whiteboard.png' },
        ],
      };
      const encrypted = await encryptData(memoryWithAttachments);

      _clearCachedKey();
      const decrypted = await decryptData(encrypted);
      expect(decrypted.attachments).toHaveLength(2);
      expect(decrypted.attachments[0].name).toBe('notes.pdf');
      expect(decrypted.attachments[1].mimeType).toBe('image/png');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Concurrent encryption operations during update
  // --------------------------------------------------------------------------
  describe('concurrent operations resilience', () => {
    it('should handle multiple sequential encrypt/decrypt without data corruption', async () => {
      const memories = Array.from({ length: 5 }, (_, i) => ({
        content: `Memory number ${i}`,
        tags: [`tag-${i}`],
      }));

      // Encrypt sequentially (worker mock doesn't handle parallel well)
      const encrypted = [];
      for (const m of memories) {
        encrypted.push(await encryptData(m));
      }

      // Restart
      _clearCachedKey();

      // Decrypt sequentially
      const decrypted = [];
      for (const e of encrypted) {
        decrypted.push(await decryptData(e));
      }

      for (let i = 0; i < memories.length; i++) {
        expect(decrypted[i]).toEqual(memories[i]);
      }
    });

    it('should produce unique ciphertexts for identical data (IV uniqueness)', async () => {
      const data = { content: 'Same content', tags: [] };

      // Encrypt the same data multiple times sequentially
      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(await encryptData(data));
      }

      // All IVs should be unique (collision would compromise AES-GCM security)
      const ivs = results.map(r => r.iv);
      const uniqueIVs = new Set(ivs);
      expect(uniqueIVs.size).toBe(5);

      // All should decrypt to the same value
      for (const enc of results) {
        const dec = await decryptData(enc);
        expect(dec).toEqual(data);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 6. Decryption failure handling (corrupted data after partial update)
  // --------------------------------------------------------------------------
  describe('decryption failure handling', () => {
    it('should throw on corrupted ciphertext (simulating storage corruption)', async () => {
      const data = { content: 'Good data', tags: [] };
      const encrypted = await encryptData(data);

      // Simulate storage corruption (e.g., partial write during crash)
      encrypted.cipherText = encrypted.cipherText.slice(0, -10) + 'XXXXXXXXXX';

      await expect(decryptData(encrypted)).rejects.toThrow();
    });

    it('should throw on mismatched IV (simulating data mix-up)', async () => {
      const data1 = { content: 'Data 1', tags: [] };
      const data2 = { content: 'Data 2', tags: [] };
      const enc1 = await encryptData(data1);
      const enc2 = await encryptData(data2);

      // Swap IVs — should fail decryption (AES-GCM auth tag won't match)
      const mixedPayload = { cipherText: enc1.cipherText, iv: enc2.iv };
      await expect(decryptData(mixedPayload)).rejects.toThrow();
    });

    it('should not lose key when decryption fails', async () => {
      const goodData = { content: 'Good data', tags: [] };
      const goodEncrypted = await encryptData(goodData);

      // Attempt to decrypt corrupted data
      const badPayload = { cipherText: 'totally_invalid', iv: 'also_invalid' };
      await expect(decryptData(badPayload)).rejects.toThrow();

      // Key should still work for valid data
      const decrypted = await decryptData(goodEncrypted);
      expect(decrypted).toEqual(goodData);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Large data payload survival
  // --------------------------------------------------------------------------
  describe('large data payloads', () => {
    it('should encrypt and decrypt a memory with large content', async () => {
      const largeContent = 'A'.repeat(100_000); // 100KB of text
      const data = { content: largeContent, tags: ['large'] };
      const encrypted = await encryptData(data);

      _clearCachedKey();
      const decrypted = await decryptData(encrypted);
      expect(decrypted.content).toBe(largeContent);
      expect(decrypted.content.length).toBe(100_000);
    });

    it('should handle memory with many tags', async () => {
      const data = {
        content: 'Tagged memory',
        tags: Array.from({ length: 100 }, (_, i) => `tag-${i}`),
      };
      const encrypted = await encryptData(data);

      _clearCachedKey();
      const decrypted = await decryptData(encrypted);
      expect(decrypted.tags).toHaveLength(100);
      expect(decrypted.tags[99]).toBe('tag-99');
    });

    it('should handle memory with deeply nested enrichment', async () => {
      const data = {
        content: 'Complex memory',
        tags: [],
        enrichment: {
          summary: 'Test',
          suggestedTags: ['a', 'b'],
          entityContext: {
            type: 'Movie',
            title: 'Inception',
            subtitle: 'Christopher Nolan',
            description: 'A mind-bending thriller',
            rating: '8.8',
          },
          locationContext: {
            name: 'AMC Theater',
            address: '123 Main St',
            latitude: 40.7128,
            longitude: -74.006,
          },
          temporalContext: {
            relevantAt: {
              start: '2026-06-15',
              end: '2026-06-20',
              isRecurring: false,
            },
            urgency: 'low' as const,
            inferenceConfidence: 0.85,
          },
          keyPoints: ['Point 1', 'Point 2'],
          actionItems: ['Watch the sequel'],
          linkPreviews: [{
            url: 'https://example.com',
            imageData: 'data:image/png;base64,abc',
            imageMimeType: 'image/png',
            title: 'Example',
          }],
        },
      };
      const encrypted = await encryptData(data);

      _clearCachedKey();
      const decrypted = await decryptData(encrypted);
      expect(decrypted.enrichment.entityContext.title).toBe('Inception');
      expect(decrypted.enrichment.locationContext.latitude).toBe(40.7128);
      expect(decrypted.enrichment.temporalContext.relevantAt.start).toBe('2026-06-15');
      expect(decrypted.enrichment.linkPreviews[0].url).toBe('https://example.com');
    });
  });

  // --------------------------------------------------------------------------
  // 8. Unicode and special character preservation
  // --------------------------------------------------------------------------
  describe('unicode and special character preservation', () => {
    it('should preserve emoji content across encrypt/decrypt', async () => {
      const data = { content: 'Great vacation! 🏖️🌅✨ Had an amazing time 🎉', tags: ['emoji'] };
      const encrypted = await encryptData(data);

      _clearCachedKey();
      const decrypted = await decryptData(encrypted);
      expect(decrypted.content).toBe('Great vacation! 🏖️🌅✨ Had an amazing time 🎉');
    });

    it('should preserve CJK characters', async () => {
      const data = { content: '今日は素晴らしい日です。中文测试。한국어 테스트', tags: ['日本語', '中文'] };
      const encrypted = await encryptData(data);

      _clearCachedKey();
      const decrypted = await decryptData(encrypted);
      expect(decrypted).toEqual(data);
    });

    it('should preserve RTL text (Arabic/Hebrew)', async () => {
      const data = { content: 'مرحبا بالعالم — שלום עולם', tags: ['rtl'] };
      const encrypted = await encryptData(data);

      _clearCachedKey();
      const decrypted = await decryptData(encrypted);
      expect(decrypted.content).toBe('مرحبا بالعالم — שלום עולם');
    });

    it('should preserve special characters and newlines', async () => {
      const data = {
        content: 'Line 1\nLine 2\tTabbed\r\n"Quoted" & <special> chars © ® ™',
        tags: ['special & chars'],
      };
      const encrypted = await encryptData(data);

      _clearCachedKey();
      const decrypted = await decryptData(encrypted);
      expect(decrypted).toEqual(data);
    });
  });
});
