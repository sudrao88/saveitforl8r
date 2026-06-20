import { isNative } from '../services/platform';

export interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

// Module-level cache of an in-flight (or recently resolved) location lookup.
// Lets us start fetching the device location as soon as the user focuses the
// note editor and reuse that result at save time, instead of blocking the save.
let pendingLocation: Promise<GeoLocation | undefined> | null = null;
let pendingLocationAt = 0;

// How long a prefetched location is considered fresh. Focus → save is usually
// only seconds apart, so this mainly de-dupes repeated focus events and shares
// a single lookup across the quick-note bar and the expanded full-page editor.
const LOCATION_TTL_MS = 60_000;

// Soft timeout: give up waiting after this long so a slow GPS fix never blocks
// a save. Matches the original inline behaviour.
const LOOKUP_TIMEOUT_MS = 3000;

// Races a location lookup against the soft timeout. Both inputs resolve (never
// reject) to a location or `undefined`, so the loser settling later can never
// produce an unhandled rejection.
function withTimeout(lookup: Promise<GeoLocation | undefined>): Promise<GeoLocation | undefined> {
  return Promise.race([
    lookup,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), LOOKUP_TIMEOUT_MS)),
  ]);
}

// Performs the actual platform geolocation lookup. Always resolves (to a
// location or `undefined`) rather than rejecting, so callers never have to
// guard against location errors.
async function getCurrentLocation(): Promise<GeoLocation | undefined> {
  if (isNative()) {
    // Use the Capacitor Geolocation plugin on native to trigger the iOS
    // "While Using App" permission dialog and access native GPS.
    const { Geolocation } = await import('@capacitor/geolocation');
    const lookup = Geolocation.getCurrentPosition({ timeout: 5000 })
      .then((pos): GeoLocation => ({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }))
      .catch((e): undefined => {
        console.warn('Location access denied or unavailable', e);
        return undefined;
      });
    return withTimeout(lookup);
  }
  if (navigator.geolocation) {
    const lookup = new Promise<GeoLocation | undefined>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        (e) => {
          console.warn('Location access denied or unavailable', e);
          resolve(undefined);
        },
        { timeout: 5000 },
      );
    });
    return withTimeout(lookup);
  }
  return undefined;
}

// Starts a fresh lookup and caches it. Failed lookups (resolving to
// `undefined`) are evicted once settled so the next focus or save retries
// instead of being stuck with a cached miss for the whole TTL window.
function startLookup(): Promise<GeoLocation | undefined> {
  pendingLocationAt = Date.now();
  const lookup = getCurrentLocation();
  pendingLocation = lookup;
  void lookup.then((loc) => {
    if (loc === undefined && pendingLocation === lookup) {
      pendingLocation = null;
      pendingLocationAt = 0;
    }
  });
  return lookup;
}

function isFresh(): boolean {
  return pendingLocation !== null && Date.now() - pendingLocationAt < LOCATION_TTL_MS;
}

// Begin fetching the device location ahead of time — e.g. when the user focuses
// the note editor — so it's ready by the time the note is saved. Safe to call
// repeatedly; an in-flight or recently resolved lookup is reused.
export function prefetchLocation(): void {
  if (isFresh()) return;
  startLookup();
}

// Resolve the location to attach to a note. Returns the prefetched lookup when
// one is available, otherwise performs a fresh lookup on demand.
export function resolveLocation(): Promise<GeoLocation | undefined> {
  return isFresh() ? pendingLocation! : startLookup();
}
