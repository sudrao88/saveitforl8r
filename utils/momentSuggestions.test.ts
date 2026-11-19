import { describe, it, expect } from 'vitest';
import { Memory, Moment, EMBEDDING_MODEL_ID } from '../types';
import { buildMomentNoteIndex, matchNotesToMoment } from './momentMatching';
import { suggestMoments, suggestionKey, MAX_SUGGESTIONS } from './momentSuggestions';

// Unit vector at a given angle (degrees) in the x/y plane, so dot = cos(angle).
const at = (deg: number): number[] => {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
};

const note = (id: string, v: number[], tags: string[] = [], extra: Partial<Memory> = {}): Memory => ({
  id,
  content: `note ${id}`,
  timestamp: 0,
  tags,
  enrichment: { summary: '', suggestedTags: [], embedding: v, embeddingModel: EMBEDDING_MODEL_ID } as Memory['enrichment'],
  ...extra,
});

const suggest = (notes: Memory[], moments: Moment[] = [], dismissed: string[] = []) => {
  const index = buildMomentNoteIndex(notes);
  const matchesByMoment = new Map(moments.map(m => [m.id, matchNotesToMoment(m, index)]));
  return suggestMoments(index, moments, matchesByMoment, new Set(dismissed));
};

describe('suggestionKey', () => {
  it('normalizes and stems the keyword', () => {
    expect(suggestionKey('#Coffee Shops')).toBe('coffee shop');
  });

  it('rejects generic words, single characters and numbers', () => {
    expect(suggestionKey('Tips')).toBeNull();
    expect(suggestionKey('best ideas')).toBeNull();
    expect(suggestionKey('x')).toBeNull();
    expect(suggestionKey('2024')).toBeNull();
  });
});

describe('suggestMoments', () => {
  it('suggests a keyword shared by 3 similar notes', () => {
    const notes = [
      note('a', at(0), ['Coffee']),
      note('b', at(10), ['coffee']),
      note('c', at(20), ['Coffee']),
      note('z', at(90), ['travel']),
    ];
    const [s, ...rest] = suggest(notes);
    expect(rest).toEqual([]);
    expect(s.key).toBe('coffee');
    expect(s.label).toBe('Coffee');
    expect(s.clusterIds).toEqual(['a', 'b', 'c']);
    expect(s.matches.map(m => m.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns exactly what matchNotesToMoment shows for the draft moment', () => {
    const notes = [
      note('a', at(0), ['coffee']),
      note('b', at(10), ['coffee']),
      note('c', at(20), ['coffee']),
      // Mentions coffee only in its content and is far from the cluster: the
      // moment matcher still includes it, so the suggestion does too.
      note('d', at(80), [], { content: 'cold brew coffee recipe' }),
    ];
    const index = buildMomentNoteIndex(notes);
    const [s] = suggestMoments(index, [], new Map());
    expect(s.matches).toEqual(matchNotesToMoment(s.draft, index));
    expect(s.matches.map(m => m.id)).toContain('d');
    expect(s.clusterIds).toEqual(['a', 'b', 'c']);
  });

  it('needs the notes to form an embedding cluster', () => {
    const notes = [
      note('a', at(0), ['coffee']),
      note('b', at(70), ['coffee']),
      note('c', at(140), ['coffee']),
    ];
    expect(suggest(notes)).toEqual([]);
  });

  it('needs a shared keyword', () => {
    const notes = [
      note('a', at(0), ['coffee']),
      note('b', at(5), ['tea']),
      note('c', at(10), ['juice']),
    ];
    expect(suggest(notes)).toEqual([]);
  });

  it('ignores generic tags', () => {
    const notes = ['a', 'b', 'c'].map((id, i) => note(id, at(i * 5), ['tips']));
    expect(suggest(notes)).toEqual([]);
  });

  it('skips a keyword an existing moment already covers', () => {
    const notes = ['a', 'b', 'c'].map((id, i) => note(id, at(i * 5), ['coffee']));
    const existing: Moment = {
      id: 'm', title: 'Cafes', terms: ['Cafes'], createdAt: 0, updatedAt: 0,
      concepts: [['cafe', 'coffee']], termVectors: [at(0)], intentVector: at(0), embeddingModel: EMBEDDING_MODEL_ID,
    };
    expect(suggest(notes, [existing])).toEqual([]);
  });

  it('skips a keyword that is already a moment term (e.g. just added, not yet embedded)', () => {
    const notes = ['a', 'b', 'c'].map((id, i) => note(id, at(i * 5), ['Coffee']));
    const justAdded: Moment = { id: 'm', title: 'Coffee', terms: ['Coffee'], createdAt: 0, updatedAt: 0 };
    expect(suggest(notes, [justAdded])).toEqual([]);
  });

  it('skips a suggestion whose notes an existing moment already shows', () => {
    const notes = ['a', 'b', 'c'].map((id, i) => note(id, at(i * 5), ['coffee', 'morning']));
    const existing: Moment = {
      id: 'm', title: 'Mornings', terms: ['Mornings'], createdAt: 0, updatedAt: 0,
      concepts: [['morning']], termVectors: [at(0)], intentVector: at(0), embeddingModel: EMBEDDING_MODEL_ID,
    };
    expect(suggest(notes, [existing])).toEqual([]);
  });

  it('skips dismissed keywords', () => {
    const notes = ['a', 'b', 'c'].map((id, i) => note(id, at(i * 5), ['coffee']));
    expect(suggest(notes, [], ['coffee'])).toEqual([]);
  });

  it('drops a suggestion that overlaps a higher-ranked one', () => {
    const notes = ['a', 'b', 'c'].map((id, i) => note(id, at(i * 5), ['coffee', 'espresso']));
    const out = suggest(notes);
    expect(out).toHaveLength(1);
  });

  it(`caps the number of suggestions at ${MAX_SUGGESTIONS}`, () => {
    const topics = ['coffee', 'hiking', 'jazz', 'pottery', 'chess'];
    const notes = topics.flatMap((t, ti) =>
      [0, 1, 2].map(i => note(`${t}${i}`, at(ti * 70 + i * 3), [t])),
    );
    expect(suggest(notes)).toHaveLength(MAX_SUGGESTIONS);
  });

  it('ignores deleted notes and notes from another embedding model', () => {
    const notes = [
      note('a', at(0), ['coffee']),
      note('b', at(5), ['coffee']),
      note('c', at(10), ['coffee'], { isDeleted: true }),
      note('d', at(10), ['coffee'], {
        enrichment: { summary: '', suggestedTags: [], embedding: at(10), embeddingModel: 'old' } as Memory['enrichment'],
      }),
    ];
    expect(suggest(notes)).toEqual([]);
  });

  it('is deterministic regardless of note order', () => {
    const notes = [
      note('a', at(0), ['coffee']),
      note('b', at(10), ['coffee']),
      note('c', at(20), ['coffee']),
      note('d', at(90), ['hiking']),
      note('e', at(95), ['hiking']),
      note('f', at(100), ['hiking']),
    ];
    expect(suggest([...notes].reverse())).toEqual(suggest(notes));
  });
});
