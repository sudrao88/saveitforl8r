
// This service handles the low-level encryption/decryption using Web Crypto API

const ALGO_NAME = 'AES-GCM';
const KEY_STORAGE_KEY = 'sifl_encryption_key_v1';

// Convert ArrayBuffer to Base64 string for storage
const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};

// Convert Base64 string to ArrayBuffer for crypto operations
const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
};

// Get or Create the Master Key
// In a real "Zero Knowledge" app, this would be derived from a user password.
// Here we use a generated key stored in LocalStorage for "At Rest" encryption.
const getMasterKey = async (): Promise<CryptoKey> => {
  const storedKey = localStorage.getItem(KEY_STORAGE_KEY);

  if (storedKey) {
    // Import existing key
    const keyData = JSON.parse(storedKey);
    return window.crypto.subtle.importKey(
      'jwk',
      keyData,
      { name: ALGO_NAME },
      true, // extractable
      ['encrypt', 'decrypt']
    );
  } else {
    // Generate new key
    const key = await window.crypto.subtle.generateKey(
      {
        name: ALGO_NAME,
        length: 256,
      },
      true, // extractable
      ['encrypt', 'decrypt']
    );

    // Export and save
    const exportedKey = await window.crypto.subtle.exportKey('jwk', key);
    localStorage.setItem(KEY_STORAGE_KEY, JSON.stringify(exportedKey));
    return key;
  }
};

export interface EncryptedPayload {
  cipherText: string; // Base64
  iv: string;         // Base64
}

// Encrypt any JSON-serializable data
export const encryptData = async (data: any): Promise<EncryptedPayload> => {
  const key = await getMasterKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 12 bytes for AES-GCM
  const encodedData = new TextEncoder().encode(JSON.stringify(data));

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: ALGO_NAME,
      iv: iv,
    },
    key,
    encodedData
  );

  return {
    cipherText: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv.buffer),
  };
};

// Decrypt data back to original object
export const decryptData = async (payload: EncryptedPayload): Promise<any> => {
  try {
    const key = await getMasterKey();
    const iv = base64ToArrayBuffer(payload.iv);
    const encryptedData = base64ToArrayBuffer(payload.cipherText);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: ALGO_NAME,
        iv: iv,
      },
      key,
      encryptedData
    );

    const decodedString = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(decodedString);
  } catch (error) {
    console.error('Decryption failed:', error);
    // Return null or throw depending on how we want to handle corruption
    throw new Error('Failed to decrypt data');
  }
};

// === Key Management Features ===

// Ensures a key exists, then returns its raw JSON string for backup
export const exportEncryptionKey = async (): Promise<string> => {
    // Ensure key exists
    await getMasterKey();
    return localStorage.getItem(KEY_STORAGE_KEY) || '';
};

// Restores a key from a JSON string. 
// WARNING: This overwrites the existing key. Data encrypted with the old key will be unreadable.
export const restoreEncryptionKey = (keyJSON: string): boolean => {
    try {
        const parsed = JSON.parse(keyJSON);
        // Basic validation that it looks like a JWK
        if (!parsed.kty || !parsed.k || parsed.alg !== 'A256GCM') return false;
        
        localStorage.setItem(KEY_STORAGE_KEY, keyJSON);
        return true;
    } catch (e) {
        console.error('Invalid key format', e);
        return false;
    }
};
