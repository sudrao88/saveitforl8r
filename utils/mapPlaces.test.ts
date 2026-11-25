import { describe, it, expect } from 'vitest';
import { notePlaces, collectPlaces, categorisePlaces } from './mapPlaces';
import { Memory } from '../types';

const note = (id: string, title: string, enrichment: Partial<NonNullable<Memory['enrichment']>>): Memory => ({
  id, content: '', timestamp: 0, tags: [],
  enrichment: { summary: '', suggestedTags: [], entityContext: { type: 'Place', title }, ...enrichment } as Memory['enrichment'],
});

describe('notePlaces', () => {
  it('returns every place with a placeId, in order, skipping ungrounded ones', () => {
    const places = notePlaces(note('n1', 'Evening', {
      places: [
        { name: 'Toit', placeId: 'ChIJtoit000001', mapsUri: 'https://maps.example/toit', address: 'Indiranagar' },
        { name: 'Somewhere vague' },
        { name: 'Arbor', placeId: 'ChIJarbor00001' },
      ],
    }));
    expect(places.map(p => p.placeId)).toEqual(['ChIJtoit000001', 'ChIJarbor00001']);
    expect(places[0]).toMatchObject({ name: 'Toit', address: 'Indiranagar', mapsUri: 'https://maps.example/toit' });
    // No stored link: one is built from the place ID.
    expect(places[1].mapsUri).toBe('https://www.google.com/maps/search/?api=1&query=Arbor&query_place_id=ChIJarbor00001');
  });

  it('falls back to the main place and does not repeat it', () => {
    const main = { name: 'Toit', placeId: 'ChIJtoit000001', mapsUri: 'https://maps.example/toit' };
    expect(notePlaces(note('n1', 'Toit', { locationContext: main }))).toHaveLength(1);
    expect(notePlaces(note('n1', 'Toit', { locationContext: main, places: [main] }))).toHaveLength(1);
  });

  it('ignores a main place marked not relevant, and notes without enrichment', () => {
    expect(notePlaces(note('n1', 'x', {
      locationIsRelevant: false, locationContext: { name: 'Toit', placeId: 'ChIJtoit000001' },
    }))).toEqual([]);
    expect(notePlaces({ id: 'n2', content: '', timestamp: 0, tags: [] })).toEqual([]);
  });
});

describe('collectPlaces', () => {
  it('merges the same place across notes and records which notes mention it', () => {
    const toit = { name: 'Toit', placeId: 'ChIJtoit000001' };
    const places = collectPlaces([
      note('n1', 'Team dinner', { places: [toit, { name: 'Arbor', placeId: 'ChIJarbor00001' }] }),
      note('n2', 'Birthday', { locationContext: toit }),
    ]);
    expect(places.map(p => p.name)).toEqual(['Toit', 'Arbor']);
    expect(places[0].noteTitles).toEqual(['Team dinner', 'Birthday']);
    expect(places[1].noteTitles).toEqual(['Team dinner']);
    expect(places[0].noteIds).toEqual(['n1', 'n2']);
    expect(places[1].noteIds).toEqual(['n1']);
  });
});

describe('categorisePlaces', () => {
  const places = collectPlaces([
    note('n1', 'Team dinner', { places: [{ name: 'Toit', placeId: 'ChIJtoit000001' }] }),
    note('n2', 'Trek', { places: [{ name: 'Nandi Hills', placeId: 'ChIJnandi00001' }, { name: 'Toit', placeId: 'ChIJtoit000001' }] }),
    note('n3', 'Misc', { places: [{ name: 'Cubbon Park', placeId: 'ChIJcubbon0001' }] }),
  ]);

  it('puts each place in the section of the first note that mentions it', () => {
    const out = categorisePlaces(places, [
      { key: 'trips', label: 'Trips', noteIds: ['n2'] },
      { key: 'food', label: 'Food', noteIds: ['n1'] },
      { key: 'other', label: 'Other', noteIds: ['n3'] },
    ]);
    const byName = Object.fromEntries(out.map(p => [p.name, p.category]));
    // Toit is mentioned by n1 first, so it follows n1's section.
    expect(byName['Toit']).toEqual({ key: 'food', label: 'Food', index: 1 });
    expect(byName['Nandi Hills']).toEqual({ key: 'trips', label: 'Trips', index: 0 });
    expect(byName['Cubbon Park']).toEqual({ key: 'other', label: 'Other', index: -1 });
  });

  it('leaves places uncategorised without sections', () => {
    expect(categorisePlaces(places, undefined)).toBe(places);
    expect(categorisePlaces(places, [])).toBe(places);
  });
});
