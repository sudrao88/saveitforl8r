import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks (vi.mock factories cannot reference outer variables) ---

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn().mockReturnValue(true),
    getPlatform: vi.fn().mockReturnValue('android'),
  },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn().mockResolvedValue({ value: null }),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

// Import after mocks
import { useNativeOTA } from './useNativeOTA';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

// Typed references to the mocked modules
const mockCapacitor = vi.mocked(Capacitor);
const mockPreferences = vi.mocked(Preferences);

// --- Native bridge type augmentation ---

interface IOSBridgeHandler {
  postMessage: ReturnType<typeof vi.fn>;
}

declare global {
  interface Window {
    webkit?: {
      messageHandlers: {
        IOSBridge: IOSBridgeHandler;
      };
    };
  }
}

// --- Helpers ---

const REMOTE_URL = 'https://saveitforl8r.com';

const makeVersionInfo = (version = 'saveitforl8r-v44', buildNumber = 44) => ({
  version,
  buildNumber,
  buildDate: '2026-03-21T00:00:00Z',
  minNativeVersion: '1.0.0',
  changelog: 'Test update',
});

function mockFetchVersions(
  localVersion: string,
  remoteVersion: string,
  opts: { remoteStatus?: number; localStatus?: number; localFail?: boolean; remoteFail?: boolean } = {},
) {
  const localInfo = makeVersionInfo(localVersion);
  const remoteInfo = makeVersionInfo(remoteVersion);

  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.startsWith(REMOTE_URL)) {
      if (opts.remoteFail) return Promise.reject(new Error('Network error'));
      return Promise.resolve({
        ok: (opts.remoteStatus ?? 200) === 200,
        status: opts.remoteStatus ?? 200,
        json: () => Promise.resolve(remoteInfo),
      });
    }
    // local /version.json
    if (opts.localFail) return Promise.reject(new Error('Local fetch error'));
    return Promise.resolve({
      ok: (opts.localStatus ?? 200) === 200,
      status: opts.localStatus ?? 200,
      json: () => Promise.resolve(localInfo),
    });
  });
}

function setupAndroidBridge() {
  window.AndroidBridge = {
    signalAppReady: vi.fn(),
    enableRemoteMode: vi.fn(),
    disableRemoteMode: vi.fn(),
  };
}

function setupIOSBridge() {
  mockCapacitor.getPlatform.mockReturnValue('ios');
  window.webkit = {
    messageHandlers: {
      IOSBridge: {
        postMessage: vi.fn(),
      },
    },
  };
}

function cleanupBridges() {
  delete window.AndroidBridge;
  delete window.webkit;
}

// --- Tests ---

