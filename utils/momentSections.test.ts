import { describe, it, expect } from 'vitest';
import { Memory, Moment, EMBEDDING_MODEL_ID } from '../types';
import { MomentMatch } from './momentMatching';
import { haversineKm, sectionMoment, MomentSectioning, OTHER_SECTION_KEY } from './momentSections';

// Unit vector at a given angle (degrees) in the x/y plane, so dot = cos(angle).
const at = (deg: number): number[] => {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
};

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date(2025, 2, 10, 12).getTime(); // 10 Mar 2025, local time

type Extra = Partial<Omit<Memory, 'enrichment'>> & { enrichment?: Record<string, unknown> };

const note = (id: string, v: number[] | null, tags: string[] = [], extra: Extra = {}): Memory => {
  const { enrichment, ...rest } = extra;
  return {
    id,
    content: `note ${id}`,
    timestamp: T0,
    tags,
    ...rest,
    enrichment: {
      summary: '',
      suggestedTags: [],
      ...(v ? { embedding: v, embeddingModel: EMBEDDING_MODEL_ID } : {}),
      ...enrichment,
    } as Memory['enrichment'],
  };
};

const moment: Moment = {
  id: 'm1', title: 'Japan trip', terms: ['Japan trip'], createdAt: 0, updatedAt: 0,
};

const run = (notes: Memory[], m: Moment = moment, matches?: MomentMatch[]): MomentSectioning[] =>
  sectionMoment(
    m,
    matches ?? notes.map((n, i) => ({ id: n.id, score: 1 - i / 100 })),
    new Map(notes.map(n => [n.id, n])),
  );

const lens = (out: MomentSectioning[], name: string) => out.find(s => s.lens === name);
const shape = (s: MomentSectioning | undefined) => s?.sections.map(x => [x.label, x.noteIds]);

// Two clear groups in embedding space: a-c near 0 degrees, d-f near 90.
const twoTopics = () => [
  note('a', at(0), ['ramen']),
  note('b', at(5), ['Ramen']),
  note('c', at(10), ['ramen']),
  note('d', at(90), ['temples']),
  note('e', at(95), ['temples']),
  note('f', at(100), ['temples']),
];

