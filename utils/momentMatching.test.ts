import { describe, it, expect } from 'vitest';
import {
  parseMomentTerms,
  isMomentEmbedded,
  needsMomentEmbedding,
  matchNotesToMoment,
  scoreNoteForMoment,
  explainMomentMatch,
  MAX_MOMENT_TERMS,
  INTENT_WEIGHT,
  TERM_WEIGHT,
  MOMENT_MIN_SIMILARITY,
  MOMENT_RELATIVE_MARGIN,
} from './momentMatching';
import { Memory, Moment, EMBEDDING_MODEL_ID } from '../types';

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

describe('needsMomentEmbedding', () => {
  const base: Moment = {
    id: 'm', title: 't', terms: ['a'], createdAt: 0, updatedAt: 0,
    termVectors: [[1, 0]], embeddingModel: EMBEDDING_MODEL_ID,
  };

  it('is true without vectors, or with term vectors but no intent vector', () => {
    expect(needsMomentEmbedding({ ...base, termVectors: undefined })).toBe(true);
    expect(needsMomentEmbedding(base)).toBe(true);
    expect(needsMomentEmbedding({ ...base, intentVector: [] })).toBe(true);
  });

  it('is false once both term and intent vectors are present', () => {
    expect(needsMomentEmbedding({ ...base, intentVector: [1, 0] })).toBe(false);
  });
});

// Unit vector at a given angle (degrees) in the x/y plane, so dot = cos(angle).
const at = (deg: number): number[] => {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
};

const note = (id: string, v: number[]): Memory => ({
  id, content: id, timestamp: 0, tags: [],
  enrichment: { summary: '', suggestedTags: [], embedding: v, embeddingModel: EMBEDDING_MODEL_ID } as Memory['enrichment'],
});

const moment = (overrides: Partial<Moment> = {}): Moment => ({
  id: 'm', title: 't', terms: ['a', 'b'], createdAt: 0, updatedAt: 0,
  termVectors: [at(0), at(90)], intentVector: at(0), embeddingModel: EMBEDDING_MODEL_ID,
  ...overrides,
});

describe('scoreNoteForMoment', () => {
  it('blends intent similarity with the best term similarity', () => {
    const s = scoreNoteForMoment(moment(), at(60))!;
    expect(s.intent).toBeCloseTo(0.5);
    expect(s.term).toBeCloseTo(Math.cos((30 * Math.PI) / 180)); // closest term is at 90°
    expect(s.score).toBeCloseTo(INTENT_WEIGHT * 0.5 + TERM_WEIGHT * s.term);
  });

  it('uses the best term alone for a moment without an intent vector', () => {
    const s = scoreNoteForMoment(moment({ intentVector: undefined }), at(80))!;
    expect(s.intent).toBeNull();
    expect(s.score).toBeCloseTo(Math.cos((10 * Math.PI) / 180));
  });

  it('returns null when no vector has a comparable dimension', () => {
    expect(scoreNoteForMoment(moment(), [1, 0, 0])).toBeNull();
  });

  it('returns null when only the intent vector has a different dimension', () => {
    expect(scoreNoteForMoment(moment({ intentVector: [1, 0, 0] }), at(0))).toBeNull();
  });
});

describe('matchNotesToMoment', () => {
  it('drops a note that matches one term perfectly but not the overall intent', () => {
    const ids = matchNotesToMoment(moment(), [note('on-intent', at(0)), note('term-b-only', at(90))]).map(m => m.id);
    expect(ids).toEqual(['on-intent']);
  });

  it('keeps only notes within the relative margin of the best match', () => {
    const ids = matchNotesToMoment(
      moment({ terms: ['a'], termVectors: [at(0)] }),
      [note('best', at(0)), note('near', at(20)), note('far', at(45))],
    ).map(m => m.id);
    // best = 1.0; near ≈ 0.94 (inside 0.15); far ≈ 0.71 (outside the margin).
    expect(MOMENT_RELATIVE_MARGIN).toBe(0.15);
    expect(ids).toEqual(['best', 'near']);
  });

  it('applies the absolute floor even to the best match', () => {
    const angle = (Math.acos(MOMENT_MIN_SIMILARITY) * 180) / Math.PI + 5;
    expect(matchNotesToMoment(moment({ terms: ['a'], termVectors: [at(0)] }), [note('weak', at(angle))])).toEqual([]);
  });

  it('skips hidden notes and notes from another embedding model', () => {
    const stale = note('stale', at(0));
    stale.enrichment!.embeddingModel = 'old-model';
    const ids = matchNotesToMoment(
      moment({ excludedNoteIds: ['hidden'] }),
      [note('hidden', at(0)), stale, note('ok', at(0))],
    ).map(m => m.id);
    expect(ids).toEqual(['ok']);
  });

  it('falls back to any-term matching for a moment without an intent vector', () => {
    const ids = matchNotesToMoment(moment({ intentVector: undefined }), [note('x', at(0)), note('y', at(90))])
      .map(m => m.id)
      .sort();
    expect(ids).toEqual(['x', 'y']);
  });
});

describe('explainMomentMatch', () => {
  it('scores every note and labels shown, hidden and below-cutoff, best first', () => {
    const report = explainMomentMatch(
      moment({ terms: ['a'], termVectors: [at(0)], excludedNoteIds: ['hidden'] }),
      [note('best', at(0)), note('hidden', at(5)), note('near', at(20)), note('far', at(45)), note('opposite', at(180))],
    );
    expect(report.mode).toBe('intent');
    expect(report.best).toBeCloseTo(1);
    expect(report.cutoff).toBeCloseTo(1 - MOMENT_RELATIVE_MARGIN);
    expect(report.rows.map(r => [r.id, r.status])).toEqual([
      ['best', 'shown'],
      ['hidden', 'hidden'],
      ['near', 'shown'],
      ['far', 'below-cutoff'],
      ['opposite', 'below-cutoff'],
    ]);
  });

  it('agrees with matchNotesToMoment on which notes are shown', () => {
    const notes = Array.from({ length: 30 }, (_, i) => note(`n${i}`, at(i * 6)));
    const m = moment();
    const shown = explainMomentMatch(m, notes).rows.filter(r => r.status === 'shown').map(r => r.id);
    expect(shown).toEqual(matchNotesToMoment(m, notes).map(x => x.id));
  });

  it('labels notes past the note cap as over-limit', () => {
    const notes = Array.from({ length: 60 }, (_, i) => note(`n${String(i).padStart(2, '0')}`, at(0)));
    const report = explainMomentMatch(moment({ terms: ['a'], termVectors: [at(0)] }), notes);
    expect(report.rows.filter(r => r.status === 'shown')).toHaveLength(50);
    expect(report.rows.filter(r => r.status === 'over-limit')).toHaveLength(10);
  });

  it('reports term-only mode with the fixed floor for a moment without an intent vector', () => {
    const report = explainMomentMatch(moment({ intentVector: undefined }), [note('x', at(0))]);
    expect(report.mode).toBe('term-only');
    expect(report.cutoff).toBe(MOMENT_MIN_SIMILARITY);
  });

  it('reports not-embedded for a moment still waiting for vectors', () => {
    expect(explainMomentMatch(moment({ termVectors: undefined }), [note('x', at(0))]).mode).toBe('not-embedded');
  });
});
