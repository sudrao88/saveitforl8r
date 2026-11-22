import { describe, it, expect } from 'vitest';
import {
  shouldUseMapsGrounding,
  buildMapsToolConfig,
  isValidMapsUri,
  extractMapsPlaces,
  matchPlace,
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
  it('reads maps chunks and ignores web chunks', () => {
    const places = extractMapsPlaces(responseWith([
      { web: { uri: 'https://example.com', title: 'x' } },
      { maps: { uri: 'https://maps.google.com/?cid=1', title: 'Vidyarthi Bhavan', placeId: 'places/ChIJabcdefghij' } },
    ]));
    expect(places).toEqual([{ uri: 'https://maps.google.com/?cid=1', title: 'Vidyarthi Bhavan', placeId: 'ChIJabcdefghij' }]);
  });
  it('builds a URI from placeId when uri is missing or invalid', () => {
    const [p] = extractMapsPlaces(responseWith([{ maps: { uri: 'https://bad.example', title: 'A', placeId: 'ChIJabcdefghij' } }]));
    expect(p.uri).toBe('https://www.google.com/maps/place/?q=place_id:ChIJabcdefghij');
  });
  it('handles responses without grounding', () => {
    expect(extractMapsPlaces({})).toEqual([]);
    expect(extractMapsPlaces(undefined)).toEqual([]);
  });
});

describe('matchPlace', () => {
  const places = [
    { title: 'Starbucks Reserve', uri: 'https://maps.google.com/?cid=1' },
    { title: 'Third Wave Coffee', uri: 'https://maps.google.com/?cid=2' },
  ];
  it('matches by name, ignoring case and punctuation', () => {
    expect(matchPlace(places, 'third-wave coffee').uri).toBe('https://maps.google.com/?cid=2');
    expect(matchPlace(places, 'Starbucks').uri).toBe('https://maps.google.com/?cid=1');
  });
  it('does not guess among several places when the name does not match', () => {
    expect(matchPlace(places, 'Blue Tokai')).toBeUndefined();
  });
  it('uses the only place when there is one', () => {
    expect(matchPlace([places[0]], 'Something else').uri).toBe('https://maps.google.com/?cid=1');
  });
});

describe('applyMapsGrounding', () => {
  it('replaces a made-up mapsUri with the grounded one', () => {
    const result = { locationContext: { name: 'Third Wave Coffee', mapsUri: 'https://maps.google.com/fake' } };
    applyMapsGrounding(result, [{ title: 'Third Wave Coffee', uri: 'https://maps.google.com/?cid=2', placeId: 'ChIJabcdefghij' }]);
    expect(result.locationContext.mapsUri).toBe('https://maps.google.com/?cid=2');
    expect(result.locationContext.placeId).toBe('ChIJabcdefghij');
  });
  it('drops an ungrounded mapsUri', () => {
    const result = { locationContext: { name: 'Cafe', mapsUri: 'https://maps.google.com/fake' } };
    applyMapsGrounding(result, []);
    expect(result.locationContext.mapsUri).toBeUndefined();
    expect(result.locationContext.name).toBe('Cafe');
  });
  it('keeps a Maps link the user pasted', () => {
    const result = { locationContext: { name: 'Cafe' } };
    applyMapsGrounding(result, [], ['https://example.com', 'https://maps.app.goo.gl/abc']);
    expect(result.locationContext.mapsUri).toBe('https://maps.app.goo.gl/abc');
  });
  it('leaves results without a location alone', () => {
    const result = { summary: 'x' };
    applyMapsGrounding(result, [{ title: 'A', uri: 'https://maps.google.com/?cid=1' }]);
    expect(result).toEqual({ summary: 'x' });
  });
});
