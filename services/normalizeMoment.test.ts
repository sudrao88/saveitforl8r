import { describe, it, expect } from 'vitest';
import { normalizeMoment, normalizeMemory } from './storageService';
import { Memory, Moment } from '../types';

describe('normalizeMoment', () => {
  it('turns a legacy agentic moment into a single-term moment waiting to be embedded', () => {
    const legacy = {
      id: 'm1',
      objective: 'Build an itinerary for my Singapore trip',
      refinedObjective: 'A detailed itinerary…',
      title: 'Singapore Trip',
      type: 'itinerary',
      emoji: '🇸🇬',
      noteIds: ['n1', 'n2'],
      inputHash: 'mh_1',
      lastSeenInputHash: 'mh_1',
      needsAgenticRebuild: false,
      createdAt: 1,
      updatedAt: 2,
    } as unknown as Moment;

    const m = normalizeMoment(legacy) as Moment & Record<string, unknown>;

    expect(m.terms).toEqual(['Build an itinerary for my Singapore trip']);
    expect(m.title).toBe('Singapore Trip');
    expect(m.emoji).toBe('🇸🇬');
    expect(m.termVectors).toBeUndefined();
    for (const f of ['objective', 'refinedObjective', 'type', 'noteIds', 'inputHash', 'lastSeenInputHash', 'needsAgenticRebuild']) {
      expect(m).not.toHaveProperty(f);
    }
  });

  it('keeps a current-format moment unchanged', () => {
    const current: Moment = {
      id: 'm2', title: 'Tokyo, ramen', terms: ['Tokyo', 'ramen'],
      termVectors: [[1, 0], [0, 1]], intentVector: [0.6, 0.8], embeddingModel: 'gemini-embedding-2',
      excludedNoteIds: ['n1'], createdAt: 1, updatedAt: 2,
    };
    expect(normalizeMoment(current)).toEqual(current);
  });

  it('drops vectors that do not line up with the terms', () => {
    const broken: Moment = {
      id: 'm3', title: 'a, b', terms: ['a', 'b'], termVectors: [[1, 0]],
      embeddingModel: 'gemini-embedding-2', createdAt: 1, updatedAt: 2,
    };
    const m = normalizeMoment({ ...broken, intentVector: [1, 0] });
    expect(m.termVectors).toBeUndefined();
    expect(m.intentVector).toBeUndefined();
    expect(m.embeddingModel).toBeUndefined();
  });

  it('drops a malformed intent vector but keeps valid term vectors', () => {
    const m = normalizeMoment({
      id: 'm4', title: 'a', terms: ['a'], termVectors: [[1, 0]],
      intentVector: ['x'] as unknown as number[],
      embeddingModel: 'gemini-embedding-2', createdAt: 1, updatedAt: 2,
    });
    expect(m.intentVector).toBeUndefined();
    expect(m.termVectors).toEqual([[1, 0]]);
  });
});

describe('normalizeMemory (legacy moments fields)', () => {
  it('strips webAdditions and matchedMomentIds from the enrichment', () => {
    const memory = {
      id: 'n1', content: 'x', timestamp: 1, tags: [],
      enrichment: {
        summary: 's', suggestedTags: [],
        webAdditions: [{ text: 't', sourceUrl: 'https://e.com', addedByMomentId: 'm', addedAt: 1 }],
        matchedMomentIds: ['m'],
      },
    } as unknown as Memory;

    const out = normalizeMemory(memory);
    expect(out.enrichment).toEqual({ summary: 's', suggestedTags: [] });
  });
});
