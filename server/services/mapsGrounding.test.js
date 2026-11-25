import { describe, it, expect, vi } from 'vitest';
import {
  shouldUseMapsGrounding,
  buildMapsToolConfig,
  isValidMapsUri,
  extractMapsPlaces,
  matchPlace,
  matchPlaces,
  MAX_BRANCHES,
  buildPlaceUri,
  buildSearchUri,
  ungroundedPlaces,
  resolvePlacesWithMaps,
  applyPlacesGrounding,
  applyMapsGrounding,
} from './mapsGrounding.js';

const responseWith = (chunks) => ({ candidates: [{ groundingMetadata: { groundingChunks: chunks } }] });

describe('shouldUseMapsGrounding', () => {
  it('uses Maps for place content types', () => {
    expect(shouldUseMapsGrounding({ contentType: 'place_restaurant', detectedEntities: [] })).toBe(true);
    expect(shouldUseMapsGrounding({ contentType: 'travel', detectedEntities: [] })).toBe(true);
  });
  it('uses Maps when a place entity is detected', () => {
    expect(shouldUseMapsGrounding({ contentType: 'general', detectedEntities: [{ name: 'Cubbon Park', type: 'Place' }] })).toBe(true);
  });
  it('skips Maps for non-place notes', () => {
    expect(shouldUseMapsGrounding({ contentType: 'book', detectedEntities: [{ name: 'Dune', type: 'media' }] })).toBe(false);
  });
  it('without classification, uses Maps only when GPS is known', () => {
    expect(shouldUseMapsGrounding(null, { latitude: 1, longitude: 2 })).toBe(true);
    expect(shouldUseMapsGrounding(null, undefined)).toBe(false);
  });
});

describe('buildMapsToolConfig', () => {
  it('builds a latLng retrieval config', () => {
    expect(buildMapsToolConfig({ latitude: 12.9, longitude: 77.6 })).toEqual({
      retrievalConfig: { latLng: { latitude: 12.9, longitude: 77.6 } },
    });
  });
  it('returns undefined without valid coordinates', () => {
    expect(buildMapsToolConfig(undefined)).toBeUndefined();
    expect(buildMapsToolConfig({ latitude: 'x', longitude: 1 })).toBeUndefined();
  });
});

describe('isValidMapsUri', () => {
  it('accepts Google Maps links', () => {
    expect(isValidMapsUri('https://maps.google.com/?cid=123')).toBe(true);
    expect(isValidMapsUri('https://www.google.com/maps/place/?q=place_id:abc')).toBe(true);
    expect(isValidMapsUri('https://maps.app.goo.gl/xyz')).toBe(true);
  });
  it('rejects other links', () => {
    expect(isValidMapsUri('http://maps.google.com/?cid=1')).toBe(false);
    expect(isValidMapsUri('https://www.google.com/search?q=x')).toBe(false);
    expect(isValidMapsUri('https://evil.example/maps')).toBe(false);
    expect(isValidMapsUri('javascript:alert(1)')).toBe(false);
  });
});

describe('extractMapsPlaces', () => {
  it('keeps only title and placeId from maps chunks, ignoring web chunks', () => {
    const places = extractMapsPlaces(responseWith([
      { web: { uri: 'https://example.com', title: 'x' } },
      { maps: { uri: 'https://maps.google.com/?cid=1', title: 'Vidyarthi Bhavan', placeId: 'places/ChIJabcdefghij' } },
    ]));
    expect(places).toEqual([{ title: 'Vidyarthi Bhavan', placeId: 'ChIJabcdefghij' }]);
  });
  it('skips chunks without a valid placeId', () => {
    expect(extractMapsPlaces(responseWith([{ maps: { uri: 'https://maps.google.com/?cid=1', title: 'A' } }]))).toEqual([]);
    expect(extractMapsPlaces(responseWith([{ maps: { title: 'A', placeId: 'places/bad id!' } }]))).toEqual([]);
  });
  it('handles responses without grounding', () => {
    expect(extractMapsPlaces({})).toEqual([]);
    expect(extractMapsPlaces(undefined)).toEqual([]);
  });
});

describe('buildPlaceUri', () => {
  it('builds a Maps URLs link pinned to the place ID', () => {
    expect(buildPlaceUri('Café & Co', 'ChIJabcdefghij')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20%26%20Co&query_place_id=ChIJabcdefghij',
    );
    expect(isValidMapsUri(buildPlaceUri('A', 'ChIJabcdefghij'))).toBe(true);
  });
});

