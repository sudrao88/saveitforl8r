import { describe, it, expect } from 'vitest';
import {
  dot,
  normalize,
  meanVector,
  topKRelated,
  insertIfBetter,
  resolveRelatedConflict,
  K_STORE,
  MIN_SIMILARITY,
} from './relatedMemories';
import { RelatedMemoriesRecord } from '../types';

const record = (overrides: Partial<RelatedMemoriesRecord>): RelatedMemoriesRecord => ({
  memoryId: 'm1',
  related: [{ id: 'x', score: 0.9 }],
  modelId: 'bge-small-en-v1.5',
  computedAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

describe('vector math', () => {
  it('computes dot product', () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it('normalizes to unit length', () => {
    const n = normalize([3, 4]);
    expect(n[0]).toBeCloseTo(0.6);
    expect(n[1]).toBeCloseTo(0.8);
    expect(Math.sqrt(dot(n, n))).toBeCloseTo(1);
  });

  it('returns zero vector unchanged from normalize', () => {
    expect(normalize([0, 0])).toEqual([0, 0]);
  });

  it('meanVector averages chunks and renormalizes', () => {
    const mean = meanVector([[1, 0], [0, 1]]);
    expect(mean[0]).toBeCloseTo(Math.SQRT1_2);
    expect(mean[1]).toBeCloseTo(Math.SQRT1_2);
  });

  it('meanVector of empty input is empty', () => {
    expect(meanVector([])).toEqual([]);
  });
});

describe('topKRelated', () => {
  const vectors = [
    { id: 'a', vector: [1, 0] },
    { id: 'b', vector: [0.9, Math.sqrt(1 - 0.81)] },   // sim to a: 0.9
    { id: 'c', vector: [0.6, 0.8] },                    // sim to a: 0.6
    { id: 'd', vector: [0, 1] },                        // sim to a: 0 — below cutoff
  ];

  it('orders by similarity, excludes self and below-threshold entries', () => {
    const result = topKRelated('a', [1, 0], vectors);
    expect(result.map(e => e.id)).toEqual(['b', 'c']);
    expect(result[0].score).toBeCloseTo(0.9);
    expect(result.every(e => e.id !== 'a')).toBe(true);
    expect(result.every(e => e.score >= MIN_SIMILARITY)).toBe(true);
  });

  it('caps at k entries', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, vector: [1, 0] }));
    const result = topKRelated('a', [1, 0], many);
    expect(result.length).toBe(K_STORE);
  });

  it('skips vectors with mismatched dimensions', () => {
    const result = topKRelated('a', [1, 0], [{ id: 'weird', vector: [1, 0, 0] }]);
    expect(result).toEqual([]);
  });
});

describe('insertIfBetter', () => {
  it('inserts a qualifying entry in order', () => {
    const { list, changed } = insertIfBetter(
      [{ id: 'a', score: 0.9 }, { id: 'c', score: 0.6 }],
      { id: 'b', score: 0.8 },
    );
    expect(changed).toBe(true);
    expect(list.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('rejects entries below the similarity floor', () => {
    const original = [{ id: 'a', score: 0.9 }];
    const { list, changed } = insertIfBetter(original, { id: 'b', score: 0.2 });
    expect(changed).toBe(false);
    expect(list).toBe(original);
  });

  it('evicts the worst entry when the list is full', () => {
    const full = Array.from({ length: K_STORE }, (_, i) => ({ id: `n${i}`, score: 0.9 - i * 0.01 }));
    const { list, changed } = insertIfBetter(full, { id: 'new', score: 0.95 });
    expect(changed).toBe(true);
    expect(list.length).toBe(K_STORE);
    expect(list[0].id).toBe('new');
    expect(list.find(e => e.id === `n${K_STORE - 1}`)).toBeUndefined();
  });

  it('is a no-op when the candidate is worse than a full list', () => {
    const full = Array.from({ length: K_STORE }, (_, i) => ({ id: `n${i}`, score: 0.9 - i * 0.01 }));
    const { changed } = insertIfBetter(full, { id: 'new', score: 0.5 });
    expect(changed).toBe(false);
  });

  it('updates the score of an existing entry', () => {
    const { list, changed } = insertIfBetter(
      [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.7 }],
      { id: 'b', score: 0.95 },
    );
    expect(changed).toBe(true);
    expect(list.map(e => e.id)).toEqual(['b', 'a']);
  });
});

describe('resolveRelatedConflict', () => {
  it('takes remote when there is no local record', () => {
    expect(resolveRelatedConflict(null, record({}))).toBe('takeRemote');
    expect(resolveRelatedConflict(undefined, record({}))).toBe('takeRemote');
  });

  it('remote tombstone always wins over a live local record', () => {
    const local = record({ modelId: 'embeddinggemma-300m', updatedAt: 9999 });
    const remote = record({ isDeleted: true, modelId: 'bge-small-en-v1.5', updatedAt: 1 });
    expect(resolveRelatedConflict(local, remote)).toBe('takeRemote');
  });

  it('local tombstone wins over a live remote record', () => {
    const local = record({ isDeleted: true, updatedAt: 1 });
    const remote = record({ modelId: 'embeddinggemma-300m', updatedAt: 9999 });
    expect(resolveRelatedConflict(local, remote)).toBe('keepLocal');
  });

  it('higher-priority model wins regardless of updatedAt', () => {
    const gemmaOld = record({ modelId: 'embeddinggemma-300m', updatedAt: 1 });
    const bgeNew = record({ modelId: 'bge-small-en-v1.5', updatedAt: 9999 });
    expect(resolveRelatedConflict(gemmaOld, bgeNew)).toBe('keepLocal');
    expect(resolveRelatedConflict(bgeNew, gemmaOld)).toBe('takeRemote');
  });

  it('same model: newer updatedAt wins, ties keep local', () => {
    const older = record({ updatedAt: 100 });
    const newer = record({ updatedAt: 200 });
    expect(resolveRelatedConflict(older, newer)).toBe('takeRemote');
    expect(resolveRelatedConflict(newer, older)).toBe('keepLocal');
    expect(resolveRelatedConflict(older, record({ updatedAt: 100 }))).toBe('keepLocal');
  });

  it('unknown model ids lose to known models', () => {
    const unknown = record({ modelId: 'mystery-model-9000', updatedAt: 9999 });
    const known = record({ modelId: 'bge-small-en-v1.5', updatedAt: 1 });
    expect(resolveRelatedConflict(unknown, known)).toBe('takeRemote');
    expect(resolveRelatedConflict(known, unknown)).toBe('keepLocal');
  });
});
