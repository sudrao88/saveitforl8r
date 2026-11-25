import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import MemoryCard from './MemoryCard';
import { Memory } from '../types';

const mapsConfigured = vi.fn(() => false);
vi.mock('../services/googleMaps', () => ({
  isMapsConfigured: () => mapsConfigured(),
  loadGoogleMaps: () => Promise.reject(new Error('no SDK in tests')),
  resolvePlaceLocations: async () => new Map(),
}));

const uri = (name: string, id: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${id}`;

const note = (enrichment: Partial<NonNullable<Memory['enrichment']>>): Memory => ({
  id: 'n1', content: 'Dinner at Toit then drinks at Arbor', timestamp: Date.UTC(2026, 10, 20), tags: [],
  enrichment: { summary: 'Evening plan', suggestedTags: [], ...enrichment } as Memory['enrichment'],
});

describe('MemoryCard Google Maps links', () => {
  beforeAll(() => {
    if (!window.matchMedia) {
      window.matchMedia = ((query: string) => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }
  });

  beforeEach(() => mapsConfigured.mockReturnValue(false));

  it('opens the branches of a chain on the in-app map when the Maps SDK is configured', () => {
    mapsConfigured.mockReturnValue(true);
    render(<MemoryCard memory={note({
      locationIsRelevant: true,
      locationContext: { name: 'Starbucks', mapsUri: 'https://www.google.com/maps/search/?api=1&query=Starbucks' },
      places: [
        { name: 'Starbucks', placeId: 'ChIJsbux000001', mapsUri: uri('Starbucks', 'ChIJsbux000001') },
        { name: 'Starbucks', placeId: 'ChIJsbux000002', mapsUri: uri('Starbucks', 'ChIJsbux000002') },
      ],
    })} />);
    expect(screen.getByRole('button', { name: 'Show 2 places on a map' })).toBeTruthy();
    expect(screen.queryByTitle('Open Starbucks in Google Maps')).toBeNull();
  });

  it('opens several places on the in-app map when the Maps SDK is configured', async () => {
    mapsConfigured.mockReturnValue(true);
    render(<MemoryCard memory={note({
      locationIsRelevant: true,
      locationContext: { name: 'Toit Brewpub', placeId: 'ChIJtoit000001', mapsUri: uri('Toit Brewpub', 'ChIJtoit000001') },
      places: [
        { name: 'Toit Brewpub', placeId: 'ChIJtoit000001', mapsUri: uri('Toit Brewpub', 'ChIJtoit000001') },
        { name: 'Arbor Brewing Company', placeId: 'ChIJarbor00001', mapsUri: uri('Arbor Brewing Company', 'ChIJarbor00001') },
      ],
    })} />);
    expect(screen.queryByTitle('Open Toit Brewpub in Google Maps')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 places on a map' }));
    expect(await screen.findByRole('dialog', { name: /^Map:/ })).toBeTruthy();
  });

  it('shows one Google Maps link per grounded place', () => {
    render(<MemoryCard memory={note({
      locationIsRelevant: true,
      locationContext: { name: 'Toit Brewpub', placeId: 'ChIJtoit000001', mapsUri: uri('Toit Brewpub', 'ChIJtoit000001') },
      places: [
        { name: 'Toit Brewpub', placeId: 'ChIJtoit000001', mapsUri: uri('Toit Brewpub', 'ChIJtoit000001') },
        { name: 'Arbor Brewing Company', placeId: 'ChIJarbor00001', mapsUri: uri('Arbor Brewing Company', 'ChIJarbor00001') },
        { name: 'Unknown Cafe' },
      ],
    })} />);
    const toit = screen.getByTitle('Open Toit Brewpub in Google Maps');
    const arbor = screen.getByTitle('Open Arbor Brewing Company in Google Maps');
    expect(toit.getAttribute('href')).toBe(uri('Toit Brewpub', 'ChIJtoit000001'));
    expect(arbor.getAttribute('href')).toBe(uri('Arbor Brewing Company', 'ChIJarbor00001'));
    expect(screen.queryByTitle('Open Link')).toBeNull();
    expect(screen.queryByText('Unknown Cafe')).toBeNull();
  });

  it('shows a single map-pin link for a one-place note', () => {
    render(<MemoryCard memory={note({
      locationIsRelevant: true,
      locationContext: { name: 'Toit Brewpub', placeId: 'ChIJtoit000001', mapsUri: uri('Toit Brewpub', 'ChIJtoit000001') },
      places: [{ name: 'Toit Brewpub', placeId: 'ChIJtoit000001', mapsUri: uri('Toit Brewpub', 'ChIJtoit000001') }],
    })} />);
    expect(screen.getByTitle('Open Toit Brewpub in Google Maps').getAttribute('href')).toBe(uri('Toit Brewpub', 'ChIJtoit000001'));
    expect(screen.queryByText('Google Maps')).toBeNull();
    expect(screen.queryByTitle('Open Link')).toBeNull();
  });

  it('shows one map-pin link for a chain stored as several branches', () => {
    const search = 'https://www.google.com/maps/search/?api=1&query=Starbucks';
    render(<MemoryCard memory={note({
      locationIsRelevant: true,
      locationContext: { name: 'Starbucks', mapsUri: search },
      places: [
        { name: 'Starbucks', placeId: 'ChIJstarbucks01', mapsUri: uri('Starbucks', 'ChIJstarbucks01') },
        { name: 'Starbucks', placeId: 'ChIJstarbucks02', mapsUri: uri('Starbucks', 'ChIJstarbucks02') },
        { name: 'Starbucks', placeId: 'ChIJstarbucks03', mapsUri: uri('Starbucks', 'ChIJstarbucks03') },
      ],
    })} />);
    const pins = screen.getAllByTitle('Open Starbucks in Google Maps');
    expect(pins).toHaveLength(1);
    expect(pins[0].getAttribute('href')).toBe(search);
    expect(screen.queryByTitle('Open Link')).toBeNull();
  });

  it('shows one pin for a chain alongside pins for other places', () => {
    render(<MemoryCard memory={note({
      locationIsRelevant: true,
      locationContext: { name: 'Toit Brewpub', placeId: 'ChIJtoit000001', mapsUri: uri('Toit Brewpub', 'ChIJtoit000001') },
      places: [
        { name: 'Toit Brewpub', placeId: 'ChIJtoit000001', mapsUri: uri('Toit Brewpub', 'ChIJtoit000001') },
        { name: 'Starbucks', placeId: 'ChIJstarbucks01', mapsUri: uri('Starbucks', 'ChIJstarbucks01') },
        { name: 'Starbucks', placeId: 'ChIJstarbucks02', mapsUri: uri('Starbucks', 'ChIJstarbucks02') },
      ],
    })} />);
    expect(screen.getAllByTitle('Open Toit Brewpub in Google Maps')).toHaveLength(1);
    const chain = screen.getAllByTitle('Open Starbucks in Google Maps');
    expect(chain).toHaveLength(1);
    expect(chain[0].getAttribute('href')).toBe('https://www.google.com/maps/search/?api=1&query=Starbucks');
  });
});
