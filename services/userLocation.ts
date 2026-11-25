/**
 * userLocation.ts
 *
 * Live device location for the in-app map's "you are here" dot. Unlike
 * utils/locationUtils (a one-off lookup attached to a saved note), this keeps
 * watching so the dot follows the user while the map is open.
 *
 * Nothing here is stored or sent anywhere: positions only feed the map.
 */

import { isNative } from './platform';

export interface UserPosition {
  lat: number;
  lng: number;
  /** Radius of uncertainty, in metres. */
  accuracy: number;
}

export type LocationError = 'denied' | 'unavailable';

const WATCH_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 };

/**
 * True when the user has already allowed location, so the map can show the
 * dot straight away without prompting. Anything uncertain reads as false: the
 * prompt then waits until the user taps the location button.
 */
export const hasLocationPermission = async (): Promise<boolean> => {
  try {
    if (isNative()) {
      const { Geolocation } = await import('@capacitor/geolocation');
      const status = await Geolocation.checkPermissions();
      return status.location === 'granted' || status.coarseLocation === 'granted';
    }
    if (!navigator.permissions?.query) return false;
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state === 'granted';
  } catch {
    return false;
  }
};

/**
 * Watches the device position, prompting for permission if needed. Calls
 * `onPosition` with each fix and `onError` when location can't be had.
 * Returns a function that stops watching.
 */
export const watchUserLocation = (
  onPosition: (pos: UserPosition) => void,
  onError: (err: LocationError) => void,
): (() => void) => {
  let stopped = false;

  if (isNative()) {
    let watchId: string | null = null;
    (async () => {
      try {
        const { Geolocation } = await import('@capacitor/geolocation');
        if (stopped) return;
        const id = await Geolocation.watchPosition(WATCH_OPTIONS, (pos, err) => {
          if (stopped) return;
          if (pos) onPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
          else if (err) onError(/denied|permission/i.test(String(err?.message ?? err)) ? 'denied' : 'unavailable');
        });
        if (stopped) void Geolocation.clearWatch({ id });
        else watchId = id;
      } catch (err) {
        if (!stopped) onError(/denied|permission/i.test(String((err as Error)?.message ?? err)) ? 'denied' : 'unavailable');
      }
    })();
    return () => {
      stopped = true;
      if (watchId) {
        const id = watchId;
        void import('@capacitor/geolocation').then(({ Geolocation }) => Geolocation.clearWatch({ id }));
      }
    };
  }

  if (!navigator.geolocation) {
    onError('unavailable');
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    pos => {
      if (!stopped) onPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
    },
    err => {
      if (!stopped) onError(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
    },
    WATCH_OPTIONS,
  );
  return () => {
    stopped = true;
    navigator.geolocation.clearWatch(id);
  };
};
