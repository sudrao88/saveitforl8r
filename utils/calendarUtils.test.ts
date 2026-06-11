import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { expandRecurringEvent, expandHorizon, expandEventDays } from './calendarUtils';
import { CalendarEvent, DetectedEvent } from '../types';

const makeDetected = (overrides: Partial<DetectedEvent> = {}): DetectedEvent => ({
  title: 'Yoga class',
  startDate: '2026-04-01T18:00:00',
  allDay: false,
  status: 'confirmed',
  ...overrides,
});

const makeEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'evt-1',
  memoryId: 'mem-1',
  title: 'Yoga class',
  startDate: '2026-04-01T18:00:00',
  allDay: false,
  status: 'confirmed',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('expandRecurringEvent', () => {
  it('returns an empty array when no recurrence frequency is set', () => {
    const events = expandRecurringEvent(makeDetected(), 'mem-1', 'desc');
    expect(events).toEqual([]);
  });

  it('returns an empty array for an invalid anchor date', () => {
    const det = makeDetected({
      startDate: 'not-a-date',
      recurrenceFrequency: 'weekly',
    });
    const events = expandRecurringEvent(det, 'mem-1', undefined);
    expect(events).toEqual([]);
  });

  it('expands weekly recurrences up to the explicit end date', () => {
    const det = makeDetected({
      startDate: '2026-04-01T18:00:00',
      recurrenceFrequency: 'weekly',
      recurrenceEndDate: '2026-04-30', // must be past 4/29 18:00 local
    });
    const events = expandRecurringEvent(det, 'mem-1', 'class', 12);
    expect(events).toHaveLength(5); // 4/1, 4/8, 4/15, 4/22, 4/29
    expect(events[0].occurrenceDate).toBe('2026-04-01');
    expect(events[4].occurrenceDate).toBe('2026-04-29');
    expect(events[0].startDate).toBe('2026-04-01T18:00:00');
    expect(events[0].recurrenceRule).toEqual({
      frequency: 'weekly',
      endDate: '2026-04-30',
    });
  });

  it('assigns every occurrence the same recurringGroupId', () => {
    const det = makeDetected({
      recurrenceFrequency: 'daily',
      recurrenceEndDate: '2026-04-05',
    });
    const events = expandRecurringEvent(det, 'mem-1', undefined);
    const groupIds = new Set(events.map(e => e.recurringGroupId));
    expect(groupIds.size).toBe(1);
  });

  it('uses the horizon when no explicit end date is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 1)); // April 1, 2026
    try {
      const det = makeDetected({
        startDate: '2026-04-01T09:00:00',
        recurrenceFrequency: 'monthly',
      });
      // Horizon of 2 months: April + May only
      const events = expandRecurringEvent(det, 'mem-1', undefined, 2);
      expect(events.map(e => e.occurrenceDate)).toEqual([
        '2026-04-01',
        '2026-05-01',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves the time-of-day suffix across occurrences', () => {
    const det = makeDetected({
      startDate: '2026-04-01T18:30:00',
      recurrenceFrequency: 'daily',
      recurrenceEndDate: '2026-04-04', // inclusive of 4/3 18:30 local
    });
    const events = expandRecurringEvent(det, 'mem-1', undefined);
    expect(events.map(e => e.startDate)).toEqual([
      '2026-04-01T18:30:00',
      '2026-04-02T18:30:00',
      '2026-04-03T18:30:00',
    ]);
  });

  it('handles all-day (no time suffix) anchors', () => {
    const det = makeDetected({
      startDate: '2026-04-01',
      allDay: true,
      recurrenceFrequency: 'daily',
      recurrenceEndDate: '2026-04-03',
    });
    const events = expandRecurringEvent(det, 'mem-1', undefined);
    expect(events.map(e => e.startDate)).toEqual([
      '2026-04-01',
      '2026-04-02',
      '2026-04-03',
    ]);
    expect(events.every(e => e.allDay)).toBe(true);
  });

  it('advances monthly and yearly intervals correctly', () => {
    const monthly = expandRecurringEvent(
      makeDetected({
        startDate: '2026-01-15',
        recurrenceFrequency: 'monthly',
        recurrenceEndDate: '2026-04-15',
      }),
      'mem-1',
      undefined,
    );
    expect(monthly.map(e => e.occurrenceDate)).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
    ]);

    const yearly = expandRecurringEvent(
      makeDetected({
        startDate: '2024-06-01',
        recurrenceFrequency: 'yearly',
        recurrenceEndDate: '2026-06-01',
      }),
      'mem-1',
      undefined,
    );
    expect(yearly.map(e => e.occurrenceDate)).toEqual([
      '2024-06-01',
      '2025-06-01',
      '2026-06-01',
    ]);
  });
});

