/**
 * PlacesMapSheet.tsx
 *
 * Full-screen Google Map with one pin per place. Used for a moment (every
 * place its notes mention) and for a single note that mentions several places.
 *
 * Works like Google Maps: places are small round badges, coloured and shaped
 * by the moment subsection they belong to (with a legend when there is more
 * than one). Tapping a badge turns it into a larger pin and slides up a card
 * with the place and the notes that mention it; tapping the map dismisses it.
 *
 * The Maps SDK is loaded on demand (services/googleMaps), and each placeId is
 * resolved to a position when the sheet opens.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { X, Loader2, MapPin, ExternalLink, CloudOff, RefreshCw } from 'lucide-react';
import { overlay, btn, card, text, zIndex } from '../styles/design-system';
import { useBackButton } from '../hooks/useBackButton';
import { loadGoogleMaps, resolvePlaceLocations } from '../services/googleMaps';
import { MapCategory, MapPlace } from '../utils/mapPlaces';
import { markerIcon, markerStyle } from '../utils/mapMarkers';
import { noteTitle, noteSnippet, formatNoteDate } from '../utils/noteLabels';
import { Memory } from '../types';

interface PlacesMapSheetProps {
  title: string;
  places: MapPlace[];
  onClose: () => void;
  /** Notes by id, so the selected place's card can show the notes about it. */
  notes?: ReadonlyMap<string, Memory>;
  /** Called when a note in the selected place's card is tapped. */
  onOpenNote?: (noteId: string) => void;
  /** Rendered above the map (e.g. a note preview opened from the card). */
  children?: React.ReactNode;
}

type Status = 'loading' | 'ready' | 'error';

const SINGLE_PLACE_ZOOM = 15;
/** Selected pin draws above every badge. */
const SELECTED_Z = 1000;

const categoryIndex = (category?: MapCategory) => category?.index ?? 0;

