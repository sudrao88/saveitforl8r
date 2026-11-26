import { describe, it, expect } from 'vitest';
import { Memory, Moment, MomentAiSections, EMBEDDING_MODEL_ID } from '../types';
import {
  applySectionResult,
  buildSectionRequest,
  layoutAiSections,
  noteCard,
  planSectionRequest,
  MAX_AI_SECTIONS,
} from './momentAiSections';

// Unit vector at a given angle (degrees), so dot = cos(angle).
const at = (deg: number): number[] => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];

const note = (id: string, deg: number | null = 0, extra: Partial<Memory> = {}): Memory => ({
  id,
  content: `note ${id}`,
  timestamp: 0,
  tags: [],
  enrichment: {
    summary: '',
    suggestedTags: [],
    ...(deg === null ? {} : { embedding: at(deg), embeddingModel: EMBEDDING_MODEL_ID }),
  } as Memory['enrichment'],
  ...extra,
});

const base: Moment = { id: 'm1', title: 'Japan trip', terms: ['Japan trip'], createdAt: 0, updatedAt: 0 };
const withAi = (ai: Partial<MomentAiSections>): Moment => ({
  ...base,
  aiSections: { sections: [], assigned: {}, generatedAt: 1, noteCount: 0, otherCount: 0, ...ai },
});

const FOOD = { id: 'food', label: 'Food', description: 'Places to eat.' };
const SIGHTS = { id: 'sights', label: 'Sights', description: 'Things to see.' };

const world = (notes: Memory[]) => ({
  matches: notes.map((n, i) => ({ id: n.id, score: 1 - i / 100 })),
  byId: new Map(notes.map(n => [n.id, n])),
});
const plan = (moment: Moment, notes: Memory[]) => {
  const { matches, byId } = world(notes);
  return planSectionRequest(moment, matches, byId);
};
const layout = (moment: Moment, notes: Memory[]) => {
  const { matches, byId } = world(notes);
  return layoutAiSections(moment, matches, byId);
};
const shape = (moment: Moment, notes: Memory[]) => layout(moment, notes)?.sections.map(s => [s.label, s.noteIds]);

// Food notes near 0 degrees, sights near 90.
const food = ['a', 'b', 'c'].map((id, i) => note(id, i * 5));
const sights = ['d', 'e', 'f'].map((id, i) => note(id, 90 + i * 5));
const six = [...food, ...sights];
const sixAssigned = { a: 'food', b: 'food', c: 'food', d: 'sights', e: 'sights', f: 'sights' };
const sectioned = (extra: Partial<MomentAiSections> = {}) =>
  withAi({ sections: [FOOD, SIGHTS], assigned: sixAssigned, noteCount: 6, ...extra });

