/**
 * PlacesMapSheet.tsx
 *
 * Full-screen Google Map with one pin per place. Used for a moment (every
 * place its notes mention) and for a single note that mentions several places.
 * Tapping a pin, or a place in the strip below the map, shows the place with
 * an "Open in Google Maps" link.
 *
 * The Maps SDK is loaded on demand (services/googleMaps), and each placeId is
 * resolved to a position when the sheet opens.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { X, Loader2, MapPin, ExternalLink, CloudOff, RefreshCw } from 'lucide-react';
import { overlay, btn, chip, card, text, zIndex } from '../styles/design-system';
import { useBackButton } from '../hooks/useBackButton';
import { loadGoogleMaps, resolvePlaceLocations } from '../services/googleMaps';
import { MapPlace } from '../utils/mapPlaces';

interface PlacesMapSheetProps {
  title: string;
  places: MapPlace[];
  onClose: () => void;
}

type Status = 'loading' | 'ready' | 'error';

const SINGLE_PLACE_ZOOM = 15;

const PlacesMapSheet: React.FC<PlacesMapSheetProps> = ({ title, places, onClose }) => {
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const positionsRef = useRef<Map<string, google.maps.LatLngLiteral>>(new Map());
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);
  const [shownIds, setShownIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useBackButton(onClose, true);

  // Pins are keyed by the set of place IDs, not the array identity, so a
  // parent re-render doesn't rebuild the map.
  const placesRef = useRef(places);
  placesRef.current = places;
  const placeKey = places.map(p => p.placeId).join('|');

  useEffect(() => {
    let cancelled = false;
    const markers: google.maps.Marker[] = [];
    setStatus('loading');

    (async () => {
      try {
        const current = placesRef.current;
        const maps = await loadGoogleMaps();
        const [{ Map: GoogleMap }, { Marker }, { LatLngBounds }] = await Promise.all([
          maps.importLibrary('maps') as Promise<google.maps.MapsLibrary>,
          maps.importLibrary('marker') as Promise<google.maps.MarkerLibrary>,
          maps.importLibrary('core') as Promise<google.maps.CoreLibrary>,
        ]);
        const positions = await resolvePlaceLocations(current.map(p => p.placeId));
        if (cancelled || !mapElRef.current) return;
        if (positions.size === 0) throw new Error('No places could be located');

        const map = new GoogleMap(mapElRef.current, {
          center: positions.values().next().value,
          zoom: SINGLE_PLACE_ZOOM,
          colorScheme: 'DARK',
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });
        mapRef.current = map;
        positionsRef.current = positions;

        const bounds = new LatLngBounds();
        for (const place of current) {
          const position = positions.get(place.placeId);
          if (!position) continue;
          bounds.extend(position);
          const marker = new Marker({ map, position, title: place.name });
          marker.addListener('click', () => setSelectedId(place.placeId));
          markers.push(marker);
        }
        if (positions.size > 1) map.fitBounds(bounds, 64);
        map.addListener('click', () => setSelectedId(null));

        setShownIds(new Set(positions.keys()));
        setSelectedId(positions.size === 1 ? [...positions.keys()][0] : null);
        setStatus('ready');
      } catch (err) {
        console.warn('[Maps] Could not show the map:', err);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      markers.forEach(m => m.setMap(null));
      mapRef.current = null;
    };
  }, [placeKey, attempt]);

  const handleSelect = useCallback((placeId: string) => {
    setSelectedId(placeId);
    const position = positionsRef.current.get(placeId);
    if (position) mapRef.current?.panTo(position);
  }, []);

  const shown = places.filter(p => shownIds.has(p.placeId));
  const selected = shown.find(p => p.placeId === selectedId);
  const missingCount = status === 'ready' ? places.length - shown.length : 0;

  const sheet = (
    <div
      className={`fixed inset-0 ${zIndex.nestedModal} bg-(--color-surface-overlay) flex flex-col animate-in fade-in duration-(--duration-normal)`}
      role="dialog"
      aria-label={`Map: ${title}`}
      onClick={e => e.stopPropagation()}
    >
      <div className={overlay.sheetHeader}>
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onClose} className={overlay.closeBtn} aria-label="Close map">
            <X size={24} />
          </button>
          <h2 className="text-lg font-bold text-(--color-text-primary) truncate min-w-0">{title}</h2>
        </div>
        <span className="text-xs text-(--color-text-tertiary) shrink-0">
          {places.length} {places.length === 1 ? 'place' : 'places'}
        </span>
      </div>

      <div className="relative flex-1 min-h-0">
        <div ref={mapElRef} className="absolute inset-0" data-testid="places-map" />
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-(--color-surface-overlay)">
            <Loader2 size={32} className="animate-spin text-(--color-accent)" aria-label="Loading map" />
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 bg-(--color-surface-overlay)">
            <CloudOff size={32} className="text-(--color-warning) mb-4" />
            <h3 className="text-lg font-bold text-(--color-text-primary) mb-2">Couldn’t load the map</h3>
            <p className={`${text.body} mb-4`}>Check your connection and try again. You can still open each place in Google Maps below.</p>
            <button onClick={() => setAttempt(a => a + 1)} className={btn.outlinedSm}>
              <RefreshCw size={14} />
              Try again
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-(--color-border-default) p-3 pb-[calc(0.75rem+var(--sab))] space-y-3">
        {selected && (
          <div className={`${card.base} p-3 flex items-center gap-3`}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-(--color-text-primary) truncate">{selected.name}</p>
              {selected.address && (
                <p className="text-xs text-(--color-text-secondary) mt-0.5 line-clamp-2">{selected.address}</p>
              )}
              {selected.noteTitles && selected.noteTitles.length > 0 && (
                <p className={`${text.caption} mt-1 truncate`}>From {selected.noteTitles.join(', ')}</p>
              )}
            </div>
            <a
              href={selected.mapsUri}
              target="_blank"
              rel="noopener noreferrer"
              className={`${btn.base} ${btn.primarySm} gap-1.5 shrink-0`}
            >
              <ExternalLink size={14} />
              <span>Open in <span translate="no">Google Maps</span></span>
            </a>
          </div>
        )}
        {status === 'error' ? (
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {places.map(place => (
              <li key={place.placeId}>
                <a
                  href={place.mapsUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-(--radius-lg) text-xs text-(--color-text-secondary) hover:text-(--color-text-primary) hover:bg-(--color-surface-hover-subtle) transition-colors"
                >
                  <MapPin size={14} className="shrink-0" />
                  <span className="truncate">{place.name}</span>
                  <span className="shrink-0 text-(--color-text-tertiary)" aria-hidden="true">·</span>
                  <span translate="no" className="shrink-0 whitespace-nowrap text-(--color-text-primary)">Google Maps</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          shown.length > 1 && (
            <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Places on this map">
              {shown.map(place => (
                <button
                  key={place.placeId}
                  onClick={() => handleSelect(place.placeId)}
                  aria-pressed={selectedId === place.placeId}
                  className={`${chip.base} ${selectedId === place.placeId ? chip.active : chip.inactive} shrink-0 max-w-48`}
                >
                  <span className="truncate">{place.name}</span>
                </button>
              ))}
            </div>
          )
        )}
        {missingCount > 0 && (
          <p className={text.caption}>
            {missingCount} {missingCount === 1 ? 'place' : 'places'} couldn’t be located on the map.
          </p>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(sheet, document.body);
};

export default PlacesMapSheet;
