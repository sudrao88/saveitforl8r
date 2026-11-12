import { describe, it, expect } from 'vitest';
import { parseMomentTerms, isMomentEmbedded, MAX_MOMENT_TERMS } from './momentMatching';
import { Moment, EMBEDDING_MODEL_ID } from '../types';

describe('parseMomentTerms', () => {
  it('splits on commas and new lines and trims whitespace', () => {
    expect(parseMomentTerms(' Singapore , hawker  food\nMarina Bay ')).toEqual([
      'Singapore', 'hawker food', 'Marina Bay',
    ]);
  });

  it('drops empty and duplicate (case-insensitive) terms', () => {
    expect(parseMomentTerms('Tokyo,, tokyo ,Kyoto,')).toEqual(['Tokyo', 'Kyoto']);
  });

  it(`caps the number of terms at ${MAX_MOMENT_TERMS}`, () => {
    const many = Array.from({ length: 15 }, (_, i) => `t${i}`).join(',');
    expect(parseMomentTerms(many)).toHaveLength(MAX_MOMENT_TERMS);
  });
});

describe('isMomentEmbedded', () => {
  const base: Moment = { id: 'm', title: 't', terms: ['a', 'b'], createdAt: 0, updatedAt: 0 };

  it('needs one vector per term from the current model', () => {
    expect(isMomentEmbedded(base)).toBe(false);
    expect(isMomentEmbedded({ ...base, termVectors: [[1]], embeddingModel: EMBEDDING_MODEL_ID })).toBe(false);
    expect(isMomentEmbedded({ ...base, termVectors: [[1], [1]], embeddingModel: 'old-model' })).toBe(false);
    expect(isMomentEmbedded({ ...base, termVectors: [[1], [1]], embeddingModel: EMBEDDING_MODEL_ID })).toBe(true);
  });
});
