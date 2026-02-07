import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

// Remote URL for live updates - the production Cloud Run/hosting URL
const REMOTE_URL = 'https://saveitforl8r.com';
const REMOTE_VERSION_URL = `${REMOTE_URL}/version.json`;

// Preference keys for native storage
const PREF_USE_REMOTE = 'ota_use_remote';
const PREF_SERVER_URL = 'ota_server_url';
const PREF_LAST_VERSION = 'ota_last_version';

// Time intervals
const INITIAL_UPDATE_CHECK_DELAY_MS = 5 * 1000;          // 5 seconds
const PERIODIC_UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const PRECACHE_TIMEOUT_MS = 60 * 1000;                   // 60 seconds

interface VersionInfo {
  version: string;
  buildNumber: number;
  buildDate: string;
  minNativeVersion: string;
  changelog: string;
}

interface OTAState {
  isNative: boolean;
  isUsingRemote: boolean;
  updateAvailable: boolean;
  currentVersion: string;
  remoteVersion: VersionInfo | null;
  isOnline: boolean;
  isCheckingUpdate: boolean;
  isPrecaching?: boolean;
}

export const useNativeOTA = () => {
  const [state, setState] = useState<OTAState>({
    isNative: Capacitor.isNativePlatform(),
    isUsingRemote: false,
    updateAvailable: false,
    currentVersion: '',
    remoteVersion: null,
    isOnline: navigator.onLine,
    isCheckingUpdate: false,
    isPrecaching: false,
  });

  // Check if currently using remote URL mode
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const loadPreferences = async () => {
      try {
        const { value } = await Preferences.get({ key: PREF_USE_REMOTE });
        setState(s => ({ ...s, isUsingRemote: value === 'true' }));
      } catch (e) {
        console.warn('[OTA] Failed to load preferences:', e);
      }
    };

    loadPreferences();
  }, []);

  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => setState(s => ({ ...s, isOnline: true }));
    const handleOffline = () => setState(s => ({ ...s, isOnline: false }));

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Fetch the current version from version.json (works in both bundled and remote mode).
  // On native, the service worker is unregistered, so we cannot rely on SW messaging
  // to get the version. Instead, fetch /version.json directly — this returns the
  // bundled version when in local mode, or the remote version when in OTA remote mode.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const fetchLocalVersion = async () => {
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (response.ok) {
          const info: VersionInfo = await response.json();
          setState(s => ({ ...s, currentVersion: info.version }));
        }
      } catch (e) {
        console.warn('[OTA] Failed to fetch local version.json:', e);
      }
    };

    fetchLocalVersion();
  }, []);

  // Enable remote mode (switch from bundled assets to Cloud URL)
  const enableRemoteMode = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      console.warn('[OTA] Cannot enable remote mode on non-native platform');
      return;
    }

    try {
      // Store current version for comparison (useful for rollback logic if needed)
      if (state.currentVersion) {
          try {
             await Preferences.set({ key: PREF_LAST_VERSION, value: state.currentVersion });
          } catch (ignore) {}
      }

      if (Capacitor.getPlatform() === 'android' && (window as any).AndroidBridge) {
          // Use native bridge to switch URL and recreate activity
          // This ensures plugins work correctly on the new origin by re-initializing the Bridge
          (window as any).AndroidBridge.enableRemoteMode();
      } else {
          // Fallback (iOS or if bridge missing) - might have plugin issues on remote origin
          await Preferences.set({ key: PREF_USE_REMOTE, value: 'true' });
          await Preferences.set({ key: PREF_SERVER_URL, value: REMOTE_URL });
          window.location.href = REMOTE_URL;
      }
    } catch (e) {
      console.error('[OTA] Failed to enable remote mode:', e);
    }
  }, [state.currentVersion]);

  // Disable remote mode (switch back to bundled assets)
  const disableRemoteMode = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      console.warn('[OTA] Cannot disable remote mode on non-native platform');
      return;
    }

    try {
      if (Capacitor.getPlatform() === 'android' && (window as any).AndroidBridge) {
          (window as any).AndroidBridge.disableRemoteMode();
      } else {
          await Preferences.set({ key: PREF_USE_REMOTE, value: 'false' });
          await Preferences.remove({ key: PREF_SERVER_URL });
          // Default Capacitor Android/iOS scheme
          window.location.href = 'https://localhost';
      }
    } catch (e) {
      console.error('[OTA] Failed to disable remote mode:', e);
    }
  }, []);

  const refreshCacheStatus = useCallback(() => {
     // Placeholder for cache status refresh if needed
  }, []);

  // Check for remote updates.
  // When already in remote mode, the user is loading from the live server and
  // always gets the latest code (nginx serves no-store for HTML), so no OTA
  // update detection is needed.
  const checkForUpdate = useCallback(async (): Promise<boolean> => {
    if (!state.isOnline || !Capacitor.isNativePlatform() || state.isUsingRemote) return false;

    setState(s => ({ ...s, isCheckingUpdate: true }));

    try {
      // Fetch the local version (bundled in APK) and the remote version in parallel
      const [localRes, remoteRes] = await Promise.all([
        fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' }),
        fetch(`${REMOTE_VERSION_URL}?t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        }),
      ]);

      if (!remoteRes.ok) {
        throw new Error(`Remote HTTP ${remoteRes.status}`);
      }

      const remoteInfo: VersionInfo = await remoteRes.json();

      // Determine the current version from the local fetch, or fall back to state
      let currentVer = state.currentVersion;
      if (localRes.ok) {
        const localInfo: VersionInfo = await localRes.json();
        currentVer = localInfo.version;
        // Keep state in sync
        setState(s => ({ ...s, currentVersion: localInfo.version }));
      }

      const hasUpdate = !!(currentVer && remoteInfo.version !== currentVer);

      console.log(`[OTA] Check complete. Current: ${currentVer}, Remote: ${remoteInfo.version}, HasUpdate: ${hasUpdate}`);

      setState(s => ({
        ...s,
        remoteVersion: remoteInfo,
        updateAvailable: hasUpdate,
        isCheckingUpdate: false,
      }));

      return hasUpdate;
    } catch (e) {
      console.warn('[OTA] Version check failed:', e);
      setState(s => ({ ...s, isCheckingUpdate: false }));
      return false;
    }
  }, [state.isOnline, state.currentVersion, state.isUsingRemote]);

  // Periodic check
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Initial check after a short delay
    const timeout = setTimeout(checkForUpdate, INITIAL_UPDATE_CHECK_DELAY_MS);

    // Periodic check
    const interval = setInterval(checkForUpdate, PERIODIC_UPDATE_CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  // Precache all assets for offline use
  const precacheForOffline = useCallback(async (): Promise<void> => {
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service worker not supported');
    }

    setState(s => ({ ...s, isPrecaching: true }));

    try {
      const registration = await navigator.serviceWorker.ready;
      const activeSW = registration.active;

      if (!activeSW) {
        throw new Error('No active service worker');
      }

      // Separate the promise creation from state updates so that
      // state is never mutated inside the Promise executor.
      await new Promise<void>((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => {
          reject(new Error('Precache timeout'));
        }, PRECACHE_TIMEOUT_MS);

        channel.port1.onmessage = (event) => {
          clearTimeout(timeout);
          if (event.data.type === 'PRECACHE_COMPLETE') {
            resolve();
          } else {
            reject(new Error(`Precache failed with message: ${JSON.stringify(event.data)}`));
          }
        };

        activeSW.postMessage({ type: 'PRECACHE_ALL' }, [channel.port2]);
      });

      refreshCacheStatus();
    } catch (e) {
      console.error('[OTA] Precache failed:', e);
      throw e;
    } finally {
      // Guarantee isPrecaching is reset even on error or unmount
      setState(s => ({ ...s, isPrecaching: false }));
    }
  }, [refreshCacheStatus]);

  // Apply available update (tell SW to skip waiting and reload)
  const applyUpdate = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return;

    try {
      const registration = await navigator.serviceWorker.ready;

      if (registration.waiting) {
        // There's a waiting service worker - tell it to activate then reload
        // Listen for the new SW to take control before reloading
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.location.reload();
        }, { once: true });
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      } else {
        // No waiting worker yet — trigger an update check.
        // The new SW needs to download and install before it can be activated.
        // The caller should wait for registration.waiting to appear and then
        // call applyUpdate() again.
        await registration.update();
      }
    } catch (e) {
      console.error('[OTA] Apply update failed:', e);
    }
  }, []);

  // Format cache size for display
  const formatCacheSize = useCallback((bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  return {
    ...state,
    checkForUpdate,
    enableRemoteMode,
    disableRemoteMode,
    remoteUrl: REMOTE_URL,
    precacheForOffline,
    applyUpdate,
    formatCacheSize
  };
};

export default useNativeOTA;
