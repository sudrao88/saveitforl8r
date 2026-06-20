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

// Performs the actual platform geolocation lookup. Resolves to `undefined`
// rather than rejecting so callers never have to guard against location errors.
async function getCurrentLocation(): Promise<GeoLocation | undefined> {
  try {
    if (isNative()) {
      // Use the Capacitor Geolocation plugin on native to trigger the iOS
      // "While Using App" permission dialog and access native GPS.
      const { Geolocation } = await import('@capacitor/geolocation');
      const pos = await Promise.race([
        Geolocation.getCurrentPosition({ timeout: 5000 }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      if (pos) {
        return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy };
      }
    } else if (navigator.geolocation) {
      const pos = (await Promise.race([
        new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ])) as GeolocationPosition | null;
      if (pos) {
        return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy };
      }
    }
  } catch (e) {
    console.warn('Location access denied or unavailable', e);
  }
  return undefined;
}

// Begin fetching the device location ahead of time — e.g. when the user focuses
// the note editor — so it's ready by the time the note is saved. Safe to call
// repeatedly; an in-flight or recently resolved lookup is reused.
export function prefetchLocation(): void {
  if (pendingLocation && Date.now() - pendingLocationAt < LOCATION_TTL_MS) return;
  pendingLocationAt = Date.now();
  pendingLocation = getCurrentLocation();
}

// Resolve the location to attach to a note. Returns the prefetched lookup when
// one is available, otherwise performs a fresh lookup on demand.
export function resolveLocation(): Promise<GeoLocation | undefined> {
  if (!pendingLocation || Date.now() - pendingLocationAt >= LOCATION_TTL_MS) {
    pendingLocationAt = Date.now();
    pendingLocation = getCurrentLocation();
  }
  return pendingLocation;
}
