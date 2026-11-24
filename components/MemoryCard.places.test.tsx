import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeAll } from 'vitest';
import MemoryCard from './MemoryCard';
import { Memory } from '../types';

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
});
