/**
 * calendarUtils.ts
 *
 * Utilities for expanding recurring events into individual calendar occurrences
 * and extending the horizon of existing recurring series.
 */

import { CalendarEvent, DetectedEvent, RecurrenceFrequency } from '../types';

const MAX_OCCURRENCES = 365;
const DEFAULT_HORIZON_MONTHS = 6;
const HORIZON_EXTENSION_THRESHOLD_DAYS = 30;

/**
 * Generate a deterministic UUID-like ID from a seed string.
 * Uses the same input on any device to produce the same output,
 * preventing duplicate occurrences when horizon expansion runs
 * independently on multiple synced devices.
 */
const deterministicId = (seed: string): string => {
  // Run two independent hash passes with different seeds to produce 32 hex chars
  const hash32 = (s: string, init1: number, init2: number): string => {
    let h1 = init1;
    let h2 = init2;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  };
  const hi = hash32(seed, 0xdeadbeef, 0x41c6ce57);
  const lo = hash32(seed, 0x12345678, 0x9abcdef0);
  const hex = hi + lo; // 32 hex chars
  // Format as UUID v4-like: xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/**
 * Advance a date by one recurrence interval.
 * Returns a new Date — does not mutate the input.
 */
const advanceDate = (date: Date, frequency: RecurrenceFrequency): Date => {
  const next = new Date(date);
  switch (frequency) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    case 'yearly':
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return next;
};

/**
 * Format a Date as ISO 8601 date-only string ("2026-06-15").
 */
const toDateString = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Extract the time portion from an ISO datetime string, if present.
 * Returns "T16:00:00" or empty string.
 */
const extractTimeSuffix = (isoString: string): string => {
  const tIndex = isoString.indexOf('T');
  return tIndex >= 0 ? isoString.substring(tIndex) : '';
};

/**
 * Compute the default horizon end date (now + N months).
 */
const getHorizonEnd = (months: number = DEFAULT_HORIZON_MONTHS): Date => {
  const end = new Date();
  end.setMonth(end.getMonth() + months);
  return end;
};

/**
 * Expand a detected recurring event into individual CalendarEvent occurrences.
 *
 * Generates occurrences from the detected startDate up to either the
 * recurrenceEndDate or a rolling horizon (default 6 months from now),
 * whichever comes first. Capped at MAX_OCCURRENCES.
 */
export const expandRecurringEvent = (
  det: DetectedEvent,
  memoryId: string,
  description: string | undefined,
  horizonMonths: number = DEFAULT_HORIZON_MONTHS,
): CalendarEvent[] => {
  const frequency = det.recurrenceFrequency;
  if (!frequency) return [];

  const anchor = new Date(det.startDate);
  if (isNaN(anchor.getTime())) return [];

  const timeSuffix = extractTimeSuffix(det.startDate);
  const recurringGroupId = crypto.randomUUID();
  const now = Date.now();

  // Determine end boundary
  let endBoundary = getHorizonEnd(horizonMonths);
  if (det.recurrenceEndDate) {
    const explicit = new Date(det.recurrenceEndDate);
    if (!isNaN(explicit.getTime()) && explicit < endBoundary) {
      endBoundary = explicit;
    }
  }

  const recurrenceRule = {
    frequency,
    endDate: det.recurrenceEndDate,
  };

  const events: CalendarEvent[] = [];
  let current = new Date(anchor);

  while (current <= endBoundary && events.length < MAX_OCCURRENCES) {
    const dateStr = toDateString(current);
    const startDate = dateStr + timeSuffix;

    events.push({
      id: crypto.randomUUID(),
      memoryId,
      title: det.title,
      description,
      startDate,
      endDate: det.endDate,
      allDay: det.allDay,
      location: det.location,
      people: det.people,
      status: det.status,
      createdAt: now,
      updatedAt: now,
      recurringGroupId,
      recurrenceRule,
      occurrenceDate: dateStr,
    });

    current = advanceDate(current, frequency);
  }

  return events;
};

/** Position of one day within a multi-day event span. */
export interface MultiDayInfo {
  dayIndex: number; // 1-based position within the span
  totalDays: number;
}

/** One agenda-day occurrence of an event (multi-day events yield several). */
export interface EventDayOccurrence {
  dateKey: string; // "2026-06-12"
  sortKey: string; // ISO string used to order events within a day
  multiDay?: MultiDayInfo;
}

// Guard against pathological endDates producing thousands of agenda rows.
// Rendering stops after this many days, but multiDay.totalDays still
// reports the real span so capped days don't read as the final day.
const MAX_SPAN_DAYS = 60;

/**
 * Expand an event into one occurrence per calendar day it spans
 * (Google Calendar schedule-view style). Single-day events yield one
 * occurrence keyed by their start date. Multi-day events yield one per
 * day; continuation days get a date-only sort key so they order with
 * all-day events at the top of each day.
 */
export const expandEventDays = (
  event: Pick<CalendarEvent, 'startDate' | 'endDate'>,
): EventDayOccurrence[] => {
  const startKey = event.startDate.split('T')[0];
  const single: EventDayOccurrence[] = [{ dateKey: startKey, sortKey: event.startDate }];

  const endKey = event.endDate ? event.endDate.split('T')[0] : startKey;
  if (endKey <= startKey) return single;

  const start = new Date(startKey + 'T00:00:00');
  const end = new Date(endKey + 'T00:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return single;

  const totalDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const renderedDays = Math.min(totalDays, MAX_SPAN_DAYS);

  const occurrences: EventDayOccurrence[] = [];
  const cursor = new Date(start);
  for (let dayIndex = 1; dayIndex <= renderedDays; dayIndex++) {
    const dateKey = toDateString(cursor);
    occurrences.push({
      dateKey,
      sortKey: dayIndex === 1 ? event.startDate : dateKey,
      multiDay: { dayIndex, totalDays },
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return occurrences;
};

/**
 * Extend the horizon for recurring event series that are nearing their end.
 *
 * Scans existing events, groups by recurringGroupId, and for any series whose
 * latest occurrence is within HORIZON_EXTENSION_THRESHOLD_DAYS of today,
 * generates additional occurrences extending to DEFAULT_HORIZON_MONTHS from now.
 *
 * Returns only the newly generated events (caller should save and sync them).
 */
export const expandHorizon = (existingEvents: CalendarEvent[]): CalendarEvent[] => {
  const now = new Date();
  const thresholdDate = new Date(now);
  thresholdDate.setDate(thresholdDate.getDate() + HORIZON_EXTENSION_THRESHOLD_DAYS);
  const thresholdStr = toDateString(thresholdDate);

  const horizonEnd = getHorizonEnd();

  // Group by recurringGroupId
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of existingEvents) {
    if (!event.recurringGroupId || event.isDeleted) continue;
    const group = groups.get(event.recurringGroupId) ?? [];
    group.push(event);
    groups.set(event.recurringGroupId, group);
  }

  const newEvents: CalendarEvent[] = [];

  for (const [groupId, group] of groups) {
    // Find the latest occurrence in the group
    const sorted = [...group].sort((a, b) => (a.occurrenceDate ?? a.startDate).localeCompare(b.occurrenceDate ?? b.startDate));
    const latest = sorted[sorted.length - 1];
    const latestDate = latest.occurrenceDate ?? latest.startDate.split('T')[0];

    // Skip if series still has occurrences well into the future
    if (latestDate > thresholdStr) continue;

    // New occurrences must follow the series pattern, not a single occurrence
    // the user edited apart from it — template from the latest unmodified
    // occurrence, falling back to the latest if every occurrence was edited.
    const unmodified = sorted.filter(e => !e.isModifiedOccurrence);
    const template = unmodified.length > 0 ? unmodified[unmodified.length - 1] : latest;

    // Skip if recurrence rule has a fixed end that we've already passed
    const rule = template.recurrenceRule;
    if (!rule) continue;
    if (rule.endDate) {
      const endBoundary = new Date(rule.endDate);
      if (!isNaN(endBoundary.getTime()) && endBoundary <= now) continue;
    }

    // Determine effective end boundary
    let endBoundary = horizonEnd;
    if (rule.endDate) {
      const explicit = new Date(rule.endDate);
      if (!isNaN(explicit.getTime()) && explicit < endBoundary) {
        endBoundary = explicit;
      }
    }

    // Collect existing occurrence dates to avoid duplicates
    const existingDates = new Set(sorted.map(e => e.occurrenceDate ?? e.startDate.split('T')[0]));

    const timeSuffix = extractTimeSuffix(template.startDate);
    const nowTs = Date.now();

    // Start generating from the day after the latest occurrence
    let current = new Date(latestDate);
    current = advanceDate(current, rule.frequency);

    while (current <= endBoundary && newEvents.length < MAX_OCCURRENCES) {
      const dateStr = toDateString(current);

      if (!existingDates.has(dateStr)) {
        newEvents.push({
          id: deterministicId(`${groupId}:${dateStr}`),
          memoryId: template.memoryId,
          title: template.title,
          description: template.description,
          startDate: dateStr + timeSuffix,
          endDate: template.endDate,
          allDay: template.allDay,
          location: template.location,
          people: template.people,
          status: template.status,
          createdAt: nowTs,
          updatedAt: nowTs,
          recurringGroupId: groupId,
          recurrenceRule: rule,
          occurrenceDate: dateStr,
        });
      }

      current = advanceDate(current, rule.frequency);
    }
  }

  return newEvents;
};
