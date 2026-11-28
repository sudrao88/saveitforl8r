import { describe, it, expect } from 'vitest';
import { Memory, EMBEDDING_MODEL_ID } from '../types';
import { excerptAround, queryTerms, searchNotes, SEARCH_MIN_SIMILARITY } from './noteSearch';

const unit = (v: number[]): number[] => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map(x => x / n);
};

const note = (
  id: string,
  fields: { title?: string; tags?: string[]; summary?: string; content?: string; vector?: number[]; deleted?: boolean },
): Memory => ({
  id,
  content: fields.content || '',
  timestamp: 0,
  tags: [],
  isDeleted: fields.deleted,
  enrichment: {
    summary: fields.summary || '',
    suggestedTags: fields.tags || [],
    ...(fields.title ? { entityContext: { type: 'Other', title: fields.title } } : {}),
    ...(fields.vector ? { embedding: unit(fields.vector), embeddingModel: EMBEDDING_MODEL_ID } : {}),
  } as Memory['enrichment'],
});

describe('queryTerms', () => {
  it('drops stop words and duplicates, stems plurals', () => {
    expect(queryTerms('the best Cafes in the city cafes')).toEqual(['best', 'cafe', 'city']);
  });

  it('keeps stop words when the query has nothing else', () => {
    expect(queryTerms('the')).toEqual(['the']);
  });
});

describe('searchNotes — keyword', () => {
  const notes = [
    note('title', { title: 'Blue Tokai Coffee', summary: 'Roastery in Bengaluru' }),
    note('body', { content: 'Met a friend for coffee after work, then went home and cooked dinner for everyone.' }),
    note('both', { title: 'Coffee in Bangalore', content: 'Third Wave Coffee, Indiranagar' }),
    note('none', { title: 'Vibram shoes' }),
    note('gone', { title: 'Coffee grinder', deleted: true }),
  ];

  it('returns notes containing the term, title hits above body hits', () => {
    const ids = searchNotes(notes, 'coffee').map(r => r.id);
    expect(ids).not.toContain('none');
    expect(ids.indexOf('title')).toBeLessThan(ids.indexOf('body'));
  });

  it('skips deleted notes', () => {
    expect(searchNotes(notes, 'grinder')).toEqual([]);
  });

  it('ranks notes matching every term first', () => {
    const results = searchNotes(notes, 'coffee bangalore');
    expect(results[0].id).toBe('both');
    expect(results[0].keywordCoverage).toBe(1);
  });

  it('matches a word that is still being typed', () => {
    expect(searchNotes(notes, 'coff').map(r => r.id)).toContain('title');
    expect(searchNotes(notes, 'vibr').map(r => r.id)).toEqual(['none']);
  });

  it('returns nothing for an empty query', () => {
    expect(searchNotes(notes, '   ')).toEqual([]);
  });
});

describe('searchNotes — semantic', () => {
  const notes = [
    note('espresso', { title: 'Espresso bar', vector: [1, 0.1, 0] }),
    note('latte', { title: 'Latte art class', vector: [0.9, 0.3, 0] }),
    note('shoes', { title: 'Running shoes', vector: [0, 0, 1] }),
    note('no-vector', { title: 'Coffee beans' }),
  ];
  const coffeeQuery = unit([1, 0.2, 0]);

  it('finds notes by meaning even without a shared word', () => {
    const ids = searchNotes(notes, 'caffeine', coffeeQuery).map(r => r.id);
    expect(ids).toEqual(expect.arrayContaining(['espresso', 'latte']));
    expect(ids).not.toContain('shoes');
  });

  it('merges keyword and semantic hits', () => {
    const ids = searchNotes(notes, 'coffee', coffeeQuery).map(r => r.id);
    expect(ids).toEqual(expect.arrayContaining(['espresso', 'latte', 'no-vector']));
  });

  it('ranks a note matching both ways above one matching only by meaning', () => {
    const results = searchNotes(notes, 'espresso', coffeeQuery);
    expect(results[0].id).toBe('espresso');
    expect(results[0].similarity).toBeGreaterThan(SEARCH_MIN_SIMILARITY);
  });

  it('ignores vectors from another embedding model', () => {
    const stale = note('stale', { title: 'Cold brew', vector: [1, 0.2, 0] });
    stale.enrichment!.embeddingModel = 'old-model';
    expect(searchNotes([stale], 'caffeine', coffeeQuery)).toEqual([]);
  });
});

describe('excerptAround', () => {
  it('centres the excerpt on the first matching word', () => {
    const long = `${'filler words here. '.repeat(30)}The secret ingredient is cardamom. ${'more filler. '.repeat(30)}`;
    const excerpt = excerptAround(long, ['cardamom'], 80);
    expect(excerpt).toContain('cardamom');
    expect(excerpt.startsWith('…')).toBe(true);
  });

  it('returns short text unchanged and strips HTML', () => {
    expect(excerptAround('<p>Hello <b>world</b></p>', ['world'])).toBe('Hello world');
  });
});
