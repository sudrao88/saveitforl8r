import { describe, it, expect } from 'vitest';
import {
  parseMomentTerms,
  isMomentEmbedded,
  needsMomentEmbedding,
  canMatchMoment,
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

  it('is true while keyword concepts are missing', () => {
    expect(needsMomentEmbedding({ ...base, intentVector: [1, 0] })).toBe(true);
    expect(needsMomentEmbedding({ ...base, intentVector: [1, 0], concepts: [] })).toBe(true);
  });

  it('is false once term vectors, the intent vector and concepts are present', () => {
    expect(needsMomentEmbedding({ ...base, intentVector: [1, 0], concepts: [['a']] })).toBe(false);
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

// --- Hybrid matching (moments with concepts) ------------------------------
//
// Notes modelled on real ones: enriched fields only, with vectors chosen so
// the generic reminder is the closest to everything (as embeddings make it).
describe('hybrid matching', () => {
  const enriched = (
    id: string,
    fields: { title: string; type?: string; subtitle?: string; tags?: string[]; summary?: string; place?: string },
    vec: number[],
  ): Memory => ({
    id, content: '', timestamp: 0, tags: [],
    enrichment: {
      summary: fields.summary || '',
      suggestedTags: fields.tags || [],
      entityContext: { type: fields.type || 'Other', title: fields.title, subtitle: fields.subtitle },
      ...(fields.place ? { locationContext: { name: fields.place } } : {}),
      embedding: vec,
      embeddingModel: EMBEDDING_MODEL_ID,
    } as Memory['enrichment'],
  });

  const notes = [
    enriched('wedding', { title: "Brijesh's Wedding", summary: "Reminder for Brijesh's wedding on November 22." }, at(2)),
    enriched('beyond-bean', {
      title: 'Beyond Bean Coffee', type: 'Place', subtitle: 'Coffee Shop & Fast Food Cafe',
      tags: ['#CoffeeShop', '#BangaloreEats', '#Desserts', '#Cafe'],
      summary: 'A cafe in Bangalore known for fresh fruit ice cream.',
    }, at(20)),
    enriched('third-wave', {
      title: 'Third Wave Coffee', type: 'Place', tags: ['coffee', 'roastery'], place: 'Indiranagar, Bengaluru',
      summary: 'Specialty coffee roasters.',
    }, at(30)),
    enriched('mala', {
      title: 'Mala Kitchen', type: 'Place', summary: 'A home-based Sichuan supper club in Bangalore.',
    }, at(10)),
    enriched('vibram', {
      title: 'Vibram Shoes', type: 'Product', tags: ['shoes', 'outdoor gear'],
      summary: "Vibram, a brand famous for rubber soles and 'FiveFingers' shoes.",
    }, at(15)),
    enriched('ecoline', {
      title: 'Ecoline Clothing', type: 'Product', tags: ['#SustainableFashion', 'apparel'],
      summary: 'An eco-friendly clothing label.',
    }, at(40)),
    enriched('boutique', {
      title: 'Luxury Boutique', type: 'Place', tags: ['boutique', 'designer wear'],
      summary: 'Designer outfits and bridal wear.',
    }, at(50)),
  ];

  const hybridMoment = (concepts: string[][], intentDeg = 0) => moment({
    terms: ['x'], termVectors: [at(intentDeg)], intentVector: at(intentDeg), concepts,
  });

  const cafes = hybridMoment([
    ['cafe', 'café', 'coffee shop', 'coffee', 'roastery'],
    ['bangalore', 'bengaluru', 'koramangala', 'indiranagar'],
  ]);
  const fashion = hybridMoment([['fashion', 'clothing', 'apparel', 'outfit', 'boutique', 'designer wear']]);

  it('requires every concept: cafes in Bangalore, not other Bangalore places or brands', () => {
    const ids = matchNotesToMoment(cafes, notes).map(m => m.id).sort();
    expect(ids).toEqual(['beyond-bean', 'third-wave']);
  });

  it('keeps generic reminders out even when their vector is the closest', () => {
    const ids = matchNotesToMoment(fashion, notes).map(m => m.id);
    expect(ids).not.toContain('wedding');
    expect(ids).not.toContain('beyond-bean');
    expect(ids.sort()).toEqual(['boutique', 'ecoline']);
  });

  it('records the word each note matched per concept', () => {
    const byId = new Map(matchNotesToMoment(cafes, notes).map(m => [m.id, m.matched]));
    expect(byId.get('beyond-bean')).toEqual(['cafe', 'bangalore']);
    expect(byId.get('third-wave')![1]).toMatch(/indiranagar|bengaluru/);
  });

  it('ranks qualifying notes by keyword and vector rank together', () => {
    // Moment vector points at third-wave (30°); beyond-bean has more keyword hits.
    const ranked = matchNotesToMoment(hybridMoment(cafes.concepts!, 30), notes).map(m => m.id);
    expect(ranked).toHaveLength(2);
    const [a, b] = matchNotesToMoment(hybridMoment(cafes.concepts!, 30), notes);
    expect(a.score).toBeGreaterThanOrEqual(b.score);
  });

  it('leaves hidden notes out', () => {
    const ids = matchNotesToMoment({ ...cafes, excludedNoteIds: ['beyond-bean'] }, notes).map(m => m.id);
    expect(ids).toEqual(['third-wave']);
  });

  it('shows nothing when no note matches every concept', () => {
    expect(matchNotesToMoment(hybridMoment([['cafe'], ['tokyo']]), notes)).toEqual([]);
  });

  it('explains hybrid matches, with partial matches as near misses', () => {
    const report = explainMomentMatch(cafes, notes);
    expect(report.mode).toBe('hybrid');
    expect(report.concepts).toEqual(cafes.concepts);
    const status = Object.fromEntries(report.rows.map(r => [r.id, r.status]));
    expect(status['beyond-bean']).toBe('shown');
    expect(status['mala']).toBe('partial'); // Bangalore, but not a cafe
    expect(report.rows.find(r => r.id === 'mala')!.matched).toBe('✗ + bangalore');
    expect(status['vibram']).toBeUndefined(); // matched no concept at all
  });
});

describe('canMatchMoment', () => {
  const base: Moment = { id: 'm', title: 't', terms: ['a'], createdAt: 0, updatedAt: 0 };
  it('is true with current vectors or with concepts, even if vectors are stale', () => {
    expect(canMatchMoment(base)).toBe(false);
    expect(canMatchMoment({ ...base, termVectors: [[1]], embeddingModel: EMBEDDING_MODEL_ID })).toBe(true);
    expect(canMatchMoment({ ...base, termVectors: [[1]], embeddingModel: 'old-model', concepts: [['a']] })).toBe(true);
  });
});
