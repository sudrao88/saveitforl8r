import { Memory } from '../types';

/** Async SHA-256 hash via Web Crypto API. Returns a hex string. */
export async function sha256Hash(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Synchronous fast hash for cache invalidation (djb2). */
export function fastHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) & 0xffffffff;
  }
  return 'mh_' + (hash >>> 0).toString(16);
}

/** Compute a cache-invalidation hash from a set of note IDs and their timestamps. */
export function computeInputHash(noteIds: string[], memories: Memory[]): string {
  const inputs = noteIds
    .slice()
    .sort()
    .map(id => {
      const m = memories.find(n => n.id === id);
      return m ? `${id}:${m.timestamp}` : id;
    })
    .join('|');
  return fastHash(inputs);
}
