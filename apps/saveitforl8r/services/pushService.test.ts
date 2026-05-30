import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@l8r/shared/platform', () => ({
  isNative: vi.fn(),
}));

vi.mock('@l8r/shared/ai', () => ({
  postProxy: vi.fn(),
}));

const mockPushNotifications = {
  requestPermissions: vi.fn(),
  register: vi.fn(),
  addListener: vi.fn(),
};

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: mockPushNotifications,
}));

import { registerPushToken, unregisterPushToken } from './pushService';
import { isNative } from '@l8r/shared/platform';
import { postProxy } from '@l8r/shared/ai';

const mockIsNative = vi.mocked(isNative);
const mockPostProxy = vi.mocked(postProxy);

describe('pushService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('registerPushToken', () => {
    it('should no-op on web', async () => {
      mockIsNative.mockReturnValue(false);

      await registerPushToken();

      expect(mockPushNotifications.requestPermissions).not.toHaveBeenCalled();
      expect(mockPushNotifications.register).not.toHaveBeenCalled();
    });

    it('should no-op when permission denied', async () => {
      mockIsNative.mockReturnValue(true);
      mockPushNotifications.requestPermissions.mockResolvedValue({ receive: 'denied' });

      await registerPushToken();

      expect(mockPushNotifications.requestPermissions).toHaveBeenCalled();
      expect(mockPushNotifications.register).not.toHaveBeenCalled();
    });

    it('should register for push when permission granted', async () => {
      mockIsNative.mockReturnValue(true);
      mockPushNotifications.requestPermissions.mockResolvedValue({ receive: 'granted' });
      mockPushNotifications.register.mockResolvedValue(undefined);
      mockPushNotifications.addListener.mockImplementation(() => ({ remove: vi.fn() }));

      await registerPushToken();

      expect(mockPushNotifications.requestPermissions).toHaveBeenCalled();
      expect(mockPushNotifications.register).toHaveBeenCalled();
      expect(mockPushNotifications.addListener).toHaveBeenCalledWith(
        'registration',
        expect.any(Function),
      );
      expect(mockPushNotifications.addListener).toHaveBeenCalledWith(
        'registrationError',
        expect.any(Function),
      );
      expect(mockPushNotifications.addListener).toHaveBeenCalledWith(
        'pushNotificationReceived',
        expect.any(Function),
      );
    });

    it('should handle PushNotifications import failure gracefully', async () => {
      mockIsNative.mockReturnValue(true);
      // Simulate the dynamic import failing by making requestPermissions throw
      mockPushNotifications.requestPermissions.mockRejectedValue(
        new Error('Module not found'),
      );
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await registerPushToken();

      expect(consoleSpy).toHaveBeenCalledWith('[Push] Setup error:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe('unregisterPushToken', () => {
    it('should no-op when no token registered', async () => {
      await unregisterPushToken();

      expect(mockPostProxy).not.toHaveBeenCalled();
    });

    it('should call postProxy to unsubscribe when token exists', async () => {
      // First register a token to set the internal state
      mockIsNative.mockReturnValue(true);
      mockPushNotifications.requestPermissions.mockResolvedValue({ receive: 'granted' });
      mockPushNotifications.register.mockResolvedValue(undefined);
      mockPostProxy.mockResolvedValue({} as any);

      let registrationCallback: (token: { value: string }) => Promise<void>;
      mockPushNotifications.addListener.mockImplementation((event: string, cb: any) => {
        if (event === 'registration') {
          registrationCallback = cb;
        }
        return { remove: vi.fn() };
      });

      await registerPushToken();
      // Simulate the registration callback firing
      await registrationCallback!({ value: 'test-fcm-token' });

      vi.clearAllMocks();
      mockPostProxy.mockResolvedValue({} as any);

      await unregisterPushToken();

      expect(mockPostProxy).toHaveBeenCalledWith('/api/push/unsubscribe', {
        token: 'test-fcm-token',
      });
    });

    it('should clear token even on server error', async () => {
      // Register a token first
      mockIsNative.mockReturnValue(true);
      mockPushNotifications.requestPermissions.mockResolvedValue({ receive: 'granted' });
      mockPushNotifications.register.mockResolvedValue(undefined);
      mockPostProxy.mockResolvedValue({} as any);

      let registrationCallback: (token: { value: string }) => Promise<void>;
      mockPushNotifications.addListener.mockImplementation((event: string, cb: any) => {
        if (event === 'registration') {
          registrationCallback = cb;
        }
        return { remove: vi.fn() };
      });

      await registerPushToken();
      await registrationCallback!({ value: 'test-fcm-token' });

      vi.clearAllMocks();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPostProxy.mockRejectedValue(new Error('Server error'));

      await unregisterPushToken();

      expect(mockPostProxy).toHaveBeenCalledWith('/api/push/unsubscribe', {
        token: 'test-fcm-token',
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Push] Failed to unregister token:',
        expect.any(Error),
      );

      // Token should be cleared — calling again should no-op
      vi.clearAllMocks();
      await unregisterPushToken();
      expect(mockPostProxy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
