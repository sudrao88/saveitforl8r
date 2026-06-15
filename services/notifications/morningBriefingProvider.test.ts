import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { morningBriefingProvider } from './morningBriefingProvider';
import * as storageService from '../storageService';
import * as platform from '../platform';
import { CalendarEvent, TodoItem } from '../../types';

vi.mock('../storageService');
vi.mock('../platform');

const makeEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'evt-1',
  memoryId: 'mem-1',
  title: 'Team standup',
  startDate: '2026-03-21T10:00:00',
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

describe('morningBriefingProvider', () => {
  let realDate: typeof Date;

  beforeEach(() => {
    vi.clearAllMocks();
    (platform.storage.get as any).mockResolvedValue('07:00');
    (storageService.getCalendarEvents as any).mockResolvedValue([]);
    (storageService.getTodoItems as any).mockResolvedValue([]);

    // Fix "now" to 2026-03-21 at 06:00 local time (before 7 AM)
    realDate = globalThis.Date;
    const fixedNow = new realDate(2026, 2, 21, 6, 0, 0); // March 21, 2026 6:00 AM
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has correct provider metadata', () => {
    expect(morningBriefingProvider.key).toBe('morning-briefing');
    expect(morningBriefingProvider.idRangeStart).toBe(1000);
    expect(morningBriefingProvider.idRangeSize).toBe(1000);
  });

  it('returns empty array when no events or todos', async () => {
    const notifications = await morningBriefingProvider.getNotifications();
    expect(notifications).toEqual([]);
  });

  it('generates notification for today with events only', async () => {
    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-21T10:00:00' }),
      makeEvent({ id: 'evt-2', startDate: '2026-03-21T14:00:00' }),
    ]);

    const notifications = await morningBriefingProvider.getNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].id).toBe(1000); // dayOffset 0
    expect(notifications[0].body).toBe('You have 2 events today');
    expect(notifications[0].extra?.route).toBe('calendar');
  });

  it('generates notification for today with todos only', async () => {
    (storageService.getTodoItems as any).mockResolvedValue([
      makeTodo({ deadline: '2026-03-21' }),
    ]);

    const notifications = await morningBriefingProvider.getNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].body).toBe('You have 1 task today');
    expect(notifications[0].extra?.route).toBe('todo');
  });

  it('generates notification with both events and todos', async () => {
    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-21T10:00:00' }),
    ]);
    (storageService.getTodoItems as any).mockResolvedValue([
      makeTodo({ deadline: '2026-03-21' }),
      makeTodo({ id: 'todo-2', deadline: '2026-03-21' }),
    ]);

    const notifications = await morningBriefingProvider.getNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].body).toBe('You have 1 event and 2 tasks today');
    expect(notifications[0].extra?.route).toBe('home');
  });

  it('excludes no-deadline todos from notifications', async () => {
    (storageService.getTodoItems as any).mockResolvedValue([
      makeTodo({ deadline: undefined }), // No deadline — should not trigger notification
    ]);

    const notifications = await morningBriefingProvider.getNotifications();
    expect(notifications).toEqual([]);
  });

  it('includes todos only when they have a deadline matching the day', async () => {
    (storageService.getTodoItems as any).mockResolvedValue([
      makeTodo({ deadline: '2026-03-21' }),           // Due today — included
      makeTodo({ id: 'todo-2', deadline: undefined }), // No deadline — excluded
      makeTodo({ id: 'todo-3', deadline: '2026-03-25' }), // Due later — excluded for today
    ]);

    const notifications = await morningBriefingProvider.getNotifications();
    // Today's notification should only count the 1 todo due today
    const todayNotif = notifications.find(n => n.id === 1000);
    expect(todayNotif).toBeDefined();
    expect(todayNotif!.body).toBe('You have 1 task today');
    // Future day should have 1 todo
    const futureNotif = notifications.find(n => n.id === 1004);
    expect(futureNotif).toBeDefined();
    expect(futureNotif!.body).toBe('You have 1 task today');
  });

  it('schedules notifications for multiple upcoming days', async () => {
    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-21T10:00:00' }),
      makeEvent({ id: 'evt-2', startDate: '2026-03-23T14:00:00' }),
    ]);

    const notifications = await morningBriefingProvider.getNotifications();
    expect(notifications).toHaveLength(2);
    expect(notifications[0].id).toBe(1000); // today (dayOffset 0)
    expect(notifications[1].id).toBe(1002); // day after tomorrow (dayOffset 2)
  });

  it('skips cancelled events', async () => {
    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-21T10:00:00', status: 'cancelled' }),
    ]);

    const notifications = await morningBriefingProvider.getNotifications();
    expect(notifications).toEqual([]);
  });

  it('skips completed and dismissed todos', async () => {
    (storageService.getTodoItems as any).mockResolvedValue([
      makeTodo({ deadline: '2026-03-21', isCompleted: true }),
      makeTodo({ id: 'todo-2', deadline: '2026-03-21', isDismissed: true }),
    ]);

    const notifications = await morningBriefingProvider.getNotifications();
    expect(notifications).toEqual([]);
  });

  it('skips past notification times', async () => {
    // Set time to 8 AM (past 7 AM)
    vi.setSystemTime(new Date(2026, 2, 21, 8, 0, 0));

    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-21T10:00:00' }),
      makeEvent({ id: 'evt-2', startDate: '2026-03-22T10:00:00' }),
    ]);

    const notifications = await morningBriefingProvider.getNotifications();
    // Today's 7 AM is in the past, so only tomorrow's notification
    expect(notifications).toHaveLength(1);
    expect(notifications[0].id).toBe(1001); // tomorrow
  });

  it('honors the edited startDate of a recurring occurrence, not the original occurrenceDate', async () => {
    // The occurrence was moved (edited) from its original 2026-03-14 slot to
    // today (2026-03-21). occurrenceDate keeps the original series slot, but
    // the notification must follow the edited startDate.
    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({
        startDate: '2026-03-21T10:00:00',
        occurrenceDate: '2026-03-14',
        recurringGroupId: 'group-1',
        isModifiedOccurrence: true,
      }),
    ]);

    const notifications = await morningBriefingProvider.getNotifications();
    // Fires today (the edited startDate), not on the original occurrenceDate.
    const todayNotif = notifications.find(n => n.id === 1000);
    expect(todayNotif).toBeDefined();
    expect(todayNotif!.body).toBe('You have 1 event today');
  });

  it('uses custom notification time from preferences', async () => {
    (platform.storage.get as any).mockResolvedValue('08:30');
    // Set time to 7:00 — before 8:30
    vi.setSystemTime(new Date(2026, 2, 21, 7, 0, 0));

    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-21T10:00:00' }),
    ]);

    const notifications = await morningBriefingProvider.getNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].scheduledAt.getHours()).toBe(8);
    expect(notifications[0].scheduledAt.getMinutes()).toBe(30);
  });

  it('limits to 7 days ahead', async () => {
    // Event 8 days from now should not generate a notification
    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-29T10:00:00' }), // 8 days ahead
    ]);

    const notifications = await morningBriefingProvider.getNotifications();
    expect(notifications).toEqual([]);
  });

  it('generates correct body for future days relative to fire date', async () => {
    (storageService.getCalendarEvents as any).mockResolvedValue([
      makeEvent({ startDate: '2026-03-22T10:00:00' }), // Tomorrow (Sunday)
    ]);

    const notifications = await morningBriefingProvider.getNotifications();
    expect(notifications).toHaveLength(1);
    // Notification fires on March 22, so it should say "today" not "tomorrow"
    expect(notifications[0].body).toBe('You have 1 event today');
  });
});
