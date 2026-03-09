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
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  // Format as UUID-like: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(12, 15)}-8${hex.slice(15, 18)}-${hex.slice(0, 12)}`;
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
    const sorted = group.sort((a, b) => (a.occurrenceDate ?? a.startDate).localeCompare(b.occurrenceDate ?? b.startDate));
    const latest = sorted[sorted.length - 1];
    const latestDate = latest.occurrenceDate ?? latest.startDate.split('T')[0];

    // Skip if series still has occurrences well into the future
    if (latestDate > thresholdStr) continue;

    // Skip if recurrence rule has a fixed end that we've already passed
    const rule = latest.recurrenceRule;
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

    const timeSuffix = extractTimeSuffix(latest.startDate);
    const nowTs = Date.now();

    // Start generating from the day after the latest occurrence
    let current = new Date(latestDate);
    current = advanceDate(current, rule.frequency);

    while (current <= endBoundary && newEvents.length < MAX_OCCURRENCES) {
      const dateStr = toDateString(current);

      if (!existingDates.has(dateStr)) {
        newEvents.push({
          id: deterministicId(`${groupId}:${dateStr}`),
          memoryId: latest.memoryId,
          title: latest.title,
          description: latest.description,
          startDate: dateStr + timeSuffix,
          endDate: latest.endDate,
          allDay: latest.allDay,
          location: latest.location,
          people: latest.people,
          status: latest.status,
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