describe('planSectionRequest: first sections', () => {
  it('asks for sections when a moment has six notes and none yet', () => {
    const p = plan(base, six)!;
    expect(p.mode).toBe('create');
    expect(p.notes.map(n => n.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(p.existing).toEqual([]);
  });

  it('does not ask below six notes', () => {
    expect(plan(base, six.slice(0, 5))).toBeNull();
  });

  it('does not count deleted notes', () => {
    expect(plan(base, [...six.slice(0, 5), note('z', 0, { isDeleted: true })])).toBeNull();
  });

  it('does not ask again once sections exist', () => {
    expect(plan(sectioned(), six)).toBeNull();
  });

  it('does not ask again after "no worthwhile split" until the moment has grown', () => {
    const tried = withAi({ noteCount: 6 });
    expect(plan(tried, six)).toBeNull();
    expect(plan(tried, [...six, note('g'), note('h')])).toBeNull();
    expect(plan(tried, [...six, note('g'), note('h'), note('i')])!.mode).toBe('create');
  });
});

describe('planSectionRequest: extending sections', () => {
  // Far from both sections, so the device leaves them in Other.
  const strays = (n: number, from = 0) => Array.from({ length: n }, (_, i) => note(`s${from + i}`, 200 + (from + i) * 12));

  it('leaves the moment alone with four or fewer notes outside the sections', () => {
    expect(plan(sectioned(), [...six, ...strays(4)])).toBeNull();
  });

  it('asks about just the leftover notes once more than four pile up, keeping the sections', () => {
    const p = plan(sectioned(), [...six, ...strays(5)])!;
    expect(p.mode).toBe('extend');
    expect(p.notes.map(n => n.id)).toEqual(['s0', 's1', 's2', 's3', 's4']);
    expect(p.existing).toEqual([FOOD, SIGHTS]);
  });

  it('does not ask when the leftovers are a small share of a large moment', () => {
    const many = Array.from({ length: 40 }, (_, i) => note(`x${i}`, i % 2 ? 2 : 92));
    const assigned = Object.fromEntries(many.map((m, i) => [m.id, i % 2 ? 'food' : 'sights']));
    const moment = withAi({ sections: [FOOD, SIGHTS], assigned, noteCount: 40 });
    // 5 of 45 notes is 11%: more than four, but under the 15% share.
    expect(plan(moment, [...many, ...strays(5)])).toBeNull();
    expect(plan(moment, [...many, ...strays(8)])!.mode).toBe('extend');
  });

  it('does not ask again unless the leftovers have grown since last time', () => {
    const assigned = { ...sixAssigned, s0: '', s1: '', s2: '', s3: '', s4: '' };
    const moment = sectioned({ assigned, otherCount: 5 });
    expect(plan(moment, [...six, ...strays(5)])).toBeNull();
    // Deleting a note changes the count but not the need.
    expect(plan(moment, [...six.slice(1), ...strays(5)])).toBeNull();
    const p = plan(moment, [...six, ...strays(6)])!;
    expect(p.notes.map(n => n.id)).toEqual(['s0', 's1', 's2', 's3', 's4', 's5']);
  });

  it('never counts notes that have no embedding yet', () => {
    const pending = Array.from({ length: 6 }, (_, i) => note(`p${i}`, null));
    expect(plan(sectioned(), [...six, ...pending])).toBeNull();
  });

  it('does not ask once the moment has the most sections it can', () => {
    const sections = Array.from({ length: MAX_AI_SECTIONS }, (_, i) => ({ id: `s${i}`, label: `S${i}`, description: '' }));
    expect(plan(withAi({ sections, assigned: sixAssigned, noteCount: 6 }), [...six, ...strays(6)])).toBeNull();
  });
});

describe('layoutAiSections', () => {
  it('shows notes where the model put them, in stored order', () => {
    expect(shape(sectioned(), six)).toEqual([
      ['Food', ['a', 'b', 'c']],
      ['Sights', ['d', 'e', 'f']],
    ]);
  });

  it('keeps a note the model placed even when its embedding points elsewhere', () => {
    const moved = six.map(n => (n.id === 'a' ? note('a', 92) : n));
    expect(shape(sectioned(), moved)![0]).toEqual(['Food', ['a', 'b', 'c']]);
  });

  it('places a later note in the section it sits with, without a call', () => {
    expect(shape(sectioned(), [...six, note('g', 4)])).toEqual([
      ['Food', ['a', 'b', 'c', 'g']],
      ['Sights', ['d', 'e', 'f']],
    ]);
  });

  it('puts later notes that fit nowhere, or have no embedding, in Other', () => {
    const l = layout(sectioned(), [...six, note('g', 200), note('h', null)])!;
    expect(l.sections[2]).toMatchObject({ label: 'Other', noteIds: ['g', 'h'] });
    expect(l.countedOther).toEqual(['g']);
  });

  it('leaves a note the model could not place in Other', () => {
    const l = layout(sectioned({ assigned: { ...sixAssigned, g: '' } }), [...six, note('g', 3)])!;
    expect(l.sections[2].noteIds).toEqual(['g']);
  });

  it('is absent without sections, or when fewer than two still hold notes', () => {
    expect(layout(base, six)).toBeNull();
    expect(layout(withAi({ noteCount: 6 }), six)).toBeNull();
    expect(layout(sectioned(), food)).toBeNull();
  });
});

describe('applySectionResult', () => {
  const ids = () => {
    let n = 0;
    return () => `new${++n}`;
  };

  it('stores first sections with where every sent note went', () => {
    const notes = [...six, note('g', 200)];
    const { matches, byId } = world(notes);
    const p = planSectionRequest(base, matches, byId)!;
    const ai = applySectionResult(
      base, p,
      [
        { label: 'Food', description: 'Eating.', noteIds: ['a', 'b', 'c'] },
        { label: 'Sights', description: 'Seeing.', noteIds: ['d', 'e', 'f', 'not-sent'] },
      ],
      matches, byId, 42, ids(),
    );
    expect(ai).toEqual({
      sections: [
        { id: 'new1', label: 'Food', description: 'Eating.' },
        { id: 'new2', label: 'Sights', description: 'Seeing.' },
      ],
      assigned: { a: 'new1', b: 'new1', c: 'new1', d: 'new2', e: 'new2', f: 'new2', g: '' },
      generatedAt: 42,
      noteCount: 7,
      otherCount: 1,
    });
  });

  it('records "no worthwhile split" so the moment is not asked about again', () => {
    const { matches, byId } = world(six);
    const p = planSectionRequest(base, matches, byId)!;
    const ai = applySectionResult(base, p, [], matches, byId, 42, ids());
    expect(ai).toEqual({ sections: [], assigned: {}, generatedAt: 42, noteCount: 6, otherCount: 0 });
    expect(planSectionRequest({ ...base, aiSections: ai }, matches, byId)).toBeNull();
  });

  it('extends: keeps sections and earlier placements, adds new ones, and settles', () => {
    const strays = Array.from({ length: 6 }, (_, i) => note(`s${i}`, 200 + i * 12));
    const notes = [...six, ...strays];
    const { matches, byId } = world(notes);
    const moment = sectioned();
    const p = planSectionRequest(moment, matches, byId)!;
    const ai = applySectionResult(
      moment, p,
      [
        { id: 'food', label: 'ignored', description: '', noteIds: ['s0'] },
        { label: 'Shopping', description: 'Things to buy.', noteIds: ['s1', 's2', 's3'] },
      ],
      matches, byId, 99, ids(),
    );
    expect(ai.sections).toEqual([FOOD, SIGHTS, { id: 'new1', label: 'Shopping', description: 'Things to buy.' }]);
    expect(ai.assigned).toMatchObject({ a: 'food', f: 'sights', s0: 'food', s1: 'new1', s3: 'new1', s4: '', s5: '' });
    expect(ai.otherCount).toBe(2);
    // Same notes, same leftovers: no further call.
    expect(planSectionRequest({ ...moment, aiSections: ai }, matches, byId)).toBeNull();
  });

  it('settles even when the model places nothing, so the same notes are not sent twice', () => {
    const strays = Array.from({ length: 6 }, (_, i) => note(`s${i}`, 200 + i * 12));
    const { matches, byId } = world([...six, ...strays]);
    const moment = sectioned();
    const p = planSectionRequest(moment, matches, byId)!;
    const ai = applySectionResult(moment, p, [], matches, byId, 99, ids());
    expect(ai.otherCount).toBe(6);
    expect(planSectionRequest({ ...moment, aiSections: ai }, matches, byId)).toBeNull();
  });

  it('forgets placements of notes that no longer exist', () => {
    const strays = Array.from({ length: 6 }, (_, i) => note(`s${i}`, 200 + i * 12));
    const { matches, byId } = world([...six, ...strays]);
    const moment = sectioned({ assigned: { ...sixAssigned, gone: 'food' } });
    const p = planSectionRequest(moment, matches, byId)!;
    expect(applySectionResult(moment, p, [], matches, byId, 99, ids()).assigned).not.toHaveProperty('gone');
  });
});

describe('request payload', () => {
  it('sends a short card per note, never the full content', () => {
    const m = note('a', 0, {
      content: `<p>${'long body '.repeat(200)}</p>`,
      tags: ['ramen'],
      enrichment: {
        summary: 'Late night ramen in Shibuya.',
        suggestedTags: ['tokyo', 'ramen'],
        contentType: 'place_restaurant',
        entityContext: { type: 'Place', title: 'Ichiran', subtitle: 'Ramen Restaurant' },
        embedding: at(0),
        embeddingModel: EMBEDDING_MODEL_ID,
      } as Memory['enrichment'],
    });
    expect(noteCard(m)).toEqual({
      id: 'a',
      title: 'Ichiran',
      summary: 'Late night ramen in Shibuya.',
      type: 'Place, Ramen Restaurant, place restaurant',
      tags: ['ramen', 'tokyo'],
    });
  });

  it('includes existing sections only when extending', () => {
    const { matches, byId } = world(six);
    const create = buildSectionRequest(base, planSectionRequest(base, matches, byId)!);
    expect(create.title).toBe('Japan trip');
    expect(create.notes).toHaveLength(6);
    expect(create).not.toHaveProperty('existing');
    const extend = buildSectionRequest(sectioned(), { mode: 'extend', notes: six.slice(0, 1), existing: [FOOD] });
    expect(extend.existing).toEqual([FOOD]);
  });
});