const PlacesMapSheet: React.FC<PlacesMapSheetProps> = ({ title, places, onClose, notes, onOpenNote, children }) => {
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const coreRef = useRef<google.maps.CoreLibrary | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);
  const [shownIds, setShownIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useBackButton(onClose, true);
  // Back first dismisses the place card, like Google Maps.
  useBackButton(() => setSelectedId(null), selectedId !== null && shownIds.size > 1);

  // Pins are keyed by the set of place IDs, not the array identity, so a
  // parent re-render doesn't rebuild the map.
  const placesRef = useRef(places);
  placesRef.current = places;
  const placeKey = places.map(p => p.placeId).join('|');
  // Marker looks depend on each place's category and on the selection.
  const categoryKey = places.map(p => `${p.placeId}:${categoryIndex(p.category)}`).join('|');

  useEffect(() => {
    let cancelled = false;
    const markers = markersRef.current;
    setStatus('loading');

    (async () => {
      try {
        const current = placesRef.current;
        const maps = await loadGoogleMaps();
        const [{ Map: GoogleMap }, { Marker }, core] = await Promise.all([
          maps.importLibrary('maps') as Promise<google.maps.MapsLibrary>,
          maps.importLibrary('marker') as Promise<google.maps.MarkerLibrary>,
          maps.importLibrary('core') as Promise<google.maps.CoreLibrary>,
        ]);
        const positions = await resolvePlaceLocations(current.map(p => p.placeId));
        if (cancelled || !mapElRef.current) return;
        if (positions.size === 0) throw new Error('No places could be located');
        coreRef.current = core;

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

        const bounds = new core.LatLngBounds();
        for (const place of current) {
          const position = positions.get(place.placeId);
          if (!position) continue;
          bounds.extend(position);
          const marker = new Marker({ map, position, title: place.name });
          marker.addListener('click', () => {
            setSelectedId(place.placeId);
            map.panTo(position);
          });
          markers.set(place.placeId, marker);
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
      markers.clear();
      mapRef.current = null;
    };
  }, [placeKey, attempt]);

  // Badge for every place, a pin for the selected one.
  useEffect(() => {
    const core = coreRef.current;
    if (status !== 'ready' || !core) return;
    for (const place of placesRef.current) {
      const marker = markersRef.current.get(place.placeId);
      if (!marker) continue;
      const selected = place.placeId === selectedId;
      const icon = markerIcon(markerStyle(categoryIndex(place.category)), selected);
      marker.setIcon({
        url: icon.url,
        scaledSize: new core.Size(icon.width, icon.height),
        anchor: new core.Point(icon.anchorX, icon.anchorY),
      });
      marker.setZIndex(selected ? SELECTED_Z : undefined);
    }
  }, [status, selectedId, categoryKey]);

  const shown = places.filter(p => shownIds.has(p.placeId));
  const selected = shown.find(p => p.placeId === selectedId);
  const missingCount = status === 'ready' ? places.length - shown.length : 0;

  // Legend: the categories on the map, in section order, "Other" last.
  const legend = (() => {
    const byKey = new Map<string, { category: MapCategory; count: number }>();
    for (const place of shown) {
      if (!place.category) continue;
      const entry = byKey.get(place.category.key);
      if (entry) entry.count++;
      else byKey.set(place.category.key, { category: place.category, count: 1 });
    }
    const order = (c: MapCategory) => (c.index < 0 ? Number.MAX_SAFE_INTEGER : c.index);
    const entries = [...byKey.values()].sort((a, b) => order(a.category) - order(b.category));
    return entries.length > 1 ? entries : [];
  })();

  const selectedNotes = useMemo(() => {
    if (!selected || !notes) return [];
    return (selected.noteIds ?? []).map(id => notes.get(id)).filter((m): m is Memory => !!m && !m.isDeleted);
  }, [selected, notes]);

  const selectedIcon = selected && markerIcon(markerStyle(categoryIndex(selected.category)), false);

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

        {status === 'ready' && (legend.length > 0 || missingCount > 0) && (
          <div className={`absolute top-0 inset-x-0 ${zIndex.sticky} p-3 space-y-2 pointer-events-none`}>
            {legend.length > 0 && (
              <ul className="flex gap-2 overflow-x-auto pointer-events-auto" aria-label="Map key">
                {legend.map(({ category, count }) => (
                  <li
                    key={category.key}
                    className="flex items-center gap-1.5 shrink-0 max-w-48 pl-1 pr-3 py-1 rounded-(--radius-full) bg-(--color-surface-overlay)/90 border border-(--color-border-default) shadow-lg"
                  >
                    <img src={markerIcon(markerStyle(category.index), false).url} alt="" className="w-5 h-5 shrink-0" />
                    <span className="text-xs text-(--color-text-primary) truncate">{category.label}</span>
                    <span className="text-xs text-(--color-text-tertiary) shrink-0">{count}</span>
                  </li>
                ))}
              </ul>
            )}
            {missingCount > 0 && (
              <p className="inline-block px-3 py-1 rounded-(--radius-full) bg-(--color-surface-overlay)/90 text-xs text-(--color-text-secondary) shadow-lg">
                {missingCount} {missingCount === 1 ? 'place' : 'places'} couldn’t be located on the map.
              </p>
            )}
          </div>
        )}

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

        {selected && status === 'ready' && (
          <section
            key={selected.placeId}
            aria-label={selected.name}
            className={`absolute inset-x-0 bottom-0 ${zIndex.sticky} p-3 pb-[calc(0.75rem+var(--sab))] animate-in slide-in-from-bottom-4 fade-in duration-(--duration-normal)`}
          >
            <div className={`${overlay.modal} max-w-2xl mx-auto max-h-[55vh] flex flex-col`}>
              <div className="flex items-start gap-3 p-4 pb-3">
                {selectedIcon && <img src={selectedIcon.url} alt="" className="w-6 h-6 mt-0.5 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-(--color-text-primary) line-clamp-2">{selected.name}</h3>
                  {selected.address && (
                    <p className="text-xs text-(--color-text-secondary) mt-0.5 line-clamp-2">{selected.address}</p>
                  )}
                  {selected.category && legend.length > 0 && (
                    <p className={`${text.caption} mt-1 truncate`}>{selected.category.label}</p>
                  )}
                </div>
                {shown.length > 1 && (
                  <button
                    onClick={() => setSelectedId(null)}
                    className={`${overlay.closeBtnRight} shrink-0`}
                    aria-label="Close place"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
              <div className="px-4 pb-3">
                <a
                  href={selected.mapsUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${btn.base} ${btn.primarySm} gap-1.5`}
                >
                  <ExternalLink size={14} />
                  <span>Open in <span translate="no">Google Maps</span></span>
                </a>
              </div>
              {selectedNotes.length > 0 ? (
                <div className="border-t border-(--color-border-default) overflow-y-auto min-h-0 p-3 space-y-2">
                  <p className={`${text.caption} px-1`}>
                    {selectedNotes.length === 1 ? 'Your note' : `Your notes (${selectedNotes.length})`}
                  </p>
                  <ul className="space-y-2">
                    {selectedNotes.map(note => {
                      const snippet = noteSnippet(note);
                      const body = (
                        <>
                          <p className="text-sm font-medium text-(--color-text-primary) line-clamp-2">{noteTitle(note)}</p>
                          {snippet && <p className="text-xs text-(--color-text-secondary) mt-0.5 line-clamp-3">{snippet}</p>}
                          <p className={`${text.caption} mt-1`}>{formatNoteDate(note.timestamp)}</p>
                        </>
                      );
                      return (
                        <li key={note.id}>
                          {onOpenNote ? (
                            <button onClick={() => onOpenNote(note.id)} className={`${card.interactive} w-full text-left p-3`}>
                              {body}
                            </button>
                          ) : (
                            <div className={`${card.base} p-3`}>{body}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                !notes && selected.noteTitles && selected.noteTitles.length > 0 && (
                  <p className={`${text.caption} px-4 pb-4 truncate`}>From {selected.noteTitles.join(', ')}</p>
                )
              )}
            </div>
          </section>
        )}
      </div>

      {status === 'error' && (
        <div className="shrink-0 border-t border-(--color-border-default) p-3 pb-[calc(0.75rem+var(--sab))]">
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
        </div>
      )}

      {children}
    </div>
  );

  return ReactDOM.createPortal(sheet, document.body);
};

export default PlacesMapSheet;
