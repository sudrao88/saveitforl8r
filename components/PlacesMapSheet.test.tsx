import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PlacesMapSheet from './PlacesMapSheet';
import { MapPlace } from '../utils/mapPlaces';

vi.mock('../hooks/useBackButton', () => ({ useBackButton: () => {} }));

const loadGoogleMaps = vi.fn();
const resolvePlaceLocations = vi.fn();
vi.mock('../services/googleMaps', () => ({
  loadGoogleMaps: () => loadGoogleMaps(),
  resolvePlaceLocations: (ids: string[]) => resolvePlaceLocations(ids),
}));

const places: MapPlace[] = [
  { placeId: 'ChIJtoit000001', name: 'Toit Brewpub', address: 'Indiranagar', mapsUri: 'https://maps.example/toit', noteTitles: ['Team dinner'] },
  { placeId: 'ChIJarbor00001', name: 'Arbor Brewing Company', mapsUri: 'https://maps.example/arbor' },
];

// Minimal stand-in for the Maps SDK: records markers so tests can tap them.
const markers: { title: string; click: () => void }[] = [];
const fitBounds = vi.fn();
const panTo = vi.fn();
const fakeMaps = () => {
  class GoogleMap { fitBounds = fitBounds; panTo = panTo; addListener() {} }
  class Marker {
    constructor(private opts: { title: string }) {}
    addListener(_: string, fn: () => void) { markers.push({ title: this.opts.title, click: fn }); }
    setMap() {}
  }
  class LatLngBounds { extend() {} }
  const libs: Record<string, unknown> = { maps: { Map: GoogleMap }, marker: { Marker }, core: { LatLngBounds } };
  return { importLibrary: async (name: string) => libs[name] };
};

beforeEach(() => {
  markers.length = 0;
  fitBounds.mockClear();
  panTo.mockClear();
  loadGoogleMaps.mockReset().mockResolvedValue(fakeMaps());
  resolvePlaceLocations.mockReset().mockResolvedValue(new Map([
    ['ChIJtoit000001', { lat: 12.97, lng: 77.64 }],
    ['ChIJarbor00001', { lat: 12.96, lng: 77.6 }],
  ]));
});

describe('PlacesMapSheet', () => {
  it('pins every place and offers Open in Google Maps when a pin is tapped', async () => {
    render(<PlacesMapSheet title="Breweries" places={places} onClose={() => {}} />);
    await waitFor(() => expect(markers).toHaveLength(2));
    expect(resolvePlaceLocations).toHaveBeenCalledWith(['ChIJtoit000001', 'ChIJarbor00001']);
    expect(fitBounds).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link')).toBeNull(); // nothing selected yet

    React.act(() => markers[0].click());
    const link = screen.getByRole('link', { name: /Open in Google Maps/ });
    expect(link.getAttribute('href')).toBe('https://maps.example/toit');
    expect(screen.getByText('Indiranagar')).toBeTruthy();
    expect(screen.getByText('From Team dinner')).toBeTruthy();
  });

  it('selects a place from the strip and pans to it', async () => {
    render(<PlacesMapSheet title="Breweries" places={places} onClose={() => {}} />);
    await waitFor(() => expect(markers).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Arbor Brewing Company' }));
    expect(panTo).toHaveBeenCalledWith({ lat: 12.96, lng: 77.6 });
    expect(screen.getByRole('link', { name: /Open in Google Maps/ }).getAttribute('href')).toBe('https://maps.example/arbor');
  });

  it('says so when some places could not be located', async () => {
    resolvePlaceLocations.mockResolvedValue(new Map([['ChIJtoit000001', { lat: 12.97, lng: 77.64 }]]));
    render(<PlacesMapSheet title="Breweries" places={places} onClose={() => {}} />);
    expect(await screen.findByText('1 place couldn’t be located on the map.')).toBeTruthy();
    // The only pin is selected straight away.
    expect(screen.getByRole('link', { name: /Open in Google Maps/ })).toBeTruthy();
  });

  it('falls back to plain Google Maps links when the map cannot load', async () => {
    loadGoogleMaps.mockRejectedValue(new Error('offline'));
    render(<PlacesMapSheet title="Breweries" places={places} onClose={() => {}} />);
    expect(await screen.findByText('Couldn’t load the map')).toBeTruthy();
    expect(screen.getAllByRole('link').map(a => a.getAttribute('href'))).toEqual([
      'https://maps.example/toit', 'https://maps.example/arbor',
    ]);
  });
});
