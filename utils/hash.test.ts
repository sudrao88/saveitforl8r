import { describe, it, expect } from 'vitest';
import { sha256Hash, fastHash, computeInputHash } from './hash';
import { Memory } from '../types';

const makeMemory = (overrides: Partial<Memory> = {}): Memory => ({
  id: 'm1',
  timestamp: 1700000000000,
  content: '',
  tags: [],
  ...overrides,
});

describe('sha256Hash', () => {
  it('returns the SHA-256 hex digest of empty string', async () => {
    expect(await sha256Hash('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('returns the canonical SHA-256 hex digest for "abc"', async () => {
    expect(await sha256Hash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is deterministic', async () => {
    const a = await sha256Hash('some input');
    const b = await sha256Hash('some input');
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs', async () => {
    const a = await sha256Hash('input-1');
    const b = await sha256Hash('input-2');
    expect(a).not.toBe(b);
  });

  it('returns a 64-character hex string', async () => {
    const h = await sha256Hash('hello world');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('fastHash', () => {
  it('is deterministic for the same input', () => {
    expect(fastHash('abc')).toBe(fastHash('abc'));
  });

  it('produces the mh_ prefix', () => {
    expect(fastHash('anything')).toMatch(/^mh_[0-9a-f]+$/);
  });

  it('distinguishes different inputs', () => {
    expect(fastHash('a')).not.toBe(fastHash('b'));
  });

  it('handles empty string without throwing', () => {
    expect(fastHash('')).toMatch(/^mh_[0-9a-f]+$/);
  });

  it('distinguishes inputs that differ only by permutation', () => {
    // djb2 is order-sensitive
    expect(fastHash('ab')).not.toBe(fastHash('ba'));
  });
});

describe('computeInputHash', () => {
  it('is order-independent in the input note IDs', () => {
    const memories = [
      makeMemory({ id: 'a', timestamp: 1 }),
      makeMemory({ id: 'b', timestamp: 2 }),
    ];
    const h1 = computeInputHash(['a', 'b'], memories);
    const h2 = computeInputHash(['b', 'a'], memories);
    expect(h1).toBe(h2);
  });

  it('changes when a memory timestamp changes', () => {
    const before = computeInputHash(['a'], [makeMemory({ id: 'a', timestamp: 1 })]);
    const after = computeInputHash(['a'], [makeMemory({ id: 'a', timestamp: 2 })]);
    expect(before).not.toBe(after);
  });

  it('changes when notes are added or removed', () => {
    const memories = [
      makeMemory({ id: 'a', timestamp: 1 }),
      makeMemory({ id: 'b', timestamp: 2 }),
    ];
    const single = computeInputHash(['a'], memories);
    const both = computeInputHash(['a', 'b'], memories);
    expect(single).not.toBe(both);
  });

  it('handles missing memory references by falling back to the ID', () => {
    // Shouldn't throw or return an invalid hash when a note ID has no matching memory
    const hash = computeInputHash(['missing'], []);
    expect(hash).toMatch(/^mh_[0-9a-f]+$/);
  });

  it('returns a stable hash across calls with identical data', () => {
    const memories = [makeMemory({ id: 'a', timestamp: 1 })];
    expect(computeInputHash(['a'], memories)).toBe(
      computeInputHash(['a'], memories),
    );
  });

  it('does not mutate the input noteIds array', () => {
    const ids = ['b', 'a'];
    computeInputHash(ids, [makeMemory({ id: 'a' }), makeMemory({ id: 'b' })]);
    expect(ids).toEqual(['b', 'a']);
  });

  it('handles an empty noteIds array', () => {
    expect(computeInputHash([], [])).toMatch(/^mh_[0-9a-f]+$/);
  });

  it('ignores memories not referenced by any id', () => {
    const referenced = computeInputHash(
      ['a'],
      [makeMemory({ id: 'a', timestamp: 1 })],
    );
    const withExtra = computeInputHash(
      ['a'],
      [
        makeMemory({ id: 'a', timestamp: 1 }),
        makeMemory({ id: 'unrelated', timestamp: 99 }),
      ],
    );
    expect(referenced).toBe(withExtra);
  });

  it('treats a missing memory the same as an empty reference', () => {
    // When a noteId has no matching memory, the hash uses just the id.
    // Two different missing ids should therefore produce different hashes.
    expect(computeInputHash(['x'], [])).not.toBe(computeInputHash(['y'], []));
  });
});