describe('matchPlace', () => {
  const places = [
    { title: 'Starbucks Reserve', placeId: 'ChIJstarbucks01' },
    { title: 'Third Wave Coffee', placeId: 'ChIJthirdwave01' },
  ];
  it('matches by name, ignoring case and punctuation', () => {
    expect(matchPlace(places, 'third-wave coffee').placeId).toBe('ChIJthirdwave01');
    expect(matchPlace(places, 'Starbucks').placeId).toBe('ChIJstarbucks01');
  });
  it('does not guess among several places when the name does not match', () => {
    expect(matchPlace(places, 'Blue Tokai')).toBeUndefined();
  });
  it('uses the only place when there is one', () => {
    expect(matchPlace([places[0]], 'Something else').placeId).toBe('ChIJstarbucks01');
  });
});

describe('applyMapsGrounding', () => {
  it('replaces a made-up mapsUri with a place-ID link', () => {
    const result = { locationContext: { name: 'Third Wave Coffee', mapsUri: 'https://maps.google.com/fake' } };
    applyMapsGrounding(result, [{ title: 'Third Wave Coffee', placeId: 'ChIJthirdwave01' }]);
    expect(result.locationContext.placeId).toBe('ChIJthirdwave01');
    expect(result.locationContext.mapsUri).toBe(buildPlaceUri('Third Wave Coffee', 'ChIJthirdwave01'));
  });
  it('replaces an ungrounded mapsUri with a name + address search', () => {
    const result = { locationContext: {
      name: '18 Grams Specialty Coffee', address: '15 Cannon Street, Causeway Bay, Hong Kong',
      mapsUri: 'https://maps.google.com/fake', placeId: 'ChIJstale00001',
    } };
    applyMapsGrounding(result, []);
    expect(result.locationContext.mapsUri).toBe(
      'https://www.google.com/maps/search/?api=1&query=18%20Grams%20Specialty%20Coffee%2C%2015%20Cannon%20Street%2C%20Causeway%20Bay%2C%20Hong%20Kong',
    );
    expect(result.locationContext.placeId).toBeUndefined();
  });
  it('searches by name alone when there is no address', () => {
    const result = { locationContext: { name: 'Cafe' } };
    applyMapsGrounding(result, []);
    expect(result.locationContext.mapsUri).toBe(buildSearchUri('Cafe'));
    expect(result.locationContext.mapsUri).not.toContain('@');
  });
  it('does not ground a location with no name', () => {
    const result = { locationContext: { address: '1 Main St' } };
    applyMapsGrounding(result, [{ title: 'A', placeId: 'ChIJabcdefghij' }]);
    expect(result.locationContext).toEqual({ address: '1 Main St', mapsUri: buildSearchUri(undefined, '1 Main St') });
  });
  it('keeps a Maps link the user pasted', () => {
    const result = { locationContext: { name: 'Cafe' } };
    applyMapsGrounding(result, [], ['https://example.com', 'https://maps.app.goo.gl/abc']);
    expect(result.locationContext.mapsUri).toBe('https://maps.app.goo.gl/abc');
  });
  it('leaves results without a location alone', () => {
    const result = { summary: 'x' };
    applyMapsGrounding(result, [{ title: 'A', placeId: 'ChIJabcdefghij' }]);
    expect(result).toEqual({ summary: 'x' });
  });
});

