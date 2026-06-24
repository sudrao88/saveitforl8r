/**
 * useNotifications.ts
 *
 * React hook for managing the notification scheduling lifecycle.
 * Handles permission, settings, and triggers re-scheduling on
 * app resume and data changes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { isNative } from '../services/platform';
import { CalendarEvent, TodoItem } from '../types';
import {
  synchronizeNotifications,
  checkNotificationPermission,
  requestNotificationPermission,
  openNotificationSettings,
  isNotificationEnabled,
  setNotificationEnabled as setEnabledPref,
  getNotificationTime as getTimePref,
  setNotificationTime as setTimePref,
  isPreviousDayNotificationEnabled,
  setPreviousDayNotificationEnabled as setPreviousDayEnabledPref,
  getPreviousDayNotificationTime as getPreviousDayTimePref,
  setPreviousDayNotificationTime as setPreviousDayTimePref,
  registerPeriodicSync,
  cancelAllNotifications,
  checkExactAlarmPermission,
  requestExactAlarmPermission,
} from '../services/notificationService';

export interface UseNotificationsReturn {
  permissionStatus: 'granted' | 'denied' | 'prompt';
  isEnabled: boolean;
  notificationTime: string;
  /** Whether the previous-day heads-up notification is enabled. */
  previousDayEnabled: boolean;
  /** Time of day to fire the previous-day heads-up notification (HH:MM). */
  previousDayTime: string;
  requestPermission: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setNotificationTime: (time: string) => Promise<void>;
  setPreviousDayEnabled: (enabled: boolean) => Promise<void>;
  setPreviousDayTime: (time: string) => Promise<void>;
  isSupported: boolean;
  /** Route to navigate to when a notification is tapped */
  pendingRoute: string | null;
  /** YYYY-MM-DD of the day a tapped notification announced, so the calendar can scroll to it */
  pendingDateKey: string | null;
  clearPendingRoute: () => void;
  /** Opens device notification settings (native only) */
  openSettings: () => void;
}

const DEBOUNCE_MS = 2000;

/**
 * Read the notification deep-link the service worker placed on the PWA URL
 * (/?route=...&date=...). Web only — native taps arrive via a Capacitor
 * listener instead.
 */
const readWebDeepLink = (): { route: string | null; date: string | null } => {
  if (isNative()) return { route: null, date: null };
  const params = new URLSearchParams(window.location.search);
  return { route: params.get('route'), date: params.get('date') };
};

