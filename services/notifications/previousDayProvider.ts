/**
 * Previous-Day Notification Provider
 *
 * Generates "heads-up" notifications the day before events and todos,
 * so users have time to prepare. Fires at a user-configured time
 * (defaults to 18:00 / 6 PM the day before).
 *
 * Independent toggle from the morning briefing — a user can enable
 * one, both, or neither.
 */

import { getCalendarEvents, getTodoItems } from '../storageService';
import { storage } from '../platform';
import {
  toLocalDateKey,
  getEventsForDate,
  getTodosForDate,
} from './morningBriefingProvider';
import type { NotificationProvider, PendingNotification } from './types';

const ID_RANGE_START = 2000;
const ID_RANGE_SIZE = 1000;
const SCHEDULE_DAYS_AHEAD = 7;

export const DEFAULT_PREVIOUS_DAY_TIME = '18:00';
export const PREF_PREVIOUS_DAY_ENABLED = 'previous_day_notification_enabled';
export const PREF_PREVIOUS_DAY_TIME = 'previous_day_notification_time';

/** Default ON — when a user opts into notifications they typically want both same-day and previous-day reminders. */
export const isPreviousDayNotificationEnabled = async (): Promise<boolean> => {
  const value = await storage.get(PREF_PREVIOUS_DAY_ENABLED);
  if (value === null) return true;
  return value === 'true';
};

export const setPreviousDayNotificationEnabled = async (enabled: boolean): Promise<void> => {
  await storage.set(PREF_PREVIOUS_DAY_ENABLED, String(enabled));
};

export const getPreviousDayNotificationTime = async (): Promise<string> => {
  return (await storage.get(PREF_PREVIOUS_DAY_TIME)) || DEFAULT_PREVIOUS_DAY_TIME;
};

export const setPreviousDayNotificationTime = async (time: string): Promise<void> => {
  await storage.set(PREF_PREVIOUS_DAY_TIME, time);
};

const parseTime = async (): Promise<{ hours: number; minutes: number }> => {
  const timeStr = await getPreviousDayNotificationTime();
  const [h, m] = timeStr.split(':').map(Number);
  return { hours: Number.isFinite(h) ? h : 18, minutes: Number.isFinite(m) ? m : 0 };
};

/** Build notification body text for a previous-day heads-up. */
export const buildPreviousDayBody = (eventCount: number, todoCount: number): string => {
  const parts: string[] = [];

  if (eventCount > 0) {
    parts.push(
      eventCount === 1 ? 'an upcoming event' : `${eventCount} upcoming events`,
    );
  }
  if (todoCount > 0) {
    parts.push(
      todoCount === 1 ? 'a task' : `${todoCount} tasks`,
    );
  }

  return `You have ${parts.join(' and ')} tomorrow`;
};

const getRoute = (hasEvents: boolean, hasTodos: boolean): string => {
  if (hasEvents && hasTodos) return 'home';
  if (hasEvents) return 'calendar';
  return 'todo';
};

export const previousDayProvider: NotificationProvider = {
  key: 'previous-day',
  idRangeStart: ID_RANGE_START,
  idRangeSize: ID_RANGE_SIZE,

  async getNotifications(): Promise<PendingNotification[]> {
    const enabled = await isPreviousDayNotificationEnabled();
    if (!enabled) return [];

    const [events, items, { hours, minutes }] = await Promise.all([
      getCalendarEvents(),
      getTodoItems(),
      parseTime(),
    ]);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const notifications: PendingNotification[] = [];

    // dayOffset is the day the notification FIRES; it announces items on dayOffset+1.
    for (let dayOffset = 0; dayOffset < SCHEDULE_DAYS_AHEAD; dayOffset++) {
      const fireDate = new Date(today);
      fireDate.setDate(fireDate.getDate() + dayOffset);

      const scheduledAt = new Date(
        fireDate.getFullYear(),
        fireDate.getMonth(),
        fireDate.getDate(),
        hours,
        minutes,
        0,
      );

      if (scheduledAt.getTime() <= now.getTime()) continue;

      const targetDate = new Date(fireDate);
      targetDate.setDate(targetDate.getDate() + 1);
      const targetKey = toLocalDateKey(targetDate);

      const dayEvents = getEventsForDate(events, targetKey);
      const dayTodos = getTodosForDate(items, targetKey);

      if (dayEvents.length === 0 && dayTodos.length === 0) continue;

      const body = buildPreviousDayBody(dayEvents.length, dayTodos.length);
      const route = getRoute(dayEvents.length > 0, dayTodos.length > 0);

      // Key the ID by the day of the announced (target) date so it stays stable
      // across days. Within a 7-day window all day-of-month values are unique,
      // so this keeps the diff scheduler from rescheduling every day.
      notifications.push({
        id: ID_RANGE_START + targetDate.getDate(),
        title: 'Heads up for tomorrow',
        body,
        scheduledAt,
        // targetDate lets the calendar deep-link scroll to the announced day's
        // events instead of opening at today.
        extra: { route, targetDate: targetKey },
      });
    }

    return notifications;
  },
};