describe('applyPlacesGrounding', () => {
  const grounded = [
    { title: 'Toit Brewpub', placeId: 'ChIJtoit000001' },
    { title: 'Arbor Brewing Company', placeId: 'ChIJarbor00001' },
    { title: 'Byg Brewski Brewing Company', placeId: 'ChIJbyg0000001' },
  ];

  it('gives each mentioned place its own placeId', () => {
    const result = {
      locationIsRelevant: true,
      locationContext: { name: 'Toit Brewpub', placeId: 'ChIJtoit000001', mapsUri: 'x' },
      places: [{ name: 'Toit Brewpub', address: 'Indiranagar' }, { name: 'Arbor Brewing Company' }],
    };
    applyPlacesGrounding(result, grounded);
    expect(result.places).toEqual([
      { name: 'Toit Brewpub', address: 'Indiranagar', placeId: 'ChIJtoit000001', mapsUri: buildPlaceUri('Toit Brewpub', 'ChIJtoit000001') },
      { name: 'Arbor Brewing Company', placeId: 'ChIJarbor00001', mapsUri: buildPlaceUri('Arbor Brewing Company', 'ChIJarbor00001') },
    ]);
  });

  it('keeps an unmatched place without a placeId instead of guessing', () => {
    const result = { places: [{ name: 'Arbor Brewing' }, { name: 'Some Unknown Cafe' }] };
    applyPlacesGrounding(result, grounded);
    expect(result.places[0].placeId).toBe('ChIJarbor00001');
    expect(result.places[1]).toEqual({ name: 'Some Unknown Cafe', mapsUri: buildSearchUri('Some Unknown Cafe') });
  });

  it('never assigns one grounded place to two entries', () => {
    const result = { places: [{ name: 'Toit' }, { name: 'Toit Brewpub' }] };
    applyPlacesGrounding(result, grounded);
    const ids = result.places.map((p) => p.placeId).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builds a one-place list from locationContext when the model gave none', () => {
    const result = { locationContext: { name: 'Toit Brewpub', address: '298 100 Feet Rd', placeId: 'ChIJtoit000001' } };
    applyPlacesGrounding(result, grounded);
    expect(result.places).toEqual([
      { name: 'Toit Brewpub', address: '298 100 Feet Rd', placeId: 'ChIJtoit000001', mapsUri: buildPlaceUri('Toit Brewpub', 'ChIJtoit000001') },
    ]);
  });

  it('keeps the main place and its list entry on the same placeId', () => {
    const result = {
      locationContext: { name: 'Byg Brewski', placeId: 'ChIJbyg0000001' },
      places: [{ name: 'Byg Brewski Brewing Company' }],
    };
    applyPlacesGrounding(result, grounded);
    expect(result.places[0].placeId).toBe('ChIJbyg0000001');
  });

  it('removes places when the note is not about a location', () => {
    const result = { locationIsRelevant: false, places: [{ name: 'Toit Brewpub' }] };
    applyPlacesGrounding(result, grounded);
    expect(result.places).toBeUndefined();
  });

  it('leaves results with no places alone', () => {
    const result = { summary: 'x' };
    applyPlacesGrounding(result, grounded);
    expect(result).toEqual({ summary: 'x' });
  });
});

describe('ungroundedPlaces', () => {
  it('lists the main place and list entries that have no placeId', () => {
    expect(ungroundedPlaces({
      locationContext: { name: '18 Grams', address: 'Causeway Bay' },
      places: [{ name: '18 Grams' }, { name: 'Arbor', placeId: 'ChIJarbor00001' }, { name: 'Toit' }],
    })).toEqual([{ name: '18 Grams', address: undefined }, { name: 'Toit', address: undefined }]);
  });
  it('adds the main place when it is missing from the list', () => {
    expect(ungroundedPlaces({ locationContext: { name: '18 Grams', address: 'Causeway Bay' } }))
      .toEqual([{ name: '18 Grams', address: 'Causeway Bay' }]);
  });
  it('is empty for grounded or non-location results', () => {
    expect(ungroundedPlaces({ locationContext: { name: 'A', placeId: 'ChIJabcdefghij' } })).toEqual([]);
    expect(ungroundedPlaces({ locationIsRelevant: false, locationContext: { name: 'A' } })).toEqual([]);
    expect(ungroundedPlaces(undefined)).toEqual([]);
  });
});

describe('resolvePlacesWithMaps', () => {
  const fakeAi = (chunks) => ({ models: { generateContent: vi.fn().mockResolvedValue(responseWith(chunks)) } });

  it('calls Gemini with only the Maps tool and returns grounded places', async () => {
    const ai = fakeAi([{ maps: { title: '18 Grams Specialty Coffee', placeId: 'places/ChIJ18grams001', uri: 'https://maps.google.com/?cid=1' } }]);
    const out = await resolvePlacesWithMaps(ai, 'gemini-4-hydrogen',
      [{ name: '18 Grams Specialty Coffee', address: '15 Cannon Street, Causeway Bay, Hong Kong' }],
      { latitude: 12.92, longitude: 77.57 });
    expect(out).toEqual([{ title: '18 Grams Specialty Coffee', placeId: 'ChIJ18grams001' }]);
    const req = ai.models.generateContent.mock.calls[0][0];
    expect(req.model).toBe('gemini-4-hydrogen');
    expect(req.config.tools).toEqual([{ googleMaps: {} }]);
    expect(req.config.toolConfig).toEqual({ retrievalConfig: { latLng: { latitude: 12.92, longitude: 77.57 } } });
    expect(req.contents[0].parts[0].text).toContain('18 Grams Specialty Coffee — 15 Cannon Street, Causeway Bay, Hong Kong');
  });

  it('skips the call when nothing needs resolving', async () => {
    const ai = fakeAi([]);
    expect(await resolvePlacesWithMaps(ai, 'm', [], undefined)).toEqual([]);
    expect(ai.models.generateContent).not.toHaveBeenCalled();
  });

  it('end to end: an ungrounded place gets its placeId from the lookup', async () => {
    const result = { locationIsRelevant: true, locationContext: { name: '18 Grams Specialty Coffee', address: '15 Cannon Street, Causeway Bay, Hong Kong' } };
    applyMapsGrounding(result, []);
    applyPlacesGrounding(result, []);
    const ai = fakeAi([{ maps: { title: '18 Grams Specialty Coffee', placeId: 'places/ChIJ18grams001' } }]);
    const extra = await resolvePlacesWithMaps(ai, 'm', ungroundedPlaces(result), undefined);
    applyMapsGrounding(result, extra);
    applyPlacesGrounding(result, extra);
    expect(result.locationContext.placeId).toBe('ChIJ18grams001');
    expect(result.locationContext.mapsUri).toBe(buildPlaceUri('18 Grams Specialty Coffee', 'ChIJ18grams001'));
    expect(result.places[0].placeId).toBe('ChIJ18grams001');
  });
});