describe('useNativeOTA', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockCapacitor.isNativePlatform.mockReturnValue(true);
    mockCapacitor.getPlatform.mockReturnValue('android');
    mockPreferences.get.mockResolvedValue({ value: null });
    mockPreferences.set.mockResolvedValue(undefined);
    cleanupBridges();

    // Default fetch mock — local version.json returns v44
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeVersionInfo()),
    });

    // navigator.onLine
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupBridges();
  });

  // ---- Initial state ----

  describe('initial state', () => {
    it('should initialize with native platform detected', async () => {
      const { result } = renderHook(() => useNativeOTA());
      expect(result.current.isNative).toBe(true);
      expect(result.current.isDownloading).toBe(false);
      expect(result.current.downloadError).toBeNull();
      expect(result.current.updateAvailable).toBe(false);
    });

    it('should initialize as non-native when not on a native platform', () => {
      mockCapacitor.isNativePlatform.mockReturnValue(false);
      const { result } = renderHook(() => useNativeOTA());
      expect(result.current.isNative).toBe(false);
    });

    it('should expose the remote URL', () => {
      const { result } = renderHook(() => useNativeOTA());
      expect(result.current.remoteUrl).toBe(REMOTE_URL);
    });
  });

  // ---- Preference loading ----

  describe('preference loading', () => {
    it('should load isUsingRemote from Preferences on mount', async () => {
      mockPreferences.get.mockResolvedValue({ value: 'true' });
      const { result } = renderHook(() => useNativeOTA());

      await waitFor(() => {
        expect(result.current.isUsingRemote).toBe(true);
      });
      expect(mockPreferences.get).toHaveBeenCalledWith({ key: 'ota_use_remote' });
    });

    it('should default isUsingRemote to false when preference is null', async () => {
      mockPreferences.get.mockResolvedValue({ value: null });
      const { result } = renderHook(() => useNativeOTA());

      await waitFor(() => {
        expect(result.current.isUsingRemote).toBe(false);
      });
    });

    it('should handle preference loading failure gracefully', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockPreferences.get.mockRejectedValue(new Error('Storage error'));
      const { result } = renderHook(() => useNativeOTA());

      // Should not crash, default remains false
      await waitFor(() => {
        expect(warnSpy).toHaveBeenCalled();
      });
      expect(result.current.isUsingRemote).toBe(false);
    });

    it('should not load preferences on non-native platform', async () => {
      mockCapacitor.isNativePlatform.mockReturnValue(false);
      renderHook(() => useNativeOTA());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(mockPreferences.get).not.toHaveBeenCalled();
    });
  });

  // ---- Current version fetching ----

  describe('current version fetch', () => {
    it('should fetch local version.json on mount for native platforms', async () => {
      const { result } = renderHook(() => useNativeOTA());

      await waitFor(() => {
        expect(result.current.currentVersion).toBe('saveitforl8r-v44');
      });
    });

    it('should not fetch version on non-native platforms', async () => {
      mockCapacitor.isNativePlatform.mockReturnValue(false);
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeVersionInfo()),
      });
      global.fetch = fetchSpy;

      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      // version should remain empty since all native effects are skipped
      expect(result.current.currentVersion).toBe('');
    });

    it('should handle version fetch failure gracefully', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(result.current.currentVersion).toBe('');
    });
  });

  // ---- Online/offline tracking ----

  describe('online/offline tracking', () => {
    it('should update to offline when offline event fires', async () => {
      const { result } = renderHook(() => useNativeOTA());
      expect(result.current.isOnline).toBe(true);

      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      expect(result.current.isOnline).toBe(false);
    });

    it('should update to online when online event fires', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      const { result } = renderHook(() => useNativeOTA());

      act(() => {
        window.dispatchEvent(new Event('online'));
      });
      expect(result.current.isOnline).toBe(true);
    });

    it('should track online/offline cycle', async () => {
      const { result } = renderHook(() => useNativeOTA());

      act(() => { window.dispatchEvent(new Event('offline')); });
      expect(result.current.isOnline).toBe(false);

      act(() => { window.dispatchEvent(new Event('online')); });
      expect(result.current.isOnline).toBe(true);
    });
  });

  // ---- OTA error events ----

  describe('OTA error events from native', () => {
    it('should handle ota-error custom events', () => {
      const { result } = renderHook(() => useNativeOTA());
      vi.spyOn(console, 'error').mockImplementation(() => {});

      act(() => {
        window.dispatchEvent(new CustomEvent('ota-error', { detail: 'Download failed: HTTP 500' }));
      });

      expect(result.current.isDownloading).toBe(false);
      expect(result.current.downloadError).toBe('Download failed: HTTP 500');
    });
  });

  // ---- checkForUpdate ----

  describe('checkForUpdate', () => {
    it('should detect when an update is available', async () => {
      mockFetchVersions('saveitforl8r-v43', 'saveitforl8r-v44');
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const { result } = renderHook(() => useNativeOTA());

      await waitFor(() => {
        expect(result.current.currentVersion).toBe('saveitforl8r-v43');
      });

      let hasUpdate: boolean | undefined;
      await act(async () => {
        hasUpdate = await result.current.checkForUpdate();
      });

      expect(hasUpdate).toBe(true);
      expect(result.current.updateAvailable).toBe(true);
      expect(result.current.remoteVersion?.version).toBe('saveitforl8r-v44');
    });

    it('should report no update when versions match', async () => {
      mockFetchVersions('saveitforl8r-v44', 'saveitforl8r-v44');
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const { result } = renderHook(() => useNativeOTA());

      await waitFor(() => {
        expect(result.current.currentVersion).toBe('saveitforl8r-v44');
      });

      let hasUpdate: boolean | undefined;
      await act(async () => {
        hasUpdate = await result.current.checkForUpdate();
      });

      expect(hasUpdate).toBe(false);
      expect(result.current.updateAvailable).toBe(false);
    });

    it('should return false when offline', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      const { result } = renderHook(() => useNativeOTA());

      act(() => {
        window.dispatchEvent(new Event('offline'));
      });

      let hasUpdate: boolean | undefined;
      await act(async () => {
        hasUpdate = await result.current.checkForUpdate();
      });

      expect(hasUpdate).toBe(false);
    });

    it('should return false on non-native platform', async () => {
      mockCapacitor.isNativePlatform.mockReturnValue(false);
      const { result } = renderHook(() => useNativeOTA());

      let hasUpdate: boolean | undefined;
      await act(async () => {
        hasUpdate = await result.current.checkForUpdate();
      });

      expect(hasUpdate).toBe(false);
    });

    it('should skip update check when already using remote mode', async () => {
      mockPreferences.get.mockResolvedValue({ value: 'true' });
      const { result } = renderHook(() => useNativeOTA());

      await waitFor(() => {
        expect(result.current.isUsingRemote).toBe(true);
      });

      let hasUpdate: boolean | undefined;
      await act(async () => {
        hasUpdate = await result.current.checkForUpdate();
      });

      expect(hasUpdate).toBe(false);
    });

    it('should handle remote version fetch failure gracefully', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockFetchVersions('saveitforl8r-v43', '', { remoteFail: true });
      const { result } = renderHook(() => useNativeOTA());

      await waitFor(() => {
        expect(result.current.currentVersion).toBe('saveitforl8r-v43');
      });

      let hasUpdate: boolean | undefined;
      await act(async () => {
        hasUpdate = await result.current.checkForUpdate();
      });

      expect(hasUpdate).toBe(false);
      expect(result.current.isCheckingUpdate).toBe(false);
    });

    it('should handle remote HTTP error gracefully', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockFetchVersions('saveitforl8r-v43', 'saveitforl8r-v44', { remoteStatus: 500 });
      const { result } = renderHook(() => useNativeOTA());

      await waitFor(() => {
        expect(result.current.currentVersion).toBe('saveitforl8r-v43');
      });

      let hasUpdate: boolean | undefined;
      await act(async () => {
        hasUpdate = await result.current.checkForUpdate();
      });

      expect(hasUpdate).toBe(false);
    });

    it('should set isCheckingUpdate during the check', async () => {
      let resolveRemote!: (v: any) => void;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.startsWith(REMOTE_URL)) {
          return new Promise((resolve) => {
            resolveRemote = resolve;
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makeVersionInfo('saveitforl8r-v43')),
        });
      });
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const { result } = renderHook(() => useNativeOTA());

      await waitFor(() => {
        expect(result.current.currentVersion).toBe('saveitforl8r-v43');
      });

      let checkPromise: Promise<boolean>;
      act(() => {
        checkPromise = result.current.checkForUpdate();
      });

      expect(result.current.isCheckingUpdate).toBe(true);

      await act(async () => {
        resolveRemote({
          ok: true,
          json: () => Promise.resolve(makeVersionInfo('saveitforl8r-v44')),
        });
        await checkPromise!;
      });

      expect(result.current.isCheckingUpdate).toBe(false);
    });

    it('should update currentVersion from local fetch during check', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeVersionInfo('saveitforl8r-v43')),
      });
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const { result } = renderHook(() => useNativeOTA());

      await waitFor(() => {
        expect(result.current.currentVersion).toBe('saveitforl8r-v43');
      });

      // Now change local to v43.1 and remote to v44
      mockFetchVersions('saveitforl8r-v43.1', 'saveitforl8r-v44');

      await act(async () => {
        await result.current.checkForUpdate();
      });

      expect(result.current.currentVersion).toBe('saveitforl8r-v43.1');
      expect(result.current.updateAvailable).toBe(true);
    });
  });

  // ---- Periodic update checks ----

  describe('periodic update checks', () => {
    it('should schedule an initial check after 5 seconds', async () => {
      mockFetchVersions('saveitforl8r-v43', 'saveitforl8r-v44');
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const { result } = renderHook(() => useNativeOTA());

      await waitFor(() => {
        expect(result.current.currentVersion).toBe('saveitforl8r-v43');
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      await waitFor(() => {
        expect(result.current.updateAvailable).toBe(true);
      });
    });

    it('should not schedule periodic checks on non-native platforms', async () => {
      mockCapacitor.isNativePlatform.mockReturnValue(false);
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeVersionInfo()),
      });
      global.fetch = fetchSpy;

      renderHook(() => useNativeOTA());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ---- enableRemoteMode (Android) ----

  describe('enableRemoteMode - Android', () => {
    beforeEach(() => {
      setupAndroidBridge();
    });

    it('should call AndroidBridge.enableRemoteMode()', async () => {
      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.enableRemoteMode();
      });

      expect(window.AndroidBridge!.enableRemoteMode).toHaveBeenCalled();
      expect(result.current.isDownloading).toBe(true);
    });

    it('should set isDownloading to true and clear downloadError', async () => {
      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.enableRemoteMode();
      });

      expect(result.current.isDownloading).toBe(true);
      expect(result.current.downloadError).toBeNull();
    });

    it('should prevent duplicate concurrent downloads', async () => {
      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.enableRemoteMode();
      });

      // Second call while downloading
      await act(async () => {
        await result.current.enableRemoteMode();
      });

      expect(window.AndroidBridge!.enableRemoteMode).toHaveBeenCalledTimes(1);
    });

    it('should save current version before downloading', async () => {
      const { result } = renderHook(() => useNativeOTA());

      await waitFor(() => {
        expect(result.current.currentVersion).toBe('saveitforl8r-v44');
      });

      await act(async () => {
        await result.current.enableRemoteMode();
      });

      expect(mockPreferences.set).toHaveBeenCalledWith({
        key: 'ota_last_version',
        value: 'saveitforl8r-v44',
      });
    });

    it('should handle native bridge errors via ota-error event', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.enableRemoteMode();
      });

      expect(result.current.isDownloading).toBe(true);

      act(() => {
        window.dispatchEvent(new CustomEvent('ota-error', { detail: 'httpError: 503' }));
      });

      expect(result.current.isDownloading).toBe(false);
      expect(result.current.downloadError).toBe('httpError: 503');
    });

    it('should handle exception in bridge call', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      window.AndroidBridge!.enableRemoteMode = vi.fn(() => {
        throw new Error('Bridge crashed');
      });

      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.enableRemoteMode();
      });

      expect(result.current.isDownloading).toBe(false);
      expect(result.current.downloadError).toBe('Error: Bridge crashed');
    });
  });

  // ---- enableRemoteMode (iOS) ----

  describe('enableRemoteMode - iOS', () => {
    beforeEach(() => {
      setupIOSBridge();
    });

    it('should call IOSBridge.postMessage with enableRemoteMode action', async () => {
      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.enableRemoteMode();
      });

      expect(
        window.webkit!.messageHandlers.IOSBridge.postMessage,
      ).toHaveBeenCalledWith({ action: 'enableRemoteMode' });
      expect(result.current.isDownloading).toBe(true);
    });

    it('should handle ota-error event on iOS', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.enableRemoteMode();
      });

      act(() => {
        window.dispatchEvent(new CustomEvent('ota-error', { detail: 'missingIndex' }));
      });

      expect(result.current.isDownloading).toBe(false);
      expect(result.current.downloadError).toBe('missingIndex');
    });

    it('should handle exception in iOS bridge call', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      window.webkit!.messageHandlers.IOSBridge.postMessage = vi.fn(() => {
        throw new Error('iOS bridge crashed');
      });

      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.enableRemoteMode();
      });

      expect(result.current.isDownloading).toBe(false);
      expect(result.current.downloadError).toBe('Error: iOS bridge crashed');
    });
  });

  // ---- enableRemoteMode (no bridge) ----

  describe('enableRemoteMode - no bridge available', () => {
    it('should set error when no native bridge is available', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.enableRemoteMode();
      });

      expect(result.current.isDownloading).toBe(false);
      expect(result.current.downloadError).toBe('Native bridge not available');
    });

    it('should warn when called on non-native platform', async () => {
      mockCapacitor.isNativePlatform.mockReturnValue(false);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.enableRemoteMode();
      });

      expect(warnSpy).toHaveBeenCalledWith(
        '[OTA] Cannot enable remote mode on non-native platform',
      );
      expect(result.current.isDownloading).toBe(false);
    });
  });

  // ---- disableRemoteMode ----

  describe('disableRemoteMode', () => {
    it('should call AndroidBridge.disableRemoteMode() on Android', async () => {
      setupAndroidBridge();
      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.disableRemoteMode();
      });

      expect(window.AndroidBridge!.disableRemoteMode).toHaveBeenCalled();
    });

    it('should call IOSBridge.postMessage with disableRemoteMode on iOS', async () => {
      setupIOSBridge();
      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.disableRemoteMode();
      });

      expect(
        window.webkit!.messageHandlers.IOSBridge.postMessage,
      ).toHaveBeenCalledWith({ action: 'disableRemoteMode' });
    });

    it('should fall back to Preferences when no bridge is available', async () => {
      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.disableRemoteMode();
      });

      expect(mockPreferences.set).toHaveBeenCalledWith({
        key: 'ota_use_remote',
        value: 'false',
      });
    });

    it('should warn when called on non-native platform', async () => {
      mockCapacitor.isNativePlatform.mockReturnValue(false);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.disableRemoteMode();
      });

      expect(warnSpy).toHaveBeenCalledWith(
        '[OTA] Cannot disable remote mode on non-native platform',
      );
    });

    it('should handle bridge errors gracefully', async () => {
      setupAndroidBridge();
      window.AndroidBridge!.disableRemoteMode = vi.fn(() => {
        throw new Error('Bridge error');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useNativeOTA());

      // Should not throw
      await act(async () => {
        await result.current.disableRemoteMode();
      });

      expect(errorSpy).toHaveBeenCalled();
    });
  });

  // ---- precacheForOffline ----

  describe('precacheForOffline', () => {
    let mockActiveSW: any;
    let mockRegistration: any;
    let savedServiceWorker: any;
    let capturedPort1: any;

    // jsdom MessageChannel doesn't relay between ports, so we mock it
    // to capture port1 so the SW mock can trigger port1.onmessage directly.
    const OriginalMessageChannel = globalThis.MessageChannel;

    beforeEach(() => {
      savedServiceWorker = navigator.serviceWorker;
      capturedPort1 = null;

      // Mock MessageChannel to capture port1
      globalThis.MessageChannel = class {
        port1: any;
        port2: any;
        constructor() {
          this.port1 = { onmessage: null };
          this.port2 = { onmessage: null };
          // Link: calling postMessage on port2 triggers port1.onmessage
          const self = this;
          capturedPort1 = this.port1;
        }
      } as any;

      mockActiveSW = {
        postMessage: vi.fn(),
      };
      mockRegistration = {
        active: mockActiveSW,
        waiting: null,
        update: vi.fn(),
      };

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          ready: Promise.resolve(mockRegistration),
          addEventListener: vi.fn(),
        },
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      globalThis.MessageChannel = OriginalMessageChannel;
      Object.defineProperty(navigator, 'serviceWorker', {
        value: savedServiceWorker,
        configurable: true,
        writable: true,
      });
    });

    it('should send PRECACHE_ALL message to service worker', async () => {
      mockActiveSW.postMessage = vi.fn().mockImplementation(() => {
        // Trigger the response on port1 (the listening port)
        Promise.resolve().then(() => {
          capturedPort1.onmessage?.({ data: { type: 'PRECACHE_COMPLETE' } });
        });
      });

      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.precacheForOffline();
      });

      expect(mockActiveSW.postMessage).toHaveBeenCalledWith(
        { type: 'PRECACHE_ALL' },
        expect.any(Array),
      );
    });

    it('should set isPrecaching during operation and reset after', async () => {
      let resolvePort!: () => void;
      mockActiveSW.postMessage = vi.fn().mockImplementation(() => {
        resolvePort = () => {
          capturedPort1.onmessage?.({ data: { type: 'PRECACHE_COMPLETE' } });
        };
      });

      const { result } = renderHook(() => useNativeOTA());

      const precachePromise = result.current.precacheForOffline();

      // Wait a tick so the async function progresses to the postMessage call
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isPrecaching).toBe(true);

      await act(async () => {
        resolvePort();
        await precachePromise;
      });

      expect(result.current.isPrecaching).toBe(false);
    });

    // Note: These error tests use try/catch inside act() rather than
    // expect(act(...)).rejects.toThrow() because the latter causes React 19
    // to unmount the component, making result.current null and preventing
    // post-error state assertions (e.g. isPrecaching).

    it('should error when no active service worker', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockRegistration.active = null;

      const { result } = renderHook(() => useNativeOTA());

      let caughtError: Error | undefined;
      await act(async () => {
        try {
          await result.current.precacheForOffline();
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError?.message).toBe('No active service worker');
      expect(result.current.isPrecaching).toBe(false);
    });

    it('should error when service worker is not supported', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      // Delete the property so 'serviceWorker' in navigator === false
      const descriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
      delete (navigator as any).serviceWorker;

      const { result } = renderHook(() => useNativeOTA());

      await expect(
        act(() => result.current.precacheForOffline()),
      ).rejects.toThrow('Service worker not supported');

      // Restore
      if (descriptor) {
        Object.defineProperty(navigator, 'serviceWorker', descriptor);
      }
    });

    it('should reject when SW responds with non-PRECACHE_COMPLETE message', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockActiveSW.postMessage = vi.fn().mockImplementation(() => {
        Promise.resolve().then(() => {
          capturedPort1.onmessage?.({ data: { type: 'ERROR', reason: 'disk full' } });
        });
      });

      const { result } = renderHook(() => useNativeOTA());

      await expect(
        act(() => result.current.precacheForOffline()),
      ).rejects.toThrow('Precache failed with message');
    });
  });

  // ---- applyUpdate ----

  describe('applyUpdate', () => {
    let mockRegistration: any;
    let mockWaitingSW: any;
    let savedServiceWorker: any;

    beforeEach(() => {
      savedServiceWorker = navigator.serviceWorker;

      mockWaitingSW = {
        postMessage: vi.fn(),
      };
      mockRegistration = {
        active: { postMessage: vi.fn() },
        waiting: null,
        update: vi.fn().mockResolvedValue(undefined),
      };

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          ready: Promise.resolve(mockRegistration),
          addEventListener: vi.fn(),
        },
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(navigator, 'serviceWorker', {
        value: savedServiceWorker,
        configurable: true,
        writable: true,
      });
    });

    it('should send SKIP_WAITING to waiting service worker', async () => {
      mockRegistration.waiting = mockWaitingSW;

      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.applyUpdate();
      });

      expect(mockWaitingSW.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    });

    it('should listen for controllerchange when waiting SW exists', async () => {
      mockRegistration.waiting = mockWaitingSW;

      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.applyUpdate();
      });

      expect(navigator.serviceWorker.addEventListener).toHaveBeenCalledWith(
        'controllerchange',
        expect.any(Function),
        { once: true },
      );
    });

    it('should trigger registration.update() when no waiting worker', async () => {
      mockRegistration.waiting = null;

      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.applyUpdate();
      });

      expect(mockRegistration.update).toHaveBeenCalled();
    });

    it('should not throw when serviceWorker is unavailable', async () => {
      Object.defineProperty(navigator, 'serviceWorker', {
        value: undefined,
        configurable: true,
        writable: true,
      });

      const { result } = renderHook(() => useNativeOTA());

      // Should not throw
      await act(async () => {
        await result.current.applyUpdate();
      });

      expect(result.current).toBeTruthy();
    });
  });

  // ---- formatCacheSize ----

  describe('formatCacheSize', () => {
    it('should format bytes', () => {
      const { result } = renderHook(() => useNativeOTA());
      expect(result.current.formatCacheSize(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      const { result } = renderHook(() => useNativeOTA());
      expect(result.current.formatCacheSize(1536)).toBe('1.5 KB');
    });

    it('should format megabytes', () => {
      const { result } = renderHook(() => useNativeOTA());
      expect(result.current.formatCacheSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });

    it('should handle zero bytes', () => {
      const { result } = renderHook(() => useNativeOTA());
      expect(result.current.formatCacheSize(0)).toBe('0 B');
    });

    it('should handle exactly 1 KB', () => {
      const { result } = renderHook(() => useNativeOTA());
      expect(result.current.formatCacheSize(1024)).toBe('1.0 KB');
    });

    it('should handle exactly 1 MB', () => {
      const { result } = renderHook(() => useNativeOTA());
      expect(result.current.formatCacheSize(1024 * 1024)).toBe('1.0 MB');
    });
  });

  // ---- Full native OTA update flow ----

  describe('end-to-end native OTA update flow', () => {
    it('should detect update then download via Android bridge', async () => {
      setupAndroidBridge();
      mockFetchVersions('saveitforl8r-v43', 'saveitforl8r-v44');
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const { result } = renderHook(() => useNativeOTA());

      await waitFor(() => {
        expect(result.current.currentVersion).toBe('saveitforl8r-v43');
      });

      let hasUpdate: boolean | undefined;
      await act(async () => {
        hasUpdate = await result.current.checkForUpdate();
      });

      expect(hasUpdate).toBe(true);
      expect(result.current.updateAvailable).toBe(true);
      expect(result.current.remoteVersion?.version).toBe('saveitforl8r-v44');
      expect(result.current.remoteVersion?.changelog).toBe('Test update');

      await act(async () => {
        await result.current.enableRemoteMode();
      });

      expect(window.AndroidBridge!.enableRemoteMode).toHaveBeenCalled();
      expect(result.current.isDownloading).toBe(true);
    });

    it('should detect update then download via iOS bridge', async () => {
      setupIOSBridge();
      mockFetchVersions('saveitforl8r-v43', 'saveitforl8r-v44');
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const { result } = renderHook(() => useNativeOTA());

      await waitFor(() => {
        expect(result.current.currentVersion).toBe('saveitforl8r-v43');
      });

      await act(async () => {
        await result.current.checkForUpdate();
      });

      expect(result.current.updateAvailable).toBe(true);

      await act(async () => {
        await result.current.enableRemoteMode();
      });

      expect(
        window.webkit!.messageHandlers.IOSBridge.postMessage,
      ).toHaveBeenCalledWith({ action: 'enableRemoteMode' });
    });

    it('should handle update check → download failure → error state', async () => {
      setupAndroidBridge();
      mockFetchVersions('saveitforl8r-v43', 'saveitforl8r-v44');
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useNativeOTA());

      await waitFor(() => {
        expect(result.current.currentVersion).toBe('saveitforl8r-v43');
      });

      await act(async () => {
        await result.current.checkForUpdate();
      });

      await act(async () => {
        await result.current.enableRemoteMode();
      });

      expect(result.current.isDownloading).toBe(true);

      act(() => {
        window.dispatchEvent(new CustomEvent('ota-error', { detail: 'downloadFailed: disk full' }));
      });

      expect(result.current.isDownloading).toBe(false);
      expect(result.current.downloadError).toBe('downloadFailed: disk full');
    });

    it('should handle rollback flow: enable then disable remote mode', async () => {
      setupAndroidBridge();
      const { result } = renderHook(() => useNativeOTA());

      await act(async () => {
        await result.current.enableRemoteMode();
      });
      expect(window.AndroidBridge!.enableRemoteMode).toHaveBeenCalled();

      // Simulate the download completing (reset isDownloading via ota success)
      // In real usage the page would reload. For test, simulate ota-error to reset state.
      act(() => {
        window.dispatchEvent(new CustomEvent('ota-error', { detail: 'test-rollback' }));
      });

      await act(async () => {
        await result.current.disableRemoteMode();
      });
      expect(window.AndroidBridge!.disableRemoteMode).toHaveBeenCalled();
    });
  });
});
