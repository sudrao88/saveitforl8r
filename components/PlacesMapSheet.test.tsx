import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PlacesMapSheet from './PlacesMapSheet';
import { MapPlace } from '../utils/mapPlaces';
import { Memory } from '../types';

vi.mock('../hooks/useBackButton', () => ({ useBackButton: () => {} }));

const loadGoogleMaps = vi.fn();
const resolvePlaceLocations = vi.fn();
vi.mock('../services/googleMaps', () => ({
  loadGoogleMaps: () => loadGoogleMaps(),
  resolvePlaceLocations: (ids: string[]) => resolvePlaceLocations(ids),
}));

const hasLocationPermission = vi.fn();
let locationCallbacks: { onPosition: (p: { lat: number; lng: number; accuracy: number }) => void; onError: (e: string) => void } | null = null;
const stopWatch = vi.fn();
const watchUserLocation = vi.fn();
vi.mock('../services/userLocation', () => ({
  hasLocationPermission: () => hasLocationPermission(),
  watchUserLocation: (onPosition: never, onError: never) => watchUserLocation(onPosition, onError),
}));

const places: MapPlace[] = [
  { placeId: 'ChIJtoit000001', name: 'Toit Brewpub', address: 'Indiranagar', mapsUri: 'https://maps.example/toit', noteTitles: ['Team dinner'] },
  { placeId: 'ChIJarbor00001', name: 'Arbor Brewing Company', mapsUri: 'https://maps.example/arbor' },
];

// Minimal stand-in for the Maps SDK: records markers so tests can tap them
// and read back the icon each one is drawn with.
interface FakeMarker { title: string; click: () => void; icon?: { url: string; scaledSize: { w: number } }; zIndex?: number; position?: unknown; map?: unknown }
const markers: FakeMarker[] = [];
const fitBounds = vi.fn();
const panTo = vi.fn();
const setZoom = vi.fn();
let mapClick: () => void = () => {};
let mapDragStart: () => void = () => {};
const circles: { radius: number; center: unknown }[] = [];
const fakeMaps = () => {
  class GoogleMap {
    fitBounds = fitBounds; panTo = panTo; setZoom = setZoom;
    getZoom() { return 10; }
    addListener(name: string, fn: () => void) { if (name === 'click') mapClick = fn; if (name === 'dragstart') mapDragStart = fn; }
  }
  class Marker {
    rec: FakeMarker;
    constructor(opts: { title: string; position?: unknown; map?: unknown }) { this.rec = { title: opts.title, click: () => {}, position: opts.position, map: opts.map }; markers.push(this.rec); }
    addListener(_: string, fn: () => void) { this.rec.click = fn; }
    setIcon(icon: FakeMarker['icon']) { this.rec.icon = icon; }
    setZIndex(z?: number) { this.rec.zIndex = z; }
    setPosition(p: unknown) { this.rec.position = p; }
    setMap(m: unknown) { this.rec.map = m; }
  }
  class Circle {
    rec: { radius: number; center: unknown };
    constructor(opts: { radius: number; center: unknown }) { this.rec = { radius: opts.radius, center: opts.center }; circles.push(this.rec); }
    setCenter(c: unknown) { this.rec.center = c; }
    setRadius(r: number) { this.rec.radius = r; }
    setMap() {}
  }
  class LatLngBounds { extend() {} }
  class Size { constructor(public w: number, public h: number) {} }
  class Point { constructor(public x: number, public y: number) {} }
  const ControlPosition = { RIGHT_CENTER: 'RIGHT_CENTER' };
  const libs: Record<string, unknown> = { maps: { Map: GoogleMap, Circle }, marker: { Marker }, core: { LatLngBounds, Size, Point, ControlPosition } };
  return { importLibrary: async (name: string) => libs[name] };
};

const decode = (url: string) => decodeURIComponent(url.split(',')[1]);

