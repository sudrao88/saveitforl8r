import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@l8r/shared/platform', () => ({
  isNative: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(),
  },
}));

import {
  initNativeBackgroundSync,
  startForegroundSync,
  updateForegroundSyncProgress,
  stopForegroundSync,
} from './nativeBackgroundSync';
import { isNative } from '@l8r/shared/platform';
import { Capacitor } from '@capacitor/core';

const mockIsNative = vi.mocked(isNative);
const mockGetPlatform = vi.mocked(Capacitor.getPlatform);

describe('nativeBackgroundSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.AndroidBridge = {
      startForegroundSync: vi.fn(),
      updateSyncProgress: vi.fn(),
      stopForegroundSync: vi.fn(),
    } as any;
  });

  afterEach(() => {
    delete (window as any).AndroidBridge;
  });

  describe('initNativeBackgroundSync', () => {
    it('should no-op on web', async () => {
      mockIsNative.mockReturnValue(false);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await initNativeBackgroundSync();

      expect(mockGetPlatform).not.toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log platform on native', async () => {
      mockIsNative.mockReturnValue(true);
      mockGetPlatform.mockReturnValue('android');
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await initNativeBackgroundSync();

      expect(mockGetPlatform).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[NativeBackgroundSync] Initialized on android',
      );
      consoleSpy.mockRestore();
    });
  });

  describe('startForegroundSync', () => {
    it('should no-op on web', async () => {
      mockIsNative.mockReturnValue(false);

      await startForegroundSync(10);

      expect(window.AndroidBridge?.startForegroundSync).not.toHaveBeenCalled();
    });

    it('should no-op on iOS', async () => {
      mockIsNative.mockReturnValue(true);
      mockGetPlatform.mockReturnValue('ios');

      await startForegroundSync(10);

      expect(window.AndroidBridge?.startForegroundSync).not.toHaveBeenCalled();
    });

    it('should call AndroidBridge.startForegroundSync on Android', async () => {
      mockIsNative.mockReturnValue(true);
      mockGetPlatform.mockReturnValue('android');

      await startForegroundSync(10);

      expect(window.AndroidBridge?.startForegroundSync).toHaveBeenCalledWith(10);
    });

    it('should handle missing bridge gracefully', async () => {
      mockIsNative.mockReturnValue(true);
      mockGetPlatform.mockReturnValue('android');
      delete (window as any).AndroidBridge;

      // Should not throw
      await startForegroundSync(10);
    });
  });

  describe('updateForegroundSyncProgress', () => {
    it('should no-op on web', async () => {
      mockIsNative.mockReturnValue(false);

      await updateForegroundSyncProgress(5, 10);

      expect(window.AndroidBridge?.updateSyncProgress).not.toHaveBeenCalled();
    });

    it('should call AndroidBridge.updateSyncProgress on native', async () => {
      mockIsNative.mockReturnValue(true);

      await updateForegroundSyncProgress(5, 10);

      expect(window.AndroidBridge?.updateSyncProgress).toHaveBeenCalledWith(5, 10);
    });
  });

  describe('stopForegroundSync', () => {
    it('should no-op on web', async () => {
      mockIsNative.mockReturnValue(false);

      await stopForegroundSync();

      expect(window.AndroidBridge?.stopForegroundSync).not.toHaveBeenCalled();
    });

    it('should call AndroidBridge.stopForegroundSync on native', async () => {
      mockIsNative.mockReturnValue(true);

      await stopForegroundSync();

      expect(window.AndroidBridge?.stopForegroundSync).toHaveBeenCalled();
    });
  });
});