describe('sectionMoment: topic lens', () => {
  it('splits embedding clusters and labels them from their own tags', () => {
    expect(shape(lens(run(twoTopics()), 'topic'))).toEqual([
      ['ramen', ['a', 'b', 'c']],
      ['temples', ['d', 'e', 'f']],
    ]);
  });

  it('orders sections by their best match and notes by relevance', () => {
    const notes = twoTopics();
    const order = ['e', 'a', 'f', 'c', 'd', 'b'];
    const matches = order.map((id, i) => ({ id, score: 1 - i / 10 }));
    expect(shape(lens(run(notes, moment, matches), 'topic'))).toEqual([
      ['temples', ['e', 'f', 'd']],
      ['ramen', ['a', 'c', 'b']],
    ]);
  });

  it('never labels a section with words the moment already says', () => {
    const notes = twoTopics().map(n => ({ ...n, tags: [...n.tags, 'japan', 'Japan Trip'] }));
    const labels = lens(run(notes), 'topic')!.sections.map(s => s.label);
    expect(labels).toEqual(['ramen', 'temples']);
  });

  it('skips a keyword every cluster shares and falls back to a title word', () => {
    const titled = (id: string, deg: number, title: string) =>
      note(id, at(deg), ['food'], { enrichment: { entityContext: { type: 'Thing', title } } });
    const out = run([
      titled('a', 0, 'Ichiran noodles'),
      titled('b', 5, 'Late night noodles'),
      titled('c', 10, 'Noodles in Shibuya'),
      titled('d', 90, 'Kinkakuji shrine'),
      titled('e', 95, 'Fushimi shrine walk'),
      titled('f', 100, 'Quiet shrine'),
    ]);
    expect(lens(out, 'topic')!.sections.map(s => s.label)).toEqual(['Noodles', 'Shrine']);
  });

  it('names a cluster after its central note when nothing else sets it apart', () => {
    const out = run(twoTopics().map((n, i) => ({ ...n, tags: [], content: `<p>Entry ${i}</p>` })));
    const labels = lens(out, 'topic')!.sections.map(s => s.label);
    expect(labels).toHaveLength(2);
    for (const l of labels) expect(l).toMatch(/^Like “Entry \d”$/);
  });

  it('puts stragglers in a trailing Other section', () => {
    const out = run([...twoTopics(), note('z', at(200), ['misc'])]);
    const topic = lens(out, 'topic')!;
    expect(topic.sections.map(s => s.label)).toEqual(['ramen', 'temples', 'Other']);
    expect(topic.sections[2]).toMatchObject({ key: OTHER_SECTION_KEY, noteIds: ['z'] });
  });

  it('splits notes that share most of their meaning, by how they differ', () => {
    // Every note is within 22 degrees of the others (cosine above 0.92).
    const notes = [0, 1, 2, 20, 21, 22].map((deg, i) => note(`n${i}`, at(deg), [i < 3 ? 'ramen' : 'temples']));
    expect(shape(lens(run(notes), 'topic'))).toEqual([
      ['ramen', ['n0', 'n1', 'n2']],
      ['temples', ['n3', 'n4', 'n5']],
    ]);
  });

  it('moves a lone note into the cluster it sits with', () => {
    // 'z' is a cluster of one, between the ramen notes and well away from the temples.
    const out = run([...twoTopics(), note('y', at(180), ['onsen']), note('z', at(4), ['misc'])]);
    const topic = lens(out, 'topic')!;
    expect(topic.sections.find(s => s.label === 'ramen')!.noteIds).toContain('z');
  });

  it('stays flat when the notes are all alike', () => {
    const notes = [0, 1, 2, 3, 4, 5, 6, 7].map(i => note(`n${i}`, at(i), ['ramen']));
    expect(run(notes)).toEqual([]);
  });

  it('stays flat below the minimum number of notes', () => {
    expect(run(twoTopics().slice(0, 5))).toEqual([]);
  });

  it('gives the same result whatever order the notes arrive in', () => {
    const notes = [...twoTopics(), note('g', at(180), ['onsen']), note('h', at(185), ['onsen'])];
    const matches = notes.map((n, i) => ({ id: n.id, score: 1 - i / 100 }));
    const expected = sectionMoment(moment, matches, new Map(notes.map(n => [n.id, n])));
    const shuffled = new Map([...notes].reverse().map(n => [n.id, n]));
    expect(sectionMoment(moment, matches, shuffled)).toEqual(expected);
    expect(lens(expected, 'topic')!.sections.map(s => s.label)).toEqual(['ramen', 'temples', 'onsen']);
  });
});

