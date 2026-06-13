import { describe, it, expect } from 'vitest';
import {
  dot,
  topKRelated,
  insertIfBetter,
  RelatedMatcher,
  K_STORE,
  MIN_SIMILARITY,
  MemoryVector,
} from './relatedMemories';

// Build a 2-D unit vector at the given angle (degrees) for easy cosine control.
const unit = (deg: number): number[] => {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
};

describe('dot', () => {
  it('computes cosine for unit vectors', () => {
    expect(dot([1, 0], [1, 0])).toBeCloseTo(1);
    expect(dot([1, 0], [0, 1])).toBeCloseTo(0);
    expect(dot(unit(0), unit(60))).toBeCloseTo(0.5);
  });

  it('returns 0 for mismatched dimensions', () => {
    expect(dot([1, 0], [1, 0, 0])).toBe(0);
  });
});

describe('topKRelated', () => {
  const vectors: MemoryVector[] = [
    { id: 'a', vector: unit(0) },
    { id: 'b', vector: unit(20) },   // sim to a ≈ 0.94
    { id: 'c', vector: unit(40) },   // sim to a ≈ 0.77
    { id: 'd', vector: unit(85) },   // sim to a ≈ 0.087 — below threshold
  ];

  it('orders by similarity, excludes self and below-threshold entries', () => {
    const result = topKRelated('a', unit(0), vectors);
    expect(result.map(e => e.id)).toEqual(['b', 'c']);
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('caps at k entries', () => {
    const many: MemoryVector[] = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, vector: unit(1) }));
    expect(topKRelated('a', unit(0), many).length).toBe(K_STORE);
  });

  it('skips mismatched dimensions', () => {
    expect(topKRelated('a', unit(0), [{ id: 'x', vector: [1, 0, 0] }])).toEqual([]);
  });

  it('breaks score ties deterministically by id', () => {
    const tied: MemoryVector[] = [
      { id: 'z', vector: unit(10) },
      { id: 'a', vector: unit(10) },
    ];
    expect(topKRelated('t', unit(0), tied).map(e => e.id)).toEqual(['a', 'z']);
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
    const { list, changed } = insertIfBetter(original, { id: 'b', score: MIN_SIMILARITY - 0.1 });
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
    // minScore 0 so this exercises the "worse than the full list" path, not the
    // similarity floor (decoupled from MIN_SIMILARITY's tuned value).
    const { changed } = insertIfBetter(full, { id: 'new', score: 0.5 }, K_STORE, 0);
    expect(changed).toBe(false);
  });

  it('evicts an equal-scored worst entry when the candidate wins the id tiebreak', () => {
    // Full list whose worst entry ties the candidate's score. The candidate's
    // id sorts before the worst entry's id, so it must replace it (matching
    // topKRelated's score-then-id ordering).
    const full = [
      { id: 'a', score: 0.9 },
      { id: 'm', score: 0.5 },
      { id: 'z', score: 0.5 },
    ];
    const { list, changed } = insertIfBetter(full, { id: 'b', score: 0.5 }, 3, 0);
    expect(changed).toBe(true);
    expect(list.map(e => e.id)).toEqual(['a', 'b', 'm']);
  });

  it('rejects an equal-scored candidate that loses the id tiebreak', () => {
    const full = [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.5 },
      { id: 'm', score: 0.5 },
    ];
    const { changed } = insertIfBetter(full, { id: 'z', score: 0.5 }, 3, 0);
    expect(changed).toBe(false);
  });
});

describe('RelatedMatcher determinism on exact ties', () => {
  it('matches bulk and incremental output when duplicate embeddings tie', () => {
    // Several notes share the same embedding (exact-tie scores), exceeding
    // K_STORE so the id tiebreak decides who makes each list.
    const same = [1, 0];
    const vecs = Array.from({ length: K_STORE + 4 }, (_, i) => ({
      id: `dup-${String(i).padStart(2, '0')}`,
      vector: same,
    }));

    const bulk = new RelatedMatcher();
    bulk.update(vecs, []);

    const incremental = new RelatedMatcher();
    for (const v of vecs) incremental.update([v], []);

    expect(incremental.getMap()).toEqual(bulk.getMap());
  });
});

describe('RelatedMatcher', () => {
  it('builds symmetric related lists from a bulk add', () => {
    const m = new RelatedMatcher();
    m.update([
      { id: 'a', vector: unit(0) },
      { id: 'b', vector: unit(10) },
      { id: 'c', vector: unit(80) },
    ], []);
    const map = m.getMap();
    // a and b are close; c is far from both
    expect(map['a']).toContain('b');
    expect(map['b']).toContain('a');
    expect(map['a'] || []).not.toContain('c');
  });

  it('incrementally adds a note into existing lists', () => {
    const m = new RelatedMatcher();
    m.update([{ id: 'a', vector: unit(0) }, { id: 'b', vector: unit(80) }], []);
    expect(m.getMap()['a'] || []).not.toContain('b');
    // Add a note close to a — should appear in a's list and vice versa.
    m.update([{ id: 'c', vector: unit(5) }], []);
    const map = m.getMap();
    expect(map['a']).toContain('c');
    expect(map['c']).toContain('a');
  });

  it('removes a note from all lists when deleted', () => {
    const m = new RelatedMatcher();
    m.update([{ id: 'a', vector: unit(0) }, { id: 'b', vector: unit(10) }], []);
    expect(m.getMap()['a']).toContain('b');
    m.update([], ['b']);
    const map = m.getMap();
    expect(map['b']).toBeUndefined();
    expect(map['a'] || []).not.toContain('b');
  });

  it('recomputes a list when a note vector changes', () => {
    const m = new RelatedMatcher();
    m.update([
      { id: 'a', vector: unit(0) },
      { id: 'b', vector: unit(10) },
      { id: 'c', vector: unit(80) },
    ], []);
    expect(m.getMap()['a']).toContain('b');
    // b moves far away from a, toward c.
    m.update([{ id: 'b', vector: unit(82) }], []);
    const map = m.getMap();
    expect(map['a'] || []).not.toContain('b');
    expect(map['c']).toContain('b');
  });

  it('produces identical output regardless of insertion order (determinism)', () => {
    const vecs: MemoryVector[] = [
      { id: 'a', vector: unit(0) },
      { id: 'b', vector: unit(15) },
      { id: 'c', vector: unit(30) },
      { id: 'd', vector: unit(45) },
    ];
    const bulk = new RelatedMatcher();
    bulk.update(vecs, []);

    const incremental = new RelatedMatcher();
    for (const v of vecs) incremental.update([v], []);

    expect(incremental.getMap()).toEqual(bulk.getMap());
  });
});
