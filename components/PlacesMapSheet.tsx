/**
 * PlacesMapSheet.tsx
 *
 * Full-screen Google Map with one pin per place. Used for a moment (every
 * place its notes mention) and for a single note that mentions several places.
 *
 * Works like Google Maps: places are small round badges, coloured and shaped
 * by the moment subsection they belong to (with a legend when there is more
 * than one; tapping a legend entry shows only that group's places, tapping it
 * again shows them all). Tapping a badge turns it into a larger pin and slides up a card
 * with the place and the notes that mention it; tapping the map dismisses it.
 *
 * The Maps SDK is loaded on demand (services/googleMaps), and each placeId is
 * resolved to a position when the sheet opens.
 *
 * The user's own position shows as a blue dot with an accuracy halo. If
 * location is already allowed it appears straight away; otherwise the
 * "my location" button asks for it. That button re-centres on the user and
 * follows them until they pan the map away, like Google Maps.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { X, Loader2, MapPin, ExternalLink, CloudOff, RefreshCw, Locate, LocateFixed, LocateOff } from 'lucide-react';
import { overlay, btn, card, chip, text, zIndex } from '../styles/design-system';
import { useBackButton } from '../hooks/useBackButton';
import { loadGoogleMaps, resolvePlaceLocations } from '../services/googleMaps';
import { MapCategory, MapPlace } from '../utils/mapPlaces';
import { markerIcon, markerStyle, userLocationColor, userLocationIcon } from '../utils/mapMarkers';
import { hasLocationPermission, watchUserLocation, LocationError, UserPosition } from '../services/userLocation';
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
/** off: not watching; locating: waiting for a first fix; on: dot shown. */
type LocationStatus = 'off' | 'locating' | 'on';

const SINGLE_PLACE_ZOOM = 15;
/** Zoom the "my location" button goes to when the map is further out. */
const USER_LOCATION_ZOOM = 15;
/** Selected pin draws above every badge. */
const SELECTED_Z = 1000;
/** The user's dot draws above place badges, below the selected pin. */
const USER_Z = SELECTED_Z - 1;

const categoryIndex = (category?: MapCategory) => category?.index ?? 0;
const inFilter = (place: MapPlace, filterKey: string | null) => !filterKey || place.category?.key === filterKey;

