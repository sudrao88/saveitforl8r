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

  // Get current version from local version.json
  useEffect(() => {
    const fetchCurrentVersion = async () => {
      try {
        // Fetch from relative path (works for both local assets and remote server)
        const response = await fetch('/version.json');
        if (response.ok) {
          const data: VersionInfo = await response.json();
          setState(s => ({ ...s, currentVersion: data.version }));
        }
      } catch (e) {
        console.warn('[OTA] Failed to fetch local version.json:', e);
      }
    };

    fetchCurrentVersion();
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

  // Check for remote updates
  const checkForUpdate = useCallback(async (): Promise<boolean> => {
    if (!state.isOnline || !Capacitor.isNativePlatform()) return false;

    setState(s => ({ ...s, isCheckingUpdate: true }));

    try {
      // Add timestamp to prevent caching
      const response = await fetch(`${REMOTE_VERSION_URL}?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const remoteInfo: VersionInfo = await response.json();
      
      // Compare versions - ensure boolean result
      const hasUpdate = !!(state.currentVersion && remoteInfo.version !== state.currentVersion);

      console.log(`[OTA] Check complete. Current: ${state.currentVersion}, Remote: ${remoteInfo.version}, HasUpdate: ${hasUpdate}`);

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

  // Periodic check
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Check after 5 seconds
    const timeout = setTimeout(checkForUpdate, 5000);
    
    // Check every hour
    const interval = setInterval(checkForUpdate, 60 * 60 * 1000);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  return {
    ...state,
    checkForUpdate,
    enableRemoteMode,
    disableRemoteMode,
    remoteUrl: REMOTE_URL,
  };
};

export default useNativeOTA;