export const useNotifications = (
  calendarEvents: CalendarEvent[],
  todoItems: TodoItem[],
): UseNotificationsReturn => {
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [isEnabled, setIsEnabled] = useState(false);
  const [notificationTime, setNotificationTime] = useState('07:00');
  const [previousDayEnabled, setPreviousDayEnabled] = useState(true);
  const [previousDayTime, setPreviousDayTime] = useState('18:00');
  // Seed from the web deep-link URL at mount so the app can open the right
  // sheet on first render (native taps update these via the listener below).
  const [pendingRoute, setPendingRoute] = useState<string | null>(() => readWebDeepLink().route);
  const [pendingDateKey, setPendingDateKey] = useState<string | null>(() => readWebDeepLink().date);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);

  const isSupported = isNative() || ('Notification' in window);

  // Load settings on mount
  useEffect(() => {
    const init = async () => {
      const [perm, enabled, time, prevEnabled, prevTime] = await Promise.all([
        checkNotificationPermission(),
        isNotificationEnabled(),
        getTimePref(),
        isPreviousDayNotificationEnabled(),
        getPreviousDayTimePref(),
      ]);
      setPermissionStatus(perm);
      setIsEnabled(enabled);
      setNotificationTime(time);
      setPreviousDayEnabled(prevEnabled);
      setPreviousDayTime(prevTime);
      initialized.current = true;

      // Initial sync
      if (enabled && perm === 'granted') {
        await synchronizeNotifications();
      }

      // Register periodic sync for PWA
      if (!isNative() && enabled && perm === 'granted') {
        registerPeriodicSync();
      }
    };
    init();
  }, []);

  // Listen for notification tap (deep-link)
  useEffect(() => {
    if (!isNative()) return;

    const listener = LocalNotifications.addListener(
      'localNotificationActionPerformed',
      (event) => {
        const route = event.notification.extra?.route;
        if (route) {
          setPendingRoute(route);
          setPendingDateKey(event.notification.extra?.targetDate ?? null);
        }
      },
    );

    return () => {
      listener.then(h => h.remove()).catch(err => console.debug('[Notifications] Listener cleanup error:', err));
    };
  }, []);

  // The deep-link params were seeded into pending state at mount; strip them
  // from the URL so a reload or share doesn't re-trigger the navigation.
  useEffect(() => {
    if (isNative()) return;

    const params = new URLSearchParams(window.location.search);
    if (!params.has('route') && !params.has('date')) return;

    params.delete('route');
    params.delete('date');
    const query = params.toString();
    const newUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', newUrl);
  }, []);

  // Re-check permission and re-sync on app resume (native only).
  // The user may have just returned from device settings after enabling permission.
  useEffect(() => {
    if (!isNative()) return;

    const listener = CapacitorApp.addListener('appStateChange', async ({ isActive }) => {
      if (isActive) {
        const perm = await checkNotificationPermission();
        setPermissionStatus(perm);
        if (perm === 'granted') {
          synchronizeNotifications();
        }
      }
    });

    return () => {
      listener.then(h => h.remove()).catch(err => console.debug('[Notifications] Listener cleanup error:', err));
    };
  }, []);

  // Debounced re-sync when data changes
  useEffect(() => {
    if (!initialized.current) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      synchronizeNotifications();
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [calendarEvents, todoItems]);

  const requestPermission = useCallback(async () => {
    const result = await requestNotificationPermission();
    setPermissionStatus(result);
    if (result === 'granted') {
      await synchronizeNotifications();
      if (!isNative()) {
        registerPeriodicSync();
      }
    }
  }, []);

  const setEnabled = useCallback(async (enabled: boolean) => {
    if (enabled) {
      // Always attempt the system permission request first.
      // The OS decides whether to show a popup:
      //   - iOS: popup shown only on the very first call, silently 'denied' after.
      //   - Android 13+: popup shown up to twice, silently 'denied' once "Don't ask again" is set.
      //   - Web: popup shown while Notification.permission === 'default'; silently 'denied' after explicit block.
      const perm = await requestNotificationPermission();
      setPermissionStatus(perm);

      if (perm !== 'granted') {
        // Permission denied or dismissed — keep setting off
        setIsEnabled(false);
        await setEnabledPref(false);
        // If the OS could not show a popup (permanent denial), redirect to settings
        if (perm === 'denied') {
          openNotificationSettings();
        }
        return;
      }

      // On Android 12+, request exact alarm permission for precise scheduling.
      // If denied, notifications still work but may be delayed by Doze mode.
      const exactStatus = await checkExactAlarmPermission();
      if (exactStatus !== 'granted') {
        await requestExactAlarmPermission();
      }

      setIsEnabled(true);
      await setEnabledPref(true);
      await synchronizeNotifications();
    } else {
      setIsEnabled(false);
      await setEnabledPref(false);
      // cancelAllNotifications is called inside setEnabledPref when disabled
    }
  }, []);

  const setTime = useCallback(async (time: string) => {
    setNotificationTime(time);
    await setTimePref(time);
    // Reschedule with new time
    await cancelAllNotifications();
    await synchronizeNotifications();
  }, []);

  const setPreviousDayEnabledHandler = useCallback(async (enabled: boolean) => {
    setPreviousDayEnabled(enabled);
    await setPreviousDayEnabledPref(enabled);
    // The diff-based scheduler will cancel previous-day notifications when the
    // provider returns an empty list (disabled) and add them back when enabled.
    await synchronizeNotifications();
  }, []);

  const setPreviousDayTimeHandler = useCallback(async (time: string) => {
    setPreviousDayTime(time);
    await setPreviousDayTimePref(time);
    await synchronizeNotifications();
  }, []);

  const clearPendingRoute = useCallback(() => {
    setPendingRoute(null);
    setPendingDateKey(null);
  }, []);

  return {
    permissionStatus,
    isEnabled,
    notificationTime,
    previousDayEnabled,
    previousDayTime,
    requestPermission,
    setEnabled,
    setNotificationTime: setTime,
    setPreviousDayEnabled: setPreviousDayEnabledHandler,
    setPreviousDayTime: setPreviousDayTimeHandler,
    isSupported,
    pendingRoute,
    pendingDateKey,
    clearPendingRoute,
    openSettings: openNotificationSettings,
  };
};
