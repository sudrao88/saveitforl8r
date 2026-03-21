/**
 * Notification framework types.
 *
 * Each NotificationProvider owns a numeric ID range to avoid collisions.
 * New providers can be added via OTA updates without native app releases.
 *
 * ID Range Assignments:
 *   Morning Briefing: 1000–1999
 *   (Reserved):       2000–2999, 3000–3999, ...
 */

export interface PendingNotification {
  /** Numeric ID for @capacitor/local-notifications (must be within provider's range) */
  id: number;
  title: string;
  body: string;
  /** Exact local time to fire the notification */
  scheduledAt: Date;
  /** Deep-link or context data passed through notification tap */
  extra?: Record<string, string>;
}

export interface NotificationProvider {
  /** Unique string key, e.g. 'morning-briefing' */
  readonly key: string;
  /** Start of the numeric ID range this provider owns */
  readonly idRangeStart: number;
  /** Size of the ID range (IDs: [idRangeStart, idRangeStart + idRangeSize)) */
  readonly idRangeSize: number;
  /** Generate notifications to schedule. Must be idempotent — scheduler handles diffing. */
  getNotifications(): Promise<PendingNotification[]>;
}

/** Stored in Preferences to track what's currently scheduled */
export interface ScheduledNotificationRecord {
  id: number;
  scheduledAtISO: string;
  providerKey: string;
  title: string;
  body: string;
}
