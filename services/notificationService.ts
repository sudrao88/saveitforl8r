/**
 * Notification Scheduler Service
 *
 * Orchestrates notification scheduling across all registered providers.
 * Uses a diff-based approach: compares desired notifications against
 * what's currently scheduled, then only cancels/adds what changed.
 *
 * Native: Uses @capacitor/local-notifications for scheduled delivery.
 * Web: Uses the browser Notification API with on-open checks.
 */

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { isNative, storage } from './platform';
import {
  morningBriefingProvider,
  toLocalDateKey,
  getEventsForDate,
  getTodosForDate,
  buildBody,
} from './notifications/morningBriefingProvider';
import type {
  NotificationProvider,
  PendingNotification,
  ScheduledNotificationRecord,
} from './notifications/types';

const PREF_SCHEDULED_IDS = 'notification_scheduled_ids';
const PREF_NOTIFICATION_ENABLED = 'notification_enabled';
const PREF_WEB_LAST_SHOWN_DATE = 'notification_web_last_shown';

// Action type ID for notifications — registering a category with no custom actions
// makes iOS open the app directly on tap instead of showing an intermediate "Open" CTA.
const ACTION_TYPE_OPEN = 'OPEN_APP';

// Provider registry — add new providers here (OTA-updatable)
const providers: NotificationProvider[] = [morningBriefingProvider];

// ─── Permission helpers ─────────────────────────────────────────────

export const checkNotificationPermission = async (): Promise<'granted' | 'denied' | 'prompt'> => {
  if (isNative()) {
    const { display } = await LocalNotifications.checkPermissions();
    if (display === 'granted') return 'granted';
    if (display === 'denied') return 'denied';
    return 'prompt';
  }
  // Web
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return 'prompt';
};

export const requestNotificationPermission = async (): Promise<'granted' | 'denied' | 'prompt'> => {
  if (isNative()) {
    const { display } = await LocalNotifications.requestPermissions();
    if (display === 'granted') return 'granted';
    if (display === 'denied') return 'denied';
    return 'prompt';
  }
  // Web
  if (!('Notification' in window)) return 'denied';
  const result = await Notification.requestPermission();
  if (result === 'granted') return 'granted';
  if (result === 'denied') return 'denied';
  return 'prompt';
};

/**
 * Opens the device's notification settings for this app.
 * Used when permission was previously denied and cannot be re-prompted.
 */
export const openNotificationSettings = (): void => {
  if (!isNative()) return;
  const platform = Capacitor.getPlatform();
  if (platform === 'android') {
    window.AndroidBridge?.openNotificationSettings();
  } else if (platform === 'ios') {
    window.webkit?.messageHandlers?.IOSBridge?.postMessage({ action: 'openNotificationSettings' });
  }
};

// ─── Exact alarm helpers (Android 12+) ──────────────────────────────

/**
 * Check whether the OS has granted the exact alarm permission.
 * Returns 'granted' on non-Android platforms or Android < 12.
 */
export const checkExactAlarmPermission = async (): Promise<'granted' | 'denied'> => {
  if (!isNative() || Capacitor.getPlatform() !== 'android') return 'granted';
  try {
    const { exact_alarm } = await LocalNotifications.checkExactNotificationSetting();
    return exact_alarm === 'granted' ? 'granted' : 'denied';
  } catch {
    // API not available (older Capacitor or Android < 12) — exact alarms work by default
    return 'granted';
  }
};

/**
 * Open the OS settings page where the user can grant exact alarm permission.
 * Only meaningful on Android 12+; no-op on other platforms.
 */
export const requestExactAlarmPermission = async (): Promise<'granted' | 'denied'> => {
  if (!isNative() || Capacitor.getPlatform() !== 'android') return 'granted';
  try {
    await LocalNotifications.changeExactNotificationSetting();
    // Re-check after the user returns from settings
    return checkExactAlarmPermission();
  } catch {
    return 'denied';
  }
};

// ─── Settings helpers ───────────────────────────────────────────────

export const isNotificationEnabled = async (): Promise<boolean> => {
  const value = await storage.get(PREF_NOTIFICATION_ENABLED);
  // Default: disabled (user must explicitly enable via permission grant)
  return value === 'true';
};

export const setNotificationEnabled = async (enabled: boolean): Promise<void> => {
  await storage.set(PREF_NOTIFICATION_ENABLED, String(enabled));
  if (!enabled) {
    await cancelAllNotifications();
  }
};

export const getNotificationTime = async (): Promise<string> => {
  return (await storage.get('notification_time')) || '07:00';
};

export const setNotificationTime = async (time: string): Promise<void> => {
  await storage.set('notification_time', time);
};

// ─── Native scheduling ─────────────────────────────────────────────