describe('chains with several branches', () => {
  const branches = [
    { title: 'Starbucks', placeId: 'ChIJstarbucks01' },
    { title: 'Starbucks', placeId: 'ChIJstarbucks02' },
    { title: 'Third Wave Coffee', placeId: 'ChIJthirdwave01' },
    { title: 'Starbucks', placeId: 'ChIJstarbucks03' },
  ];
  const ground = (result, places) => {
    applyMapsGrounding(result, places);
    applyPlacesGrounding(result, places);
    return result;
  };

  it('matchPlaces returns every branch with the matched title', () => {
    expect(matchPlaces(branches, 'Starbucks').map((p) => p.placeId)).toEqual(['ChIJstarbucks01', 'ChIJstarbucks02', 'ChIJstarbucks03']);
    expect(matchPlaces(branches, 'Third Wave Coffee')).toHaveLength(1);
    expect(matchPlaces(branches, 'Blue Tokai')).toEqual([]);
  });
  it('does not treat differently titled places as branches', () => {
    const places = [{ title: 'Starbucks Reserve', placeId: 'ChIJreserve0001' }, { title: 'Starbucks', placeId: 'ChIJstarbucks01' }];
    expect(matchPlaces(places, 'Starbucks').map((p) => p.placeId)).toEqual(['ChIJstarbucks01']);
  });
  it('caps the number of branches and ignores repeated place IDs', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ title: 'Starbucks', placeId: `ChIJstarbucks${String(i).padStart(2, '0')}` }));
    expect(matchPlaces(many, 'Starbucks')).toHaveLength(MAX_BRANCHES);
    expect(matchPlaces([branches[0], branches[0]], 'Starbucks')).toHaveLength(1);
  });

  it('stores every branch placeId and does not pin the main link to one branch', () => {
    const result = ground({ locationContext: { name: 'Starbucks', address: 'Far Away Mall' }, places: [{ name: 'Starbucks', address: 'Far Away Mall' }] }, branches);
    expect(result.places).toEqual([
      { name: 'Starbucks', placeId: 'ChIJstarbucks01', mapsUri: buildPlaceUri('Starbucks', 'ChIJstarbucks01') },
      { name: 'Starbucks', placeId: 'ChIJstarbucks02', mapsUri: buildPlaceUri('Starbucks', 'ChIJstarbucks02') },
      { name: 'Starbucks', placeId: 'ChIJstarbucks03', mapsUri: buildPlaceUri('Starbucks', 'ChIJstarbucks03') },
    ]);
    expect(result.locationContext.placeId).toBeUndefined();
    expect(result.locationContext.mapsUri).not.toContain('query_place_id');
    expect(ungroundedPlaces(result)).toEqual([]);
  });
  it('is stable when grounding runs a second time', () => {
    const result = ground({ locationContext: { name: 'Starbucks' } }, branches);
    const first = JSON.parse(JSON.stringify(result));
    expect(ground(result, [...branches, ...branches])).toEqual(first);
  });
  it('keeps other places in the note alongside the branches', () => {
    const result = ground({
      locationContext: { name: 'Third Wave Coffee' },
      places: [{ name: 'Third Wave Coffee' }, { name: 'Starbucks' }, { name: 'Unknown Cafe' }],
    }, branches);
    expect(result.locationContext.placeId).toBe('ChIJthirdwave01');
    expect(result.places.map((p) => [p.name, p.placeId])).toEqual([
      ['Third Wave Coffee', 'ChIJthirdwave01'],
      ['Starbucks', 'ChIJstarbucks01'], ['Starbucks', 'ChIJstarbucks02'], ['Starbucks', 'ChIJstarbucks03'],
      ['Unknown Cafe', undefined],
    ]);
    expect(ungroundedPlaces(result)).toEqual([{ name: 'Unknown Cafe', address: undefined }]);
  });
});