describe('expandHorizon', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 15)); // April 15, 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns no new events when the latest occurrence is beyond the 30-day threshold', () => {
    const existing = [
      makeEvent({
        id: 'evt-1',
        occurrenceDate: '2026-06-01', // well beyond the threshold
        recurringGroupId: 'group-1',
        recurrenceRule: { frequency: 'weekly' },
      }),
    ];
    expect(expandHorizon(existing)).toEqual([]);
  });

  it('extends a series whose latest occurrence is within the threshold', () => {
    const existing = [
      makeEvent({
        id: 'evt-1',
        occurrenceDate: '2026-04-10',
        recurringGroupId: 'group-1',
        startDate: '2026-04-10T18:00:00',
        recurrenceRule: { frequency: 'weekly' },
      }),
    ];
    const added = expandHorizon(existing);
    expect(added.length).toBeGreaterThan(0);
    // Next occurrence should be one week after the latest
    expect(added[0].occurrenceDate).toBe('2026-04-17');
    expect(added[0].recurringGroupId).toBe('group-1');
    expect(added[0].startDate.endsWith('T18:00:00')).toBe(true);
  });

  it('skips recurrences whose recurrence rule has already ended', () => {
    const existing = [
      makeEvent({
        occurrenceDate: '2026-04-10',
        recurringGroupId: 'group-1',
        recurrenceRule: { frequency: 'weekly', endDate: '2026-04-01' },
      }),
    ];
    expect(expandHorizon(existing)).toEqual([]);
  });

  it('skips soft-deleted events when grouping', () => {
    const existing = [
      makeEvent({
        id: 'evt-1',
        occurrenceDate: '2026-04-10',
        recurringGroupId: 'group-1',
        recurrenceRule: { frequency: 'weekly' },
        isDeleted: true,
      }),
    ];
    expect(expandHorizon(existing)).toEqual([]);
  });

  it('does not duplicate existing occurrence dates', () => {
    const existing = [
      makeEvent({
        id: 'evt-1',
        occurrenceDate: '2026-04-10',
        recurringGroupId: 'group-1',
        recurrenceRule: { frequency: 'weekly' },
      }),
      makeEvent({
        id: 'evt-2',
        occurrenceDate: '2026-04-17',
        recurringGroupId: 'group-1',
        recurrenceRule: { frequency: 'weekly' },
      }),
    ];
    const added = expandHorizon(existing);
    const existingDates = new Set(
      existing.map(e => e.occurrenceDate!),
    );
    for (const evt of added) {
      expect(existingDates.has(evt.occurrenceDate!)).toBe(false);
    }
  });

  it('generates deterministic IDs for the same series and date', () => {
    const existing = [
      makeEvent({
        occurrenceDate: '2026-04-10',
        recurringGroupId: 'group-xyz',
        recurrenceRule: { frequency: 'weekly' },
      }),
    ];
    const added1 = expandHorizon(existing);
    const added2 = expandHorizon(existing);
    expect(added1.map(e => e.id)).toEqual(added2.map(e => e.id));
  });

  it('ignores events without a recurringGroupId', () => {
    const existing = [
      makeEvent({
        occurrenceDate: '2026-04-10',
        recurrenceRule: { frequency: 'weekly' },
      }),
    ];
    expect(expandHorizon(existing)).toEqual([]);
  });
});

describe('expandEventDays', () => {
  it('returns a single occurrence for an event without an endDate', () => {
    expect(expandEventDays({ startDate: '2026-06-12T22:00:00' })).toEqual([
      { dateKey: '2026-06-12', sortKey: '2026-06-12T22:00:00' },
    ]);
  });

  it('returns a single occurrence when the endDate is on the same day', () => {
    expect(
      expandEventDays({ startDate: '2026-06-12T09:00:00', endDate: '2026-06-12T17:00:00' }),
    ).toEqual([{ dateKey: '2026-06-12', sortKey: '2026-06-12T09:00:00' }]);
  });

  it('expands a multi-day event onto every day it spans', () => {
    const occurrences = expandEventDays({
      startDate: '2026-06-12T22:00:00',
      endDate: '2026-06-15T23:00:00',
    });
    expect(occurrences).toHaveLength(4);
    expect(occurrences.map(o => o.dateKey)).toEqual([
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
    ]);
    expect(occurrences.map(o => o.multiDay)).toEqual([
      { dayIndex: 1, totalDays: 4 },
      { dayIndex: 2, totalDays: 4 },
      { dayIndex: 3, totalDays: 4 },
      { dayIndex: 4, totalDays: 4 },
    ]);
  });

  it('keeps the start time in the first day sort key and uses date-only keys after', () => {
    const occurrences = expandEventDays({
      startDate: '2026-06-12T22:00:00',
      endDate: '2026-06-13T23:00:00',
    });
    expect(occurrences[0].sortKey).toBe('2026-06-12T22:00:00');
    expect(occurrences[1].sortKey).toBe('2026-06-13');
  });

  it('expands all-day multi-day events spanning a month boundary', () => {
    const occurrences = expandEventDays({
      startDate: '2026-06-29',
      endDate: '2026-07-02',
    });
    expect(occurrences.map(o => o.dateKey)).toEqual([
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
      '2026-07-02',
    ]);
  });

  it('ignores an endDate earlier than the startDate', () => {
    expect(
      expandEventDays({ startDate: '2026-06-12T10:00:00', endDate: '2026-06-10T10:00:00' }),
    ).toEqual([{ dateKey: '2026-06-12', sortKey: '2026-06-12T10:00:00' }]);
  });

  it('caps pathological spans at 60 days', () => {
    const occurrences = expandEventDays({
      startDate: '2026-06-12',
      endDate: '2030-01-01',
    });
    expect(occurrences).toHaveLength(60);
  });
});