const getStoredSchedule = async (): Promise<ScheduledNotificationRecord[]> => {
  const raw = await storage.get(PREF_SCHEDULED_IDS);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

const saveSchedule = async (records: ScheduledNotificationRecord[]): Promise<void> => {
  await storage.set(PREF_SCHEDULED_IDS, JSON.stringify(records));
};

/** Register notification action types on iOS so tapping opens the app directly (once per session) */
const registerActionTypes = (() => {
  let registered = false;
  return async (): Promise<void> => {
    if (registered) return;
    try {
      await LocalNotifications.registerActionTypes({
        types: [{ id: ACTION_TYPE_OPEN, actions: [] }],
      });
      registered = true;
    } catch (err) {
      console.debug('[Notifications] Action type registration error:', err);
    }
  };
})();

const synchronizeNative = async (): Promise<void> => {
  // Register action types so iOS handles taps directly
  await registerActionTypes();

  // Check if exact alarms are available (Android 12+)
  const exactAlarmGranted = await checkExactAlarmPermission() === 'granted';

  // Collect desired notifications from all providers
  const desired: (PendingNotification & { providerKey: string })[] = [];
  for (const provider of providers) {
    const notifications = await provider.getNotifications();
    for (const n of notifications) {
      desired.push({ ...n, providerKey: provider.key });
    }
  }

  // Load previously scheduled
  const stored = await getStoredSchedule();
  const storedMap = new Map(stored.map(r => [r.id, r]));
  const desiredMap = new Map(desired.map(n => [n.id, n]));

  // Compute diff
  const toCancel: number[] = [];
  const toSchedule: (PendingNotification & { providerKey: string })[] = [];

  // Find removals and changes
  for (const [id, record] of storedMap) {
    const d = desiredMap.get(id);
    if (!d) {
      toCancel.push(id);
    } else if (
      d.scheduledAt.toISOString() !== record.scheduledAtISO ||
      d.title !== record.title ||
      d.body !== record.body
    ) {
      // Time or content changed — cancel old, schedule new
      toCancel.push(id);
      toSchedule.push(d);
    }
  }

  // Find additions
  for (const [id, n] of desiredMap) {
    if (!storedMap.has(id)) {
      toSchedule.push(n);
    }
  }

  // Cancel removed/changed notifications
  if (toCancel.length > 0) {
    try {
      await LocalNotifications.cancel({
        notifications: toCancel.map(id => ({ id })),
      });
    } catch (err) {
      console.error('[Notifications] Cancel error:', err);
    }
  }

  // Schedule new/changed notifications
  if (toSchedule.length > 0) {
    try {
      await LocalNotifications.schedule({
        notifications: toSchedule.map(n => ({
          id: n.id,
          title: n.title,
          body: n.body,
          schedule: {
            at: n.scheduledAt,
            allowWhileIdle: exactAlarmGranted,
          },
          extra: n.extra,
          actionTypeId: ACTION_TYPE_OPEN,
        })),
      });
    } catch (err) {
      console.error('[Notifications] Schedule error:', err);
    }
  }

  // Persist new state
  const newRecords: ScheduledNotificationRecord[] = desired.map(n => ({
    id: n.id,
    scheduledAtISO: n.scheduledAt.toISOString(),
    providerKey: n.providerKey,
    title: n.title,
    body: n.body,
  }));
  await saveSchedule(newRecords);

  if (toCancel.length > 0 || toSchedule.length > 0) {
    console.log(
      `[Notifications] Synced: ${toSchedule.length} scheduled, ${toCancel.length} cancelled, ${desired.length} total`,
    );
  }
};

// ─── Web scheduling (best-effort) ──────────────────────────────────

const synchronizeWeb = async (): Promise<void> => {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // On-open check: if it's past the configured notification time today
  // and we haven't shown a notification yet today, show one now.
  const lastShown = await storage.get(PREF_WEB_LAST_SHOWN_DATE);
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  if (lastShown === todayKey) return; // Already shown today

  const timeStr = (await storage.get('notification_time')) || '07:00';
  const [hours, minutes] = timeStr.split(':').map(Number);
  const notifTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours || 7, minutes || 0);

  if (now.getTime() < notifTime.getTime()) return; // Not yet time

  // Reuse morningBriefingProvider's filtering logic to build today's notification
  const { getCalendarEvents, getTodoItems } = await import('./storageService');
  const [events, items] = await Promise.all([getCalendarEvents(), getTodoItems()]);

  const todayEvents = getEventsForDate(events, todayKey);
  const todayTodos = getTodosForDate(items, todayKey);

  if (todayEvents.length === 0 && todayTodos.length === 0) return;

  const body = buildBody(todayEvents.length, todayTodos.length, 'today');

  // Show web notification
  try {
    new Notification("Good morning! Here's your day", {
      body,
      icon: '/icon.svg',
      data: { route: todayEvents.length > 0 ? 'calendar' : 'todo' },
    });
    await storage.set(PREF_WEB_LAST_SHOWN_DATE, todayKey);
  } catch (err) {
    console.error('[Notifications] Web notification error:', err);
  }
};

// Register periodic sync for PWA (best-effort, Chrome only)
export const registerPeriodicSync = async (): Promise<void> => {
  if (isNative() || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    if ('periodicSync' in registration) {
      await (registration as any).periodicSync.register('morning-briefing-check', {
        minInterval: 12 * 60 * 60 * 1000, // 12 hours
      });
      console.log('[Notifications] Periodic sync registered');
    }
  } catch (err) {
    // periodicSync not available or permission denied — expected on most browsers
    console.debug('[Notifications] Periodic sync not available:', err);
  }
};

// ─── Public API ─────────────────────────────────────────────────────

export const synchronizeNotifications = async (): Promise<void> => {
  try {
    const enabled = await isNotificationEnabled();
    if (!enabled) return;

    if (isNative()) {
      const perm = await checkNotificationPermission();
      if (perm !== 'granted') return;
      await synchronizeNative();
    } else {
      await synchronizeWeb();
    }
  } catch (err) {
    console.error('[Notifications] Sync error:', err);
  }
};

export const cancelAllNotifications = async (): Promise<void> => {
  try {
    if (isNative()) {
      const stored = await getStoredSchedule();
      if (stored.length > 0) {
        await LocalNotifications.cancel({
          notifications: stored.map(r => ({ id: r.id })),
        });
      }
    }
    await saveSchedule([]);
    console.log('[Notifications] All notifications cancelled');
  } catch (err) {
    console.error('[Notifications] Cancel all error:', err);
  }
};
