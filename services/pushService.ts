/**
 * Push subscription management for native platforms.
 * Registers device tokens (FCM on Android, APNS on iOS) with the server
 * for silent push notifications. Web platforms are excluded since browsers
 * require visible notifications for push events.
 */

import { isNative } from './platform';
import { postProxy } from './proxyService';

// Store the current token to avoid redundant registrations
let registeredToken: string | null = null;

/**
 * Detect whether the native platform is Android or iOS based on user agent.
 */
function detectNativePlatform(): 'android' | 'ios' {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  return 'ios';
}

/**
 * Register the device's push token with the server.
 * Only works on native platforms (Capacitor).
 * Called on app startup after authentication.
 */
export const registerPushToken = async (): Promise<void> => {
  if (!isNative()) return; // Web doesn't use push for background sync

  try {
    // Dynamic import of Capacitor push plugin to avoid bundling on web.
    // The package may not be installed — the try/catch handles that gracefully.
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // Request permission (no-ops if already granted)
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') return;

    // Register for push notifications
    await PushNotifications.register();

    // Listen for the token
    PushNotifications.addListener('registration', async (token) => {
      if (token.value === registeredToken) return; // Already registered

      const platform = detectNativePlatform();
      try {
        await postProxy('/api/push/subscribe', {
          token: token.value,
          platform,
        } as unknown as Record<string, unknown>);
        registeredToken = token.value;
        console.log(`[Push] Registered ${platform} push token`);
      } catch (err) {
        console.error('[Push] Failed to register token:', err);
      }
    });

    // Handle registration errors
    PushNotifications.addListener('registrationError', (err) => {
      console.error('[Push] Registration error:', err);
    });

    // Handle incoming data messages (silent push).
    // This wakes the app to run the background pipeline.
    PushNotifications.addListener('pushNotificationReceived', async (notification) => {
      const data = notification.data as Record<string, string> | undefined;
      if (
        data?.type === 'enrichment-complete' ||
        data?.type === 'moment-complete' ||
        data?.type === 'synthesis-complete'
      ) {
        // Dynamic import to avoid circular dependencies
        const { runBackgroundPipeline } = await import('./backgroundPipeline');
        await runBackgroundPipeline({
          type: data.type as 'enrichment-complete' | 'moment-complete' | 'synthesis-complete',
          memoryId: data.memoryId,
          momentId: data.momentId,
        });
      }
    });
  } catch (err) {
    console.error('[Push] Setup error:', err);
  }
};

/**
 * Unregister the current push token from the server.
 * Called on logout.
 */
export const unregisterPushToken = async (): Promise<void> => {
  if (!registeredToken) return;

  try {
    await postProxy('/api/push/unsubscribe', {
      token: registeredToken,
    } as unknown as Record<string, unknown>);
    registeredToken = null;
  } catch (err) {
    console.error('[Push] Failed to unregister token:', err);
    registeredToken = null; // Clear anyway
  }
};
