/**
 * Morning Briefing Notification Provider
 *
 * Generates daily notifications summarizing calendar events and todo items.
 * Queries IndexedDB directly (not via React hooks) since this runs as a service.
 */

import { CalendarEvent, TodoItem } from '../../types';
import { getCalendarEvents, getTodoItems } from '../storageService';
import { storage } from '../platform';
import type { NotificationProvider, PendingNotification } from './types';

const ID_RANGE_START = 1000;
const ID_RANGE_SIZE = 1000;
const SCHEDULE_DAYS_AHEAD = 7;

const DEFAULT_NOTIFICATION_TIME = '07:00';
const PREF_NOTIFICATION_TIME = 'notification_time';

/** Get user-configured notification time (HH:MM format) */
const getNotificationTime = async (): Promise<{ hours: number; minutes: number }> => {
  const timeStr = await storage.get(PREF_NOTIFICATION_TIME) || DEFAULT_NOTIFICATION_TIME;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours: hours || 7, minutes: minutes || 0 };
};

/** Get the YYYY-MM-DD date string for a Date in local time */
const toLocalDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** Extract the YYYY-MM-DD portion from an ISO 8601 string */
const isoToDateKey = (iso: string): string => iso.slice(0, 10);

/** Get a human-readable day label */
const getDayLabel = (target: Date, today: Date): string => {
  const todayKey = toLocalDateKey(today);
  const targetKey = toLocalDateKey(target);

  if (targetKey === todayKey) return 'today';

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (targetKey === toLocalDateKey(tomorrow)) return 'tomorrow';

  return `on ${target.toLocaleDateString('en-US', { weekday: 'long' })}`;
};

/** Build notification body text */
const buildBody = (eventCount: number, todoCount: number, dayLabel: string): string => {
  const parts: string[] = [];

  if (eventCount > 0) {
    parts.push(`${eventCount} event${eventCount !== 1 ? 's' : ''}`);
  }
  if (todoCount > 0) {
    parts.push(`${todoCount} task${todoCount !== 1 ? 's' : ''}`);
  }

  if (dayLabel === 'today') {
    return `You have ${parts.join(' and ')} today`;
  }
  if (dayLabel === 'tomorrow') {
    return `You have ${parts.join(' and ')} tomorrow`;
  }
  return `You have ${parts.join(' and ')} ${dayLabel}`;
};

/** Determine deep-link route based on what items exist */
const getRoute = (hasEvents: boolean, hasTodos: boolean): string => {
  if (hasEvents && hasTodos) return 'home';
  if (hasEvents) return 'calendar';
  return 'todo';
};

/** Filter calendar events for a specific date key */
const getEventsForDate = (events: CalendarEvent[], dateKey: string): CalendarEvent[] => {
  return events.filter(e => {
    // Use occurrenceDate for recurring event instances, startDate otherwise
    const eventDateKey = e.occurrenceDate
      ? isoToDateKey(e.occurrenceDate)
      : isoToDateKey(e.startDate);
    return eventDateKey === dateKey && e.status !== 'cancelled';
  });
};

/** Filter pending todo items for a specific date key (or no-deadline todos for today) */
const getTodosForDate = (
  items: TodoItem[],
  dateKey: string,
  isToday: boolean,
): TodoItem[] => {
  return items.filter(item => {
    if (item.isCompleted || item.isDismissed) return false;
    if (item.deadline) {
      return isoToDateKey(item.deadline) === dateKey;
    }
    // No-deadline todos only count for today
    return isToday;
  });
};

export const morningBriefingProvider: NotificationProvider = {
  key: 'morning-briefing',
  idRangeStart: ID_RANGE_START,
  idRangeSize: ID_RANGE_SIZE,

  async getNotifications(): Promise<PendingNotification[]> {
    const [events, items, { hours, minutes }] = await Promise.all([
      getCalendarEvents(),
      getTodoItems(),
      getNotificationTime(),
    ]);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayKey = toLocalDateKey(today);
    const notifications: PendingNotification[] = [];

    for (let dayOffset = 0; dayOffset < SCHEDULE_DAYS_AHEAD; dayOffset++) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + dayOffset);

      // Build the scheduled time for this day
      const scheduledAt = new Date(
        targetDate.getFullYear(),
        targetDate.getMonth(),
        targetDate.getDate(),
        hours,
        minutes,
        0,
      );

      // Skip if the scheduled time is already in the past
      if (scheduledAt.getTime() <= now.getTime()) continue;

      const dateKey = toLocalDateKey(targetDate);
      const isToday = dateKey === todayKey;
      const dayEvents = getEventsForDate(events, dateKey);
      const dayTodos = getTodosForDate(items, dateKey, isToday);

      if (dayEvents.length === 0 && dayTodos.length === 0) continue;

      const dayLabel = getDayLabel(targetDate, today);
      const body = buildBody(dayEvents.length, dayTodos.length, dayLabel);
      const route = getRoute(dayEvents.length > 0, dayTodos.length > 0);

      notifications.push({
        id: ID_RANGE_START + dayOffset,
        title: "Good morning! Here's your day",
        body,
        scheduledAt,
        extra: { route },
      });
    }

    return notifications;
  },
};
