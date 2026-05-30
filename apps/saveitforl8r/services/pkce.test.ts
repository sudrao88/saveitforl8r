import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge } from './pkce';

describe('generateCodeVerifier', () => {
  it('produces a base64url-safe string (no +, /, = padding)', () => {
    const v = generateCodeVerifier();
    expect(v).not.toMatch(/[+/=]/);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('encodes 32 random bytes to ~43 characters', () => {
    const v = generateCodeVerifier();
    // 32 bytes → 43 base64 chars with no padding
    expect(v.length).toBe(43);
  });

  it('produces different values on successive calls', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });

  it('uses the Web Crypto RNG', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    generateCodeVerifier();
    expect(spy).toHaveBeenCalledTimes(1);
    // The passed buffer should be 32 bytes
    const buf = spy.mock.calls[0][0] as Uint8Array;
    expect(buf.length).toBe(32);
    spy.mockRestore();
  });
});

describe('generateCodeChallenge', () => {
  const originalGetRandomValues = crypto.getRandomValues.bind(crypto);

  beforeEach(() => {
    // Deterministic verifier bytes for reproducible challenge.
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(
      <T extends ArrayBufferView | null>(buf: T): T => {
        if (buf && 'length' in buf) {
          const arr = buf as unknown as Uint8Array;
          for (let i = 0; i < arr.length; i++) arr[i] = i;
        }
        return buf;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Re-seat the original in case restoration is incomplete
    (crypto as unknown as { getRandomValues: typeof originalGetRandomValues })
      .getRandomValues = originalGetRandomValues;
  });

  it('returns a base64url string', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    expect(challenge).not.toMatch(/[+/=]/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is deterministic for a fixed verifier', async () => {
    const verifier = 'test-verifier-value';
    const a = await generateCodeChallenge(verifier);
    const b = await generateCodeChallenge(verifier);
    expect(a).toBe(b);
  });

  it('produces 43-char SHA-256 base64url digests (32 bytes without padding)', async () => {
    const challenge = await generateCodeChallenge('any verifier value');
    expect(challenge.length).toBe(43);
  });

  it('differs when the verifier changes', async () => {
    const a = await generateCodeChallenge('verifier-A');
    const b = await generateCodeChallenge('verifier-B');
    expect(a).not.toBe(b);
  });
});
