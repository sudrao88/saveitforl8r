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
  isNotificationEnabled,
  setNotificationEnabled as setEnabledPref,
  getNotificationTime as getTimePref,
  setNotificationTime as setTimePref,
  registerPeriodicSync,
  cancelAllNotifications,
} from '../services/notificationService';

export interface UseNotificationsReturn {
  permissionStatus: 'granted' | 'denied' | 'prompt';
  isEnabled: boolean;
  notificationTime: string;
  requestPermission: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setNotificationTime: (time: string) => Promise<void>;
  isSupported: boolean;
  /** Route to navigate to when a notification is tapped */
  pendingRoute: string | null;
  clearPendingRoute: () => void;
}

const DEBOUNCE_MS = 2000;

export const useNotifications = (
  calendarEvents: CalendarEvent[],
  todoItems: TodoItem[],
): UseNotificationsReturn => {
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [isEnabled, setIsEnabled] = useState(true);
  const [notificationTime, setNotificationTime] = useState('07:00');
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);

  const isSupported = isNative() || ('Notification' in window);

  // Load settings on mount
  useEffect(() => {
    const init = async () => {
      const [perm, enabled, time] = await Promise.all([
        checkNotificationPermission(),
        isNotificationEnabled(),
        getTimePref(),
      ]);
      setPermissionStatus(perm);
      setIsEnabled(enabled);
      setNotificationTime(time);
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
        }
      },
    );

    return () => {
      listener.then(h => h.remove()).catch(err => console.debug('[Notifications] Listener cleanup error:', err));
    };
  }, []);

  // Re-sync on app resume (native only)
  useEffect(() => {
    if (!isNative()) return;

    const listener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        synchronizeNotifications();
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
    setIsEnabled(enabled);
    await setEnabledPref(enabled);
    if (enabled) {
      // Request permission if needed
      const perm = await checkNotificationPermission();
      if (perm === 'prompt') {
        const result = await requestNotificationPermission();
        setPermissionStatus(result);
        if (result !== 'granted') return;
      } else if (perm !== 'granted') {
        return;
      }
      await synchronizeNotifications();
    }
    // cancelAllNotifications is called inside setEnabledPref when disabled
  }, []);

  const setTime = useCallback(async (time: string) => {
    setNotificationTime(time);
    await setTimePref(time);
    // Reschedule with new time
    await cancelAllNotifications();
    await synchronizeNotifications();
  }, []);

  const clearPendingRoute = useCallback(() => {
    setPendingRoute(null);
  }, []);

  return {
    permissionStatus,
    isEnabled,
    notificationTime,
    requestPermission,
    setEnabled,
    setNotificationTime: setTime,
    isSupported,
    pendingRoute,
    clearPendingRoute,
  };
};
