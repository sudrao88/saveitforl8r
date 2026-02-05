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

  // Get current service worker version
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const getVersion = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration.active) {
          const channel = new MessageChannel();
          channel.port1.onmessage = (event) => {
            if (event.data.type === 'VERSION') {
              setState(s => ({ ...s, currentVersion: event.data.version }));
            }
          };
          registration.active.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
        }
      } catch (e) {
        console.warn('[OTA] Failed to get SW version:', e);
      }
    };

    getVersion();
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
    const interval = setInterval(refreshCacheStatus, 30000); // Every 30 seconds
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
    const timeout = setTimeout(checkForUpdate, 5000);

    // Periodic check every 4 hours
    const interval = setInterval(checkForUpdate, 4 * 60 * 60 * 1000);

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
      if (!registration.active) {
        throw new Error('No active service worker');
      }

      return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => {
          reject(new Error('Precache timeout'));
        }, 60000); // 60 second timeout

        channel.port1.onmessage = (event) => {
          clearTimeout(timeout);
          if (event.data.type === 'PRECACHE_COMPLETE') {
            setState(s => ({ ...s, isPrecaching: false }));
            refreshCacheStatus();
            resolve();
          }
        };

        registration.active.postMessage({ type: 'PRECACHE_ALL' }, [channel.port2]);
      });
    } catch (e) {
      setState(s => ({ ...s, isPrecaching: false }));
      console.error('[OTA] Precache failed:', e);
      throw e;
    }
  }, [refreshCacheStatus]);

  // Apply available update (tell SW to skip waiting and reload)
  const applyUpdate = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return;

    try {
      const registration = await navigator.serviceWorker.ready;

      if (registration.waiting) {
        // There's a waiting service worker - tell it to activate
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      } else {
        // Force check for updates and reload
        await registration.update();
        window.location.reload();
      }
    } catch (e) {
      console.error('[OTA] Apply update failed:', e);
      // Fallback: just reload
      window.location.reload();
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