beforeEach(() => {
  markers.length = 0;
  fitBounds.mockClear();
  panTo.mockClear();
  setZoom.mockClear();
  circles.length = 0;
  locationCallbacks = null;
  stopWatch.mockClear();
  hasLocationPermission.mockReset().mockResolvedValue(false);
  watchUserLocation.mockReset().mockImplementation((onPosition, onError) => {
    locationCallbacks = { onPosition, onError };
    return stopWatch;
  });
  loadGoogleMaps.mockReset().mockResolvedValue(fakeMaps());
  resolvePlaceLocations.mockReset().mockResolvedValue(new Map([
    ['ChIJtoit000001', { lat: 12.97, lng: 77.64 }],
    ['ChIJarbor00001', { lat: 12.96, lng: 77.6 }],
  ]));
});

describe('PlacesMapSheet', () => {
  it('pins every place and shows a card with Open in Google Maps when a pin is tapped', async () => {
    render(<PlacesMapSheet title="Breweries" places={places} onClose={() => {}} />);
    await waitFor(() => expect(markers).toHaveLength(2));
    expect(resolvePlaceLocations).toHaveBeenCalledWith(['ChIJtoit000001', 'ChIJarbor00001']);
    expect(fitBounds).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link')).toBeNull(); // nothing selected yet

    React.act(() => markers[0].click());
    expect(panTo).toHaveBeenCalledWith({ lat: 12.97, lng: 77.64 });
    const link = screen.getByRole('link', { name: /Open in Google Maps/ });
    expect(link.getAttribute('href')).toBe('https://maps.example/toit');
    expect(screen.getByText('Indiranagar')).toBeTruthy();
    expect(screen.getByText('From Team dinner')).toBeTruthy();

    // Tapping the map dismisses the card.
    React.act(() => mapClick());
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('does not list the places below the map', async () => {
    render(<PlacesMapSheet title="Breweries" places={places} onClose={() => {}} />);
    await waitFor(() => expect(markers).toHaveLength(2));
    expect(screen.queryByText('Arbor Brewing Company')).toBeNull();
  });

  it('turns the tapped badge into a larger selected pin', async () => {
    render(<PlacesMapSheet title="Breweries" places={places} onClose={() => {}} />);
    await waitFor(() => expect(markers[1]?.icon).toBeTruthy());
    const badge = markers[1].icon!;
    expect(markers[1].zIndex).toBeUndefined();

    React.act(() => markers[1].click());
    expect(markers[1].icon!.scaledSize.w).toBeGreaterThan(badge.scaledSize.w);
    expect(markers[1].icon!.url).not.toBe(badge.url);
    expect(markers[1].zIndex).toBe(1000);
    // The other place stays a badge.
    expect(markers[0].icon!.scaledSize.w).toBe(badge.scaledSize.w);
  });

  it('styles pins by category and shows a key', async () => {
    const categorised: MapPlace[] = [
      { ...places[0], category: { key: 'food', label: 'Food & drink', index: 0 } },
      { ...places[1], category: { key: 'travel', label: 'Travel', index: 1 } },
    ];
    render(<PlacesMapSheet title="Breweries" places={categorised} onClose={() => {}} />);
    await waitFor(() => expect(markers[1]?.icon).toBeTruthy());
    const [a, b] = markers.map(m => decode(m.icon!.url));
    expect(a).toContain('#3b82f6');
    expect(b).toContain('#f97316');
    expect(b).toContain('<rect'); // category 1 is a square glyph

    const key = screen.getByRole('list', { name: 'Map key' });
    expect(key.textContent).toContain('Food & drink');
    expect(key.textContent).toContain('Travel');
  });

  it('shows the notes about the selected place and opens one', async () => {
    const note = { id: 'n1', content: 'Great pale ale', timestamp: Date.UTC(2026, 0, 5), tags: [] } as unknown as Memory;
    const onOpenNote = vi.fn();
    render(
      <PlacesMapSheet
        title="Breweries"
        places={[{ ...places[0], noteIds: ['n1'] }, places[1]]}
        notes={new Map([['n1', note]])}
        onOpenNote={onOpenNote}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(markers).toHaveLength(2));
    React.act(() => markers[0].click());
    const card = screen.getByRole('region', { name: 'Toit Brewpub' });
    expect(card.textContent).toContain('Your note');
    fireEvent.click(screen.getByRole('button', { name: /Great pale ale/ }));
    expect(onOpenNote).toHaveBeenCalledWith('n1');
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

  describe('your location', () => {
    const placeMarkers = () => markers.filter(m => m.title !== 'Your location');
    const userMarker = () => markers.find(m => m.title === 'Your location');

    it('does not ask for location until the button is tapped', async () => {
      render(<PlacesMapSheet title="Breweries" places={places} onClose={() => {}} />);
      await waitFor(() => expect(placeMarkers()).toHaveLength(2));
      await waitFor(() => expect(hasLocationPermission).toHaveBeenCalled());
      expect(watchUserLocation).not.toHaveBeenCalled();
      expect(userMarker()).toBeUndefined();
    });

    it('shows the dot straight away when location is already allowed, without moving the map', async () => {
      hasLocationPermission.mockResolvedValue(true);
      render(<PlacesMapSheet title="Breweries" places={places} onClose={() => {}} />);
      await waitFor(() => expect(watchUserLocation).toHaveBeenCalled());
      React.act(() => locationCallbacks!.onPosition({ lat: 1, lng: 2, accuracy: 30 }));
      expect(userMarker()?.position).toEqual({ lat: 1, lng: 2 });
      expect(circles[0]).toEqual({ radius: 30, center: { lat: 1, lng: 2 } });
      expect(panTo).not.toHaveBeenCalled();
    });

    it('centres on the user when the button is tapped, follows them, and stops following on pan', async () => {
      render(<PlacesMapSheet title="Breweries" places={places} onClose={() => {}} />);
      const button = await screen.findByRole('button', { name: 'Show your location' });
      fireEvent.click(button);
      expect(watchUserLocation).toHaveBeenCalledTimes(1);

      React.act(() => locationCallbacks!.onPosition({ lat: 1, lng: 2, accuracy: 30 }));
      expect(panTo).toHaveBeenLastCalledWith({ lat: 1, lng: 2 });
      expect(setZoom).toHaveBeenCalledWith(15);
      expect(screen.getByRole('button', { name: 'Following your location' }).getAttribute('aria-pressed')).toBe('true');

      // Moving: the map follows.
      React.act(() => locationCallbacks!.onPosition({ lat: 1.1, lng: 2.1, accuracy: 10 }));
      expect(panTo).toHaveBeenLastCalledWith({ lat: 1.1, lng: 2.1 });
      expect(userMarker()?.position).toEqual({ lat: 1.1, lng: 2.1 });
      expect(circles).toHaveLength(1);
      expect(circles[0].radius).toBe(10);

      // Panning away stops following; further fixes only move the dot.
      React.act(() => mapDragStart());
      panTo.mockClear();
      React.act(() => locationCallbacks!.onPosition({ lat: 1.2, lng: 2.2, accuracy: 10 }));
      expect(panTo).not.toHaveBeenCalled();

      // Tapping again goes back to the user, without starting a second watch.
      fireEvent.click(screen.getByRole('button', { name: 'Show your location' }));
      expect(panTo).toHaveBeenLastCalledWith({ lat: 1.2, lng: 2.2 });
      expect(watchUserLocation).toHaveBeenCalledTimes(1);
    });

    it('explains when location access is denied', async () => {
      render(<PlacesMapSheet title="Breweries" places={places} onClose={() => {}} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Show your location' }));
      React.act(() => locationCallbacks!.onError('denied'));
      expect(screen.getByText(/Location access is off/)).toBeTruthy();
      expect(stopWatch).toHaveBeenCalled();
    });

    it('stops watching when the map closes', async () => {
      hasLocationPermission.mockResolvedValue(true);
      const { unmount } = render(<PlacesMapSheet title="Breweries" places={places} onClose={() => {}} />);
      await waitFor(() => expect(watchUserLocation).toHaveBeenCalled());
      unmount();
      expect(stopWatch).toHaveBeenCalled();
    });
  });
});
