import { describe, it, expect } from 'vitest';
import { tokenize, stem, buildKeywordIndex, prepareConcepts, scoreConcepts } from './keywordMatching';
import { Memory } from '../types';

const note = (id: string, fields: { title?: string; tags?: string[]; summary?: string; content?: string }): Memory => ({
  id, content: fields.content || '', timestamp: 0, tags: [],
  enrichment: {
    summary: fields.summary || '',
    suggestedTags: fields.tags || [],
    ...(fields.title ? { entityContext: { type: 'Other', title: fields.title } } : {}),
  } as Memory['enrichment'],
});

describe('tokenize', () => {
  it('splits hashtags and camelCase, strips accents, lowercases and stems plurals', () => {
    expect(tokenize('#BangaloreEats at a Café')).toEqual(['bangalore', 'eat', 'at', 'a', 'cafe']);
    expect(tokenize('Cafes, bakeries & dresses')).toEqual(['cafe', 'bakery', 'dress']);
  });

  it('leaves short words and -ss / -us / -is endings alone', () => {
    expect(['bus', 'glass', 'status', 'analysis', 'yes'].map(stem)).toEqual(['bus', 'glass', 'status', 'analysis', 'yes']);
  });
});

describe('scoreConcepts', () => {
  const index = buildKeywordIndex([
    note('title-hit', { title: 'Blue Tokai Coffee', summary: 'Roastery in Bengaluru' }),
    note('body-hit', { content: 'Met a friend for coffee after work in Bangalore, then went home.' }),
    note('phrase', { tags: ['#CoffeeShop'], summary: 'In Koramangala' }),
    note('one-concept', { title: 'Coffee brewing guide' }),
    note('none', { title: 'Vibram Shoes' }),
  ]);
  const concepts = prepareConcepts([
    ['coffee', 'coffee shop', 'cafe'],
    ['bangalore', 'bengaluru', 'koramangala'],
  ]);
  const results = new Map(scoreConcepts(index, concepts).map(r => [r.id, r]));

  it('reports which concepts each note hits, and skips notes that hit none', () => {
    expect(results.get('title-hit')!.hits.every(Boolean)).toBe(true);
    expect(results.get('one-concept')!.hits.map(h => !!h)).toEqual([true, false]);
    expect(results.has('none')).toBe(false);
  });

  it('matches multi-word synonyms as phrases, including inside hashtags', () => {
    expect(results.get('phrase')!.hits[0]!.synonym).toBe('coffee shop');
  });

  it('scores a hit in the title above one buried in a long body', () => {
    expect(results.get('title-hit')!.score).toBeGreaterThan(results.get('body-hit')!.score);
  });

  it('does not match a phrase across two separate tags', () => {
    const idx = buildKeywordIndex([note('split', { tags: ['#Specialty Coffee', '#Shop Local'] })]);
    const [r] = scoreConcepts(idx, prepareConcepts([['coffee shop']]));
    expect(r).toBeUndefined();
  });

  it('reuses the prepared form of an unchanged note', () => {
    const n = note('same', { title: 'Coffee' });
    expect(buildKeywordIndex([n]).docs[0]).toBe(buildKeywordIndex([n]).docs[0]);
  });

  it('drops empty and duplicate synonyms when preparing concepts', () => {
    expect(prepareConcepts([['Cafe', 'cafes', '  '], []])).toEqual([
      { label: 'Cafe', synonyms: [{ text: 'Cafe', tokens: ['cafe'] }] },
    ]);
  });
});
