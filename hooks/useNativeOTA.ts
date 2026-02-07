import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { App } from '@capacitor/app';

// Remote URL for live updates - the production Cloud Run/hosting URL
const REMOTE_URL = 'https://saveitforl8r.com';
const VERSION_CHECK_URL = `${REMOTE_URL}/version.json`;

// Preference keys for native storage
const PREF_USE_REMOTE = 'ota_use_remote';
const PREF_SERVER_URL = 'ota_server_url';
const PREF_LAST_VERSION = 'ota_last_version';

// Time intervals
const CACHE_STATUS_REFRESH_INTERVAL_MS = 30 * 1000;     // 30 seconds
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

interface CacheStatus {
  ready: boolean;
  totalCacheCount: number;
  estimatedSize: number;
  error?: string;
}

interface OTAState {
  isNative: boolean;
  isUsingRemote: boolean;
  updateAvailable: boolean;
  currentVersion: string;
  remoteVersion: VersionInfo | null;
  isOnline: boolean;
  cacheStatus: CacheStatus | null;
  isPrecaching: boolean;
  isCheckingUpdate: boolean;
}

export const useNativeOTA = () => {
  const [state, setState] = useState<OTAState>({
    isNative: Capacitor.isNativePlatform(),
    isUsingRemote: false,
    updateAvailable: false,
    currentVersion: '',
    remoteVersion: null,
    isOnline: navigator.onLine,
    cacheStatus: null,
    isPrecaching: false,
    isCheckingUpdate: false,
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

  // Inform the service worker of native app context and get current SW version
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const initSW = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration.active) {
          // Inform SW whether we're in a native app context so it can
          // decide whether to auto-skip waiting on install.
          registration.active.postMessage({
            type: 'SET_NATIVE_CONTEXT',
            isNative: Capacitor.isNativePlatform(),
          });

          const channel = new MessageChannel();
          channel.port1.onmessage = (event) => {
            if (event.data.type === 'VERSION') {
              setState(s => ({ ...s, currentVersion: event.data.version }));
            }
          };
          registration.active.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
        }
      } catch (e) {
        console.warn('[OTA] Failed to init SW:', e);
      }
    };

    initSW();
  }, []);

  // Get cache status from service worker
  const refreshCacheStatus = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      if (registration.active) {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
          if (event.data.type === 'CACHE_STATUS') {
            setState(s => ({ ...s, cacheStatus: event.data }));
          }
        };
        registration.active.postMessage({ type: 'GET_CACHE_STATUS' }, [channel.port2]);
      }
    } catch (e) {
      console.warn('[OTA] Failed to get cache status:', e);
    }
  }, []);

  // Check cache status on mount and periodically
  useEffect(() => {
    refreshCacheStatus();
    const interval = setInterval(refreshCacheStatus, CACHE_STATUS_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshCacheStatus]);

  // Check for remote updates
  const checkForUpdate = useCallback(async (): Promise<boolean> => {
    if (!state.isOnline) return false;

    setState(s => ({ ...s, isCheckingUpdate: true }));

    try {
      const response = await fetch(VERSION_CHECK_URL, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const remoteInfo: VersionInfo = await response.json();

      const hasUpdate = remoteInfo.version !== state.currentVersion;

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
  }, [state.isOnline, state.currentVersion]);

  // Check for updates on mount and periodically (every 4 hours)
  useEffect(() => {
    if (!state.isUsingRemote) return;

    // Initial check after a short delay
    const timeout = setTimeout(checkForUpdate, INITIAL_UPDATE_CHECK_DELAY_MS);

    // Periodic check
    const interval = setInterval(checkForUpdate, PERIODIC_UPDATE_CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [state.isUsingRemote, checkForUpdate]);

  // Enable remote mode (switch from bundled assets to Cloud URL)
  const enableRemoteMode = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      console.warn('[OTA] Cannot enable remote mode on non-native platform');
      return;
    }

    try {
      await Preferences.set({ key: PREF_USE_REMOTE, value: 'true' });
      await Preferences.set({ key: PREF_SERVER_URL, value: REMOTE_URL });

      // Store current version for comparison after restart
      if (state.currentVersion) {
        await Preferences.set({ key: PREF_LAST_VERSION, value: state.currentVersion });
      }

      // Restart app to apply changes
      // On Android/iOS this will restart the app with the new server URL
      await App.exitApp();
    } catch (e) {
      console.error('[OTA] Failed to enable remote mode:', e);
      throw e;
    }
  }, [state.currentVersion]);

  // Disable remote mode (switch back to bundled assets)
  const disableRemoteMode = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      console.warn('[OTA] Cannot disable remote mode on non-native platform');
      return;
    }

    try {
      await Preferences.set({ key: PREF_USE_REMOTE, value: 'false' });
      await Preferences.remove({ key: PREF_SERVER_URL });

      // Restart app to apply changes
      await App.exitApp();
    } catch (e) {
      console.error('[OTA] Failed to disable remote mode:', e);
      throw e;
    }
  }, []);

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
    precacheForOffline,
    applyUpdate,
    refreshCacheStatus,
    formatCacheSize,
    remoteUrl: REMOTE_URL,
  };
};

export default useNativeOTA;
