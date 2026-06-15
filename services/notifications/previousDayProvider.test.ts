import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  previousDayProvider,
  buildPreviousDayBody,
  isPreviousDayNotificationEnabled,
  PREF_PREVIOUS_DAY_ENABLED,
  PREF_PREVIOUS_DAY_TIME,
} from './previousDayProvider';
import * as storageService from '../storageService';
import * as platform from '../platform';
import { CalendarEvent, TodoItem } from '../../types';

vi.mock('../storageService');
vi.mock('../platform');

const makeEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'evt-1',
  memoryId: 'mem-1',
  title: 'Team standup',
  startDate: '2026-03-22T10:00:00',
  allDay: false,
  status: 'confirmed',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

const makeTodo = (overrides: Partial<TodoItem> = {}): TodoItem => ({
  id: 'todo-1',
  memoryId: 'mem-1',
  title: 'Buy groceries',
  priority: 'medium',
  isCompleted: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

const stubStorage = (overrides: Record<string, string | null> = {}) => {
  const defaults: Record<string, string | null> = {
    [PREF_PREVIOUS_DAY_ENABLED]: 'true',
    [PREF_PREVIOUS_DAY_TIME]: '18:00',
  };
  (platform.storage.get as any).mockImplementation(async (key: string) => {
    if (key in overrides) return overrides[key];
    if (key in defaults) return defaults[key];
    return null;
  });
};

describe('previousDayProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubStorage();
    (storageService.getCalendarEvents as any).mockResolvedValue([]);
    (storageService.getTodoItems as any).mockResolvedValue([]);

    // Fix "now" to 2026-03-21 at 12:00 local time (noon, before 18:00 fire time)
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 21, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has correct provider metadata', () => {
    expect(previousDayProvider.key).toBe('previous-day');
    expect(previousDayProvider.idRangeStart).toBe(2000);
    expect(previousDayProvider.idRangeSize).toBe(1000);
  });

  it('returns empty array when no events or todos', async () => {
    const notifications = await previousDayProvider.getNotifications();
    expect(notifications).toEqual([]);
  });

  it('returns empty array when feature is disabled', async () => {
    stubStorage({ [PREF_PREVIOUS_DAY_ENABLED]: 'false' });
    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-22T10:00:00' }),
    ]);

    const notifications = await previousDayProvider.getNotifications();
    expect(notifications).toEqual([]);
  });

  it('defaults to enabled when no preference is stored', async () => {
    stubStorage({ [PREF_PREVIOUS_DAY_ENABLED]: null });
    expect(await isPreviousDayNotificationEnabled()).toBe(true);
  });

  it('schedules tonight for a single event tomorrow', async () => {
    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-22T10:00:00' }),
    ]);

    const notifications = await previousDayProvider.getNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].id).toBe(2022); // ID keyed by target date (3/22)
    expect(notifications[0].body).toBe('You have an upcoming event tomorrow');
    expect(notifications[0].title).toBe('Heads up for tomorrow');
    expect(notifications[0].extra?.route).toBe('calendar');
    // Should fire today at 18:00
    expect(notifications[0].scheduledAt.getDate()).toBe(21);
    expect(notifications[0].scheduledAt.getHours()).toBe(18);
    expect(notifications[0].scheduledAt.getMinutes()).toBe(0);
  });

  it('uses plural form for multiple events', async () => {
    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-22T10:00:00' }),
      makeEvent({ id: 'evt-2', startDate: '2026-03-22T14:00:00' }),
    ]);

    const notifications = await previousDayProvider.getNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].body).toBe('You have 2 upcoming events tomorrow');
  });

  it('combines events and todos in the message', async () => {
    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-22T10:00:00' }),
    ]);
    (storageService.getTodoItems as any).mockResolvedValue([
      makeTodo({ deadline: '2026-03-22' }),
      makeTodo({ id: 'todo-2', deadline: '2026-03-22' }),
    ]);

    const notifications = await previousDayProvider.getNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].body).toBe('You have an upcoming event and 2 tasks tomorrow');
    expect(notifications[0].extra?.route).toBe('home');
  });

  it('routes to todo screen when only tasks tomorrow', async () => {
    (storageService.getTodoItems as any).mockResolvedValue([
      makeTodo({ deadline: '2026-03-22' }),
    ]);

    const notifications = await previousDayProvider.getNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].body).toBe('You have a task tomorrow');
    expect(notifications[0].extra?.route).toBe('todo');
  });

  it('skips past fire times', async () => {
    // Move "now" to 20:00 — past the default 18:00 fire time
    vi.setSystemTime(new Date(2026, 2, 21, 20, 0, 0));

    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-22T10:00:00' }), // Tomorrow — fire time already passed
      makeEvent({ id: 'evt-2', startDate: '2026-03-23T10:00:00' }), // Day after — still upcoming
    ]);

    const notifications = await previousDayProvider.getNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].id).toBe(2023); // ID keyed by target date (3/23)
  });

  it('respects the configured time', async () => {
    stubStorage({ [PREF_PREVIOUS_DAY_TIME]: '20:30' });

    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-22T10:00:00' }),
    ]);

    const notifications = await previousDayProvider.getNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].scheduledAt.getHours()).toBe(20);
    expect(notifications[0].scheduledAt.getMinutes()).toBe(30);
  });

  it('does not fire when tomorrow has no items', async () => {
    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-25T10:00:00' }), // 4 days out
    ]);

    const notifications = await previousDayProvider.getNotifications();
    // Should fire on 2026-03-24 night announcing the 25th event
    expect(notifications).toHaveLength(1);
    expect(notifications[0].scheduledAt.getDate()).toBe(24);
  });

  it('schedules multiple previous-day notifications across the week', async () => {
    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-22T10:00:00' }),
      makeEvent({ id: 'evt-2', startDate: '2026-03-25T10:00:00' }),
    ]);

    const notifications = await previousDayProvider.getNotifications();
    expect(notifications).toHaveLength(2);
    // First fires tonight (3/21) for tomorrow (3/22), second fires 3/24 night for 3/25
    expect(notifications[0].scheduledAt.getDate()).toBe(21);
    expect(notifications[1].scheduledAt.getDate()).toBe(24);
    expect(notifications[0].id).toBe(2022); // target 3/22
    expect(notifications[1].id).toBe(2025); // target 3/25
  });

  it('skips cancelled events', async () => {
    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-22T10:00:00', status: 'cancelled' }),
    ]);

    const notifications = await previousDayProvider.getNotifications();
    expect(notifications).toEqual([]);
  });

  it('skips completed and dismissed todos', async () => {
    (storageService.getTodoItems as any).mockResolvedValue([
      makeTodo({ deadline: '2026-03-22', isCompleted: true }),
      makeTodo({ id: 'todo-2', deadline: '2026-03-22', isDismissed: true }),
    ]);

    const notifications = await previousDayProvider.getNotifications();
    expect(notifications).toEqual([]);
  });

  it('honors the edited startDate of a recurring occurrence, not the original occurrenceDate', async () => {
    // The occurrence was moved (edited) from its original 2026-03-15 slot to
    // tomorrow (2026-03-22). The heads-up must follow the edited startDate.
    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({
        startDate: '2026-03-22T10:00:00',
        occurrenceDate: '2026-03-15',
        recurringGroupId: 'group-1',
        isModifiedOccurrence: true,
      }),
    ]);

    const notifications = await previousDayProvider.getNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].body).toBe('You have an upcoming event tomorrow');
  });

  it('does not look beyond 7 days ahead', async () => {
    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-27T10:00:00' }), // 6 days out — fire day is dayOffset 5 (within)
      makeEvent({ id: 'evt-2', startDate: '2026-03-29T10:00:00' }), // 8 days out — fire day is dayOffset 7 (outside)
    ]);

    const notifications = await previousDayProvider.getNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].scheduledAt.getDate()).toBe(26); // Fires 3/26 for 3/27 event
  });
});

describe('buildPreviousDayBody', () => {
  it('matches the user-requested phrasing for a single event', () => {
    expect(buildPreviousDayBody(1, 0)).toBe('You have an upcoming event tomorrow');
  });

  it('pluralizes events', () => {
    expect(buildPreviousDayBody(3, 0)).toBe('You have 3 upcoming events tomorrow');
  });

  it('handles a single task', () => {
    expect(buildPreviousDayBody(0, 1)).toBe('You have a task tomorrow');
  });

  it('handles multiple tasks', () => {
    expect(buildPreviousDayBody(0, 4)).toBe('You have 4 tasks tomorrow');
  });

  it('combines single event and single task', () => {
    expect(buildPreviousDayBody(1, 1)).toBe('You have an upcoming event and a task tomorrow');
  });

  it('combines multiple events and tasks', () => {
    expect(buildPreviousDayBody(2, 3)).toBe('You have 2 upcoming events and 3 tasks tomorrow');
  });
});
