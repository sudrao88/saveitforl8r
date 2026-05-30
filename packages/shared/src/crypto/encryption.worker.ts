/**
 * Encryption Web Worker
 *
 * Offloads AES-GCM encrypt/decrypt operations from the main thread
 * to prevent UI freezes during bulk sync or mass memory loading.
 */

const ALGO_NAME = 'AES-GCM';

let cachedKey: CryptoKey | null = null;

// Convert ArrayBuffer to Base64 string
const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

// Convert Base64 string to Uint8Array
const base64ToArrayBuffer = (base64: string): Uint8Array => {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
};

async function importKey(jwk: JsonWebKey): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  cachedKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: ALGO_NAME },
    false,
    ['encrypt', 'decrypt']
  );
  return cachedKey;
}

async function encryptData(jwk: JsonWebKey, data: any): Promise<{ cipherText: string; iv: string }> {
  const key = await importKey(jwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedData = new TextEncoder().encode(JSON.stringify(data));

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: ALGO_NAME, iv },
    key,
    encodedData
  );

  return {
    cipherText: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv.buffer),
  };
}

async function decryptData(jwk: JsonWebKey, payload: { cipherText: string; iv: string }): Promise<any> {
  const key = await importKey(jwk);
  const iv = base64ToArrayBuffer(payload.iv);
  const encryptedData = base64ToArrayBuffer(payload.cipherText);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: ALGO_NAME, iv },
    key,
    encryptedData
  );

  const decodedString = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(decodedString);
}

async function decryptBatch(jwk: JsonWebKey, payloads: { id: string; cipherText: string; iv: string }[]): Promise<{ id: string; data?: any; error?: string }[]> {
  const key = await importKey(jwk);
  const results = await Promise.all(
    payloads.map(async (payload) => {
      try {
        const iv = base64ToArrayBuffer(payload.iv);
        const encryptedData = base64ToArrayBuffer(payload.cipherText);
        const decryptedBuffer = await crypto.subtle.decrypt(
          { name: ALGO_NAME, iv },
          key,
          encryptedData
        );
        const decodedString = new TextDecoder().decode(decryptedBuffer);
        return { id: payload.id, data: JSON.parse(decodedString) };
      } catch (e: any) {
        return { id: payload.id, error: e.message || 'Decryption failed' };
      }
    })
  );
  return results;
}

self.onmessage = async (e: MessageEvent) => {
  const { type, id, jwk, data, payload, payloads } = e.data;

  try {
    switch (type) {
      case 'encrypt': {
        const result = await encryptData(jwk, data);
        self.postMessage({ id, result });
        break;
      }
      case 'decrypt': {
        const result = await decryptData(jwk, payload);
        self.postMessage({ id, result });
        break;
      }
      case 'decryptBatch': {
        const result = await decryptBatch(jwk, payloads);
        self.postMessage({ id, result });
        break;
      }
      case 'clearKey': {
        cachedKey = null;
        self.postMessage({ id, result: true });
        break;
      }
      default:
        self.postMessage({ id, error: `Unknown message type: ${type}` });
    }
  } catch (err: any) {
    self.postMessage({ id, error: err.message || 'Worker error' });
  }
};