const PlacesMapSheet: React.FC<PlacesMapSheetProps> = ({ title, places, onClose, notes, onOpenNote, children }) => {
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const coreRef = useRef<google.maps.CoreLibrary | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);
  const [shownIds, setShownIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const positionsRef = useRef<Map<string, google.maps.LatLngLiteral>>(new Map());
  /** Legend filter: only places in this category are shown (null: all). */
  const [filterKey, setFilterKey] = useState<string | null>(null);

  // ── The user's own position ──
  const markerClassRef = useRef<typeof google.maps.Marker | null>(null);
  const circleClassRef = useRef<typeof google.maps.Circle | null>(null);
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const userHaloRef = useRef<google.maps.Circle | null>(null);
  const userPosRef = useRef<UserPosition | null>(null);
  const stopWatchRef = useRef<(() => void) | null>(null);
  /** While true, the map keeps the user in the centre as they move. */
  const followRef = useRef(false);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('off');
  const [locationError, setLocationError] = useState<LocationError | null>(null);
  const [following, setFollowing] = useState(false);

  const setFollow = (value: boolean) => {
    followRef.current = value;
    setFollowing(value);
  };

  const centreOnUser = (pos: UserPosition) => {
    const map = mapRef.current;
    if (!map) return;
    map.panTo({ lat: pos.lat, lng: pos.lng });
    if ((map.getZoom() ?? 0) < USER_LOCATION_ZOOM) map.setZoom(USER_LOCATION_ZOOM);
  };

  const drawUser = (pos: UserPosition) => {
    const map = mapRef.current;
    const core = coreRef.current;
    const Marker = markerClassRef.current;
    const Circle = circleClassRef.current;
    if (!map || !core || !Marker || !Circle) return;
    const position = { lat: pos.lat, lng: pos.lng };
    if (!userMarkerRef.current) {
      const icon = userLocationIcon();
      userMarkerRef.current = new Marker({
        map,
        position,
        title: 'Your location',
        clickable: false,
        zIndex: USER_Z,
        icon: {
          url: icon.url,
          scaledSize: new core.Size(icon.width, icon.height),
          anchor: new core.Point(icon.anchorX, icon.anchorY),
        },
      });
      const color = userLocationColor();
      userHaloRef.current = new Circle({
        map,
        center: position,
        radius: pos.accuracy,
        clickable: false,
        strokeColor: color,
        strokeOpacity: 0.4,
        strokeWeight: 1,
        fillColor: color,
        fillOpacity: 0.15,
      });
    } else {
      userMarkerRef.current.setPosition(position);
      userHaloRef.current?.setCenter(position);
      userHaloRef.current?.setRadius(pos.accuracy);
    }
  };

  const stopWatching = () => {
    stopWatchRef.current?.();
    stopWatchRef.current = null;
    userMarkerRef.current?.setMap(null);
    userMarkerRef.current = null;
    userHaloRef.current?.setMap(null);
    userHaloRef.current = null;
    userPosRef.current = null;
    followRef.current = false;
  };

  /** Starts showing the user's dot; `centre` moves the map to the first fix. */
  const startWatching = (centre: boolean) => {
    if (stopWatchRef.current) return;
    setLocationError(null);
    setLocationStatus('locating');
    let first = true;
    stopWatchRef.current = watchUserLocation(
      pos => {
        userPosRef.current = pos;
        setLocationStatus('on');
        drawUser(pos);
        if ((first && centre) || followRef.current) centreOnUser(pos);
        first = false;
      },
      err => {
        // A fix already on screen stays; a later hiccup isn't worth a warning.
        if (userPosRef.current && err === 'unavailable') return;
        stopWatching();
        setFollow(false);
        setLocationStatus('off');
        setLocationError(err);
      },
    );
  };

  const onLocateClick = () => {
    const pos = userPosRef.current;
    setFollow(true);
    if (pos) centreOnUser(pos);
    else startWatching(true);
  };

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
        const [{ Map: GoogleMap, Circle }, { Marker }, core] = await Promise.all([
          maps.importLibrary('maps') as Promise<google.maps.MapsLibrary>,
          maps.importLibrary('marker') as Promise<google.maps.MarkerLibrary>,
          maps.importLibrary('core') as Promise<google.maps.CoreLibrary>,
        ]);
        const positions = await resolvePlaceLocations(current.map(p => p.placeId));
        if (cancelled || !mapElRef.current) return;
        if (positions.size === 0) throw new Error('No places could be located');
        coreRef.current = core;
        positionsRef.current = positions;
        markerClassRef.current = Marker;
        circleClassRef.current = Circle;

        const map = new GoogleMap(mapElRef.current, {
          center: positions.values().next().value,
          zoom: SINGLE_PLACE_ZOOM,
          colorScheme: 'DARK',
          disableDefaultUI: true,
          zoomControl: true,
          // Bottom right is the "my location" button's, as in Google Maps.
          zoomControlOptions: { position: core.ControlPosition.RIGHT_CENTER },
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
        // Moving the map by hand stops following the user.
        map.addListener('dragstart', () => {
          if (followRef.current) setFollow(false);
        });

        setShownIds(new Set(positions.keys()));
        setSelectedId(positions.size === 1 ? [...positions.keys()][0] : null);
        setStatus('ready');

        // Show where the user is without prompting, if they already allowed it.
        if (await hasLocationPermission() && !cancelled) startWatching(false);
      } catch (err) {
        console.warn('[Maps] Could not show the map:', err);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      stopWatching();
      setLocationStatus('off');
      setFollow(false);
      markers.forEach(m => m.setMap(null));
      markers.clear();
      mapRef.current = null;
      setFilterKey(null);
    };
    // startWatching/stopWatching only touch refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Legend filter: hide the other groups' places.
  useEffect(() => {
    if (status !== 'ready') return;
    for (const place of placesRef.current) {
      markersRef.current.get(place.placeId)?.setVisible(inFilter(place, filterKey));
    }
  }, [status, filterKey, categoryKey]);

  /** Shows only one group's places (or all again), and frames them. */
  const toggleFilter = (key: string) => {
    const next = filterKey === key ? null : key;
    setFilterKey(next);
    const visible = places.filter(p => inFilter(p, next) && positionsRef.current.has(p.placeId));
    if (selectedId && !visible.some(p => p.placeId === selectedId)) setSelectedId(null);
    const map = mapRef.current;
    const core = coreRef.current;
    if (!map || !core || visible.length === 0) return;
    setFollow(false);
    if (visible.length === 1) {
      map.panTo(positionsRef.current.get(visible[0].placeId)!);
      map.setZoom(SINGLE_PLACE_ZOOM);
      return;
    }
    const bounds = new core.LatLngBounds();
    for (const p of visible) bounds.extend(positionsRef.current.get(p.placeId)!);
    map.fitBounds(bounds, 64);
  };

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

        {status === 'ready' && (legend.length > 0 || missingCount > 0 || locationError) && (
          <div className={`absolute top-0 inset-x-0 ${zIndex.sticky} p-3 space-y-2 pointer-events-none`}>
            {legend.length > 0 && (
              // Chips size to their full names and scroll edge to edge with no
              // scrollbar, as in Google Maps.
              <ul
                className="flex gap-2 overflow-x-auto no-scrollbar touch-pan-x -mx-3 -my-1 py-1 pl-3 [&>li:last-child]:mr-3 pointer-events-auto"
                aria-label="Map key"
              >
                {legend.map(({ category, count }) => {
                  const active = filterKey === category.key;
                  return (
                    <li key={category.key} className="shrink-0">
                      <button
                        onClick={() => toggleFilter(category.key)}
                        aria-pressed={active}
                        aria-label={`${active ? 'Show all places' : `Show only ${category.label}`} (${count})`}
                        className={`${chip.base} ${active ? chip.active : chip.inactive} pl-1 whitespace-nowrap shadow-lg`}
                      >
                        <img src={markerIcon(markerStyle(category.index), false).url} alt="" className="w-5 h-5 shrink-0" />
                        <span className="uppercase tracking-wide">{category.label}</span>
                        <span className="font-medium opacity-70">{count}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {missingCount > 0 && (
              <p className="inline-block px-3 py-1 rounded-(--radius-full) bg-(--color-surface-overlay)/90 text-xs text-(--color-text-secondary) shadow-lg">
                {missingCount} {missingCount === 1 ? 'place' : 'places'} couldn’t be located on the map.
              </p>
            )}
            {locationError && (
              <p role="status" className="block w-fit px-3 py-1 rounded-(--radius-full) bg-(--color-surface-overlay)/90 text-xs text-(--color-text-secondary) shadow-lg">
                {locationError === 'denied'
                  ? 'Location access is off. Allow it in your settings to see where you are.'
                  : 'Couldn’t find your location. Try again in a moment.'}
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

        {status === 'ready' && (
          <div
            className={`absolute inset-x-0 bottom-0 ${zIndex.sticky} p-3 pb-[calc(0.75rem+var(--sab))] flex flex-col gap-3 pointer-events-none`}
          >
            <div className="flex justify-end pointer-events-auto self-end">
              <button
                onClick={onLocateClick}
                className={`${btn.base} ${following ? btn.floatingActive : btn.floating}`}
                aria-label={following ? 'Following your location' : 'Show your location'}
                aria-pressed={following}
                title="Your location"
              >
                {locationStatus === 'locating' ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : locationError ? (
                  <LocateOff size={20} />
                ) : following ? (
                  <LocateFixed size={20} />
                ) : (
                  <Locate size={20} />
                )}
              </button>
            </div>
            {selected && (
              <section
                key={selected.placeId}
                aria-label={selected.name}
                className="pointer-events-auto animate-in slide-in-from-bottom-4 fade-in duration-(--duration-normal)"
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
