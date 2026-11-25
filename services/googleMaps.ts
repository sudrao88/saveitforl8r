/**
 * googleMaps.ts
 *
 * Lazy loader for the Google Maps JavaScript SDK, and placeId → position
 * lookup. The SDK script is only requested the first time a map is opened, so
 * the app pays for a map load only when the user asks for one.
 *
 * Positions come from Place Details (the `location` field only). They are
 * cached on the device for 30 days, the longest Google's terms allow
 * coordinates to be kept; place IDs themselves may be stored indefinitely.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const API_KEY: string | undefined = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

/** True when the build has a Maps API key, so map buttons can be shown. */
export const isMapsConfigured = (): boolean => !!API_KEY;

let loadPromise: Promise<typeof google.maps> | null = null;

/** Loads the SDK once. Rejects if there is no key or the script can't load. */
export const loadGoogleMaps = (): Promise<typeof google.maps> => {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise<typeof google.maps>((resolve, reject) => {
    if (!API_KEY) {
      reject(new Error('Google Maps API key is not configured'));
      return;
    }
    if (typeof window.google?.maps?.importLibrary === 'function') {
      resolve(window.google.maps);
      return;
    }
    const callback = '__l8rMapsReady';
    const script = document.createElement('script');
    (window as unknown as Record<string, unknown>)[callback] = () => {
      delete (window as unknown as Record<string, unknown>)[callback];
      resolve(window.google.maps);
    };
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(API_KEY)}&v=weekly&loading=async&callback=${callback}`;
    script.async = true;
    script.onerror = () => {
      script.remove();
      reject(new Error('Google Maps failed to load'));
    };
    document.head.appendChild(script);
  }).catch((err) => {
    loadPromise = null; // allow a retry (e.g. after coming back online)
    throw err;
  });
  return loadPromise;
};

// ─── placeId → position ─────────────────────────────────────

export const PLACE_LOCATION_CACHE_KEY = 'maps:placeLocations';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type CacheEntry = LatLng & { t: number };

const readCache = (): Record<string, CacheEntry> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLACE_LOCATION_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeCache = (cache: Record<string, CacheEntry>) => {
  try {
    localStorage.setItem(PLACE_LOCATION_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage unavailable: positions are just looked up again next time.
  }
};

/**
 * Resolves place IDs to positions. Places that can't be resolved (deleted
 * place, lookup failure) are simply absent from the result.
 */
export const resolvePlaceLocations = async (placeIds: string[]): Promise<Map<string, LatLng>> => {
  const now = Date.now();
  const cache = readCache();
  // Drop expired entries so coordinates are never kept past 30 days.
  for (const id of Object.keys(cache)) {
    if (!cache[id] || now - cache[id].t > CACHE_TTL_MS) delete cache[id];
  }

  const out = new Map<string, LatLng>();
  const missing: string[] = [];
  for (const id of new Set(placeIds)) {
    const hit = cache[id];
    if (hit) out.set(id, { lat: hit.lat, lng: hit.lng });
    else missing.push(id);
  }

  if (missing.length > 0) {
    const maps = await loadGoogleMaps();
    const { Place } = (await maps.importLibrary('places')) as google.maps.PlacesLibrary;
    await Promise.all(
      missing.map(async (id) => {
        try {
          const place = new Place({ id });
          await place.fetchFields({ fields: ['location'] });
          if (!place.location) return;
          const pos = { lat: place.location.lat(), lng: place.location.lng() };
          out.set(id, pos);
          cache[id] = { ...pos, t: now };
        } catch (err) {
          console.warn('[Maps] Could not resolve place', id, err);
        }
      }),
    );
  }

  writeCache(cache);
  return out;
};