describe('sectionMoment: kind lens', () => {
  const kinds = () => [
    note('a', at(0), [], { enrichment: { contentType: 'recipe' } }),
    note('b', at(5), [], { enrichment: { contentType: 'place_restaurant' } }),
    note('c', at(10), [], { enrichment: { contentType: 'recipe' } }),
    note('d', at(90), [], { enrichment: { contentType: 'book' } }),
    note('e', at(95), [], { enrichment: { contentType: 'book' } }),
    note('f', at(100), [], { enrichment: { contentType: 'book' } }),
  ];

  it('groups content types into families', () => {
    expect(shape(lens(run(kinds()), 'kind'))).toEqual([
      ['Food & drink', ['a', 'b', 'c']],
      ['Books', ['d', 'e', 'f']],
    ]);
  });

  it('leads when it agrees with what the notes are about', () => {
    const out = run(kinds().map(n => ({ ...n, tags: ['x'] })));
    expect(out[0].lens).toBe('kind');
  });

  it('ranks below topic when it cuts across what the notes are about', () => {
    // Content types alternate within each embedding cluster.
    const mixed = twoTopics().map((n, i) => ({
      ...n,
      enrichment: { ...n.enrichment!, contentType: i % 2 ? 'book' : 'recipe' },
    }));
    const out = run(mixed);
    expect(out[0].lens).toBe('topic');
    expect(lens(out, 'kind')!.score).toBeLessThan(out[0].score);
  });

  it('groups by entity type', () => {
    const typed = (id: string, deg: number, type: string) =>
      note(id, at(deg), [], { enrichment: { entityContext: { type, title: `${type} ${id}` } } });
    const out = run([
      typed('a', 0, 'Movie'), typed('b', 5, 'Movie'), typed('c', 10, 'movie'),
      typed('d', 90, 'Book'), typed('e', 95, 'Book'), typed('f', 100, 'Book'),
    ]);
    expect(shape(lens(out, 'kind'))).toEqual([
      ['Movie', ['a', 'b', 'c']],
      ['Book', ['d', 'e', 'f']],
    ]);
  });

  it('groups a hybrid moment by the word each note matched', () => {
    const hybrid: Moment = { ...moment, title: 'Italian', terms: ['Italian'], concepts: [['pasta', 'risotto']] };
    const notes = [0, 5, 10, 90, 95, 100].map((deg, i) => note(`n${i}`, at(deg)));
    const matches = notes.map((n, i) => ({ id: n.id, score: 1 - i / 10, matched: [i < 3 ? 'pasta' : 'risotto'] }));
    expect(shape(lens(run(notes, hybrid, matches), 'kind'))).toEqual([
      ['Pasta', ['n0', 'n1', 'n2']],
      ['Risotto', ['n3', 'n4', 'n5']],
    ]);
  });

  const spot = (id: string, deg: number | null, subtitle?: string, extra: Record<string, unknown> = {}) =>
    note(id, deg === null ? null : at(deg), [], {
      enrichment: {
        contentType: 'place_restaurant',
        entityContext: { type: 'Place', title: `Spot ${id}`, ...(subtitle ? { subtitle } : {}) },
        ...extra,
      },
    });

  it('groups places by the kind of place', () => {
    const out = run([
      spot('a', 0, 'South Indian Restaurant'), spot('b', 5, 'Thai Restaurant'), spot('c', 10, 'Family restaurant'),
      spot('d', 90, 'Heritage Hotel'), spot('e', 95, 'Boutique Hotel'), spot('f', 100, 'Hotel'),
    ]);
    expect(out[0].lens).toBe('kind');
    expect(shape(out[0])).toEqual([
      ['Restaurant', ['a', 'b', 'c']],
      ['Hotel', ['d', 'e', 'f']],
    ]);
  });

  it('splits a kind nearly every note shares into its own kinds', () => {
    const out = run([
      spot('a', 0, 'South Indian Restaurant'), spot('b', 5, 'South Indian Restaurant'),
      spot('c', 10, 'North Indian Restaurant'),
      spot('d', 60, 'Thai Restaurant'), spot('e', 65, 'Thai Restaurant'),
      spot('f', 120, 'Craft Brewery'), spot('g', 125, 'Brewery'),
    ]);
    expect(shape(lens(out, 'kind'))).toEqual([
      ['Indian Restaurant', ['a', 'b', 'c']],
      ['Thai Restaurant', ['d', 'e']],
      ['Brewery', ['f', 'g']],
    ]);
  });

  it('reads the subtitle as a kind only for places', () => {
    const book = (id: string, deg: number, author: string) =>
      note(id, at(deg), [], { enrichment: { contentType: 'book', entityContext: { type: 'Book', title: id, subtitle: author } } });
    const out = run([
      book('a', 0, 'Jane Austen'), book('b', 5, 'Jane Austen'), book('c', 10, 'Jane Austen'),
      book('d', 90, 'Leo Tolstoy'), book('e', 95, 'Leo Tolstoy'), book('f', 100, 'Leo Tolstoy'),
    ]);
    expect(lens(out, 'kind')).toBeUndefined();
  });

  it('groups by tags when nothing else tells the notes apart', () => {
    expect(shape(lens(run(twoTopics()), 'kind'))).toEqual([
      ['Ramen', ['a', 'b', 'c']],
      ['Temples', ['d', 'e', 'f']],
    ]);
  });

  it('puts a note with no type in the section its embedding sits with', () => {
    const out = run([
      spot('a', 0, 'Thai Restaurant'), spot('b', 6, 'Sushi Restaurant'), spot('c', 12, 'Restaurant'),
      spot('d', 90, 'Hotel'), spot('e', 96, 'Hotel'), spot('f', 102, 'Hotel'),
      note('g', at(5)), note('h', at(200)), note('i', null),
    ]);
    expect(shape(lens(out, 'kind'))).toEqual([
      ['Restaurant', ['a', 'b', 'c', 'g']],
      ['Hotel', ['d', 'e', 'f']],
      ['Other', ['h', 'i']],
    ]);
  });

  it('never uses a kind the moment already names', () => {
    const hotels: Moment = { ...moment, title: 'Hotels', terms: ['Hotels'] };
    const out = run([
      spot('a', 0, 'Thai Restaurant'), spot('b', 6, 'Sushi Restaurant'), spot('c', 12, 'Restaurant'),
      spot('d', 90, 'Hotel'), spot('e', 96, 'Hotel'), spot('f', 102, 'Hotel'),
    ], hotels);
    expect(lens(out, 'kind')).toBeUndefined();
  });

  it('works for notes without embeddings', () => {
    const out = run(kinds().map(n => note(n.id, null, [], { enrichment: { contentType: n.enrichment!.contentType } })));
    expect(out.map(s => s.lens)).toEqual(['kind']);
  });
});

