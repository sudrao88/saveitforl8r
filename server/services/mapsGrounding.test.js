import { describe, it, expect } from 'vitest';
import {
  shouldUseMapsGrounding,
  buildMapsToolConfig,
  isValidMapsUri,
  extractMapsPlaces,
  matchPlace,
  buildPlaceUri,
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
  it('drops an ungrounded mapsUri', () => {
    const result = { locationContext: { name: 'Cafe', mapsUri: 'https://maps.google.com/fake', placeId: 'ChIJstale00001' } };
    applyMapsGrounding(result, []);
    expect(result.locationContext.mapsUri).toBeUndefined();
    expect(result.locationContext.placeId).toBeUndefined();
    expect(result.locationContext.name).toBe('Cafe');
  });
  it('does not ground a location with no name', () => {
    const result = { locationContext: { address: '1 Main St' } };
    applyMapsGrounding(result, [{ title: 'A', placeId: 'ChIJabcdefghij' }]);
    expect(result.locationContext).toEqual({ address: '1 Main St' });
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
    expect(result.places[1]).toEqual({ name: 'Some Unknown Cafe' });
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