describe('sectionMoment: place lens', () => {
  const place = (id: string, lat: number, lon: number, address: string, name = `Spot ${id}`) =>
    note(id, at(0), [], {
      enrichment: { locationIsRelevant: true, locationContext: { name, latitude: lat, longitude: lon, address } },
    });
  const twoCities = () => [
    place('a', 12.97, 77.59, '12 MG Road, Bengaluru, Karnataka 560001, India'),
    place('b', 12.93, 77.62, '80 Feet Rd, Bengaluru, Karnataka 560034, India'),
    place('c', 13.0, 77.57, 'Malleshwaram, Bengaluru, Karnataka 560003, India'),
    place('d', 19.07, 72.87, 'Bandra West, Mumbai, Maharashtra 400050, India'),
    place('e', 18.93, 72.83, 'Colaba, Mumbai, Maharashtra 400005, India'),
    place('f', 19.1, 72.85, 'Juhu, Mumbai, Maharashtra 400049, India'),
  ];

  it('groups nearby places and names them by their shared area', () => {
    expect(shape(lens(run(twoCities()), 'place'))).toEqual([
      ['Bengaluru', ['a', 'b', 'c']],
      ['Mumbai', ['d', 'e', 'f']],
    ]);
  });

  it('falls back to the commonest place name without addresses', () => {
    const notes = twoCities().map((n, i) => ({
      ...n,
      enrichment: {
        ...n.enrichment!,
        locationContext: { ...n.enrichment!.locationContext, address: undefined, name: i < 3 ? 'Cubbon Park' : 'Marine Drive' },
      },
    }));
    expect(lens(run(notes), 'place')!.sections.map(s => s.label)).toEqual(['Near Cubbon Park', 'Near Marine Drive']);
  });

  it('ignores places marked irrelevant and needs most notes to have one', () => {
    const notes = twoCities().map((n, i) =>
      i < 3 ? n : { ...n, enrichment: { ...n.enrichment!, locationIsRelevant: false } },
    );
    expect(lens(run(notes), 'place')).toBeUndefined();
  });

  it('measures distance in kilometres', () => {
    expect(haversineKm(12.97, 77.59, 12.97, 77.59)).toBe(0);
    expect(haversineKm(12.97, 77.59, 19.07, 72.87)).toBeGreaterThan(800);
    expect(haversineKm(12.97, 77.59, 19.07, 72.87)).toBeLessThan(900);
  });
});

describe('sectionMoment: time lens', () => {
  const when = (id: string, days: number, deg = 0) => note(id, at(deg), [], { timestamp: T0 + days * DAY });

  it('splits bursts of notes saved close together, newest first', () => {
    const out = run([
      when('a', 0), when('b', 1), when('c', 2),
      when('d', 90), when('e', 91), when('f', 92),
    ]);
    const time = lens(out, 'time')!;
    expect(time.sections.map(s => s.noteIds)).toEqual([['d', 'e', 'f'], ['a', 'b', 'c']]);
    expect(time.sections.map(s => s.label)).toEqual(['8–10 Jun 2025', '10–12 Mar 2025']);
  });

  it('does not split notes saved at a steady pace', () => {
    const notes = [0, 1, 2, 3, 4, 5, 6, 7].map(i => when(`n${i}`, i * 7));
    expect(lens(run(notes), 'time')).toBeUndefined();
  });

  it('drops a grouping that leaves too many notes over', () => {
    // Two bursts of 2 and four notes on their own: over a third would be "Other".
    const out = run([
      when('a', 0), when('b', 1), when('c', 30), when('d', 60),
      when('e', 90), when('f', 91), when('g', 120), when('h', 150), when('i', 180),
    ]);
    expect(lens(out, 'time')).toBeUndefined();
  });
});
