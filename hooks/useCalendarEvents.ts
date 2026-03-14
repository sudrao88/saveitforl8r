/**
 * useCalendarEvents.ts
 *
 * React hook for managing calendar events extracted from notes.
 * Events are automatically created/updated when enrichment detects
 * date-based events in note content. No manual event creation.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CalendarEvent, DetectedEvent, Memory } from '../types';
import { logEvent } from '../services/analytics';
import { ANALYTICS_EVENTS } from '../constants';
import {
  getCalendarEvents,
  saveCalendarEvents,
  softDeleteCalendarEventsByMemoryId,
  replaceCalendarEventsForMemory,
} from '../services/storageService';
import { expandRecurringEvent, expandHorizon } from '../utils/calendarUtils';

export interface UseCalendarEventsReturn {
  /** All active calendar events, sorted by startDate ascending */
  events: CalendarEvent[];
  /** Create/replace events for a memory from enrichment results. Returns all events that need syncing (new + tombstones). */
  processDetectedEvents: (memory: Memory) => Promise<CalendarEvent[]>;
  /** Remove all events associated with a deleted memory. Returns tombstones that need syncing. */
  removeEventsForMemory: (memoryId: string) => Promise<CalendarEvent[]>;
  /** Reload events from IndexedDB (e.g. after sync) */
  refreshEvents: () => Promise<void>;
  /** Count of upcoming events (today and future) */
  upcomingCount: number;
  /** Extend recurring event series approaching their horizon. Returns new events for syncing. */
  checkAndExpandHorizon: () => Promise<CalendarEvent[]>;
}

export const useCalendarEvents = (): UseCalendarEventsReturn => {
  const [eventsList, setEventsList] = useState<CalendarEvent[]>([]);
  const loaded = useRef(false);
  // Guard against concurrent processDetectedEvents calls for the same memory.
  // Without this, interleaved IDB reads/writes can cause both calls to miss
  // each other's events, resulting in duplicates.
  const processingMemoryIds = useRef(new Set<string>());

  const refreshEvents = useCallback(async () => {
    try {
      const loadedEvents = await getCalendarEvents();
      setEventsList(loadedEvents);
    } catch (err) {
      console.error('[Calendar] Failed to refresh events:', err);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    refreshEvents();
  }, [refreshEvents]);

  const processDetectedEvents = useCallback(async (memory: Memory): Promise<CalendarEvent[]> => {
    // Prevent concurrent processing for the same memory — if two calls
    // interleave, the second can miss events created by the first and
    // produce duplicates instead of replacing them.
    if (processingMemoryIds.current.has(memory.id)) {
      console.log(`[Calendar] Skipping concurrent processDetectedEvents for memory ${memory.id}`);
      return [];
    }
    processingMemoryIds.current.add(memory.id);

    try {
      const detected = memory.enrichment?.detectedEvents;
      if (!detected || detected.length === 0) {
        // No events detected — soft-delete any old events for this memory
        const tombstones = await softDeleteCalendarEventsByMemoryId(memory.id);
        if (tombstones.length > 0) {
          setEventsList(prev => prev.map(e =>
            e.memoryId === memory.id ? { ...e, isDeleted: true, updatedAt: Date.now() } : e
          ));
        }
        return tombstones;
      }

      const now = Date.now();
      const newEvents: CalendarEvent[] = detected.flatMap((det: DetectedEvent) => {
        if (det.isRecurring && det.recurrenceFrequency) {
          return expandRecurringEvent(det, memory.id, memory.enrichment?.summary);
        }
        return [{
          id: crypto.randomUUID(),
          memoryId: memory.id,
          title: det.title,
          description: memory.enrichment?.summary,
          startDate: det.startDate,
          endDate: det.endDate,
          allDay: det.allDay,
          location: det.location,
          people: det.people,
          status: det.status,
          createdAt: now,
          updatedAt: now,
        }];
      });

      // Atomically tombstone old events and save new ones in a single IDB
      // transaction. This prevents data loss if the write were to fail
      // partway through a non-atomic two-step delete-then-save.
      const tombstones = await replaceCalendarEventsForMemory(memory.id, newEvents);

      setEventsList(prev => [
        ...prev.filter(e => e.memoryId !== memory.id),
        ...newEvents,
      ]);

      logEvent(ANALYTICS_EVENTS.CALENDAR_EVENT.CATEGORY, ANALYTICS_EVENTS.CALENDAR_EVENT.ACTION_CREATED, undefined, newEvents.length);
      console.log(`[Calendar] Created ${newEvents.length} event(s) from memory ${memory.id}`);
      return [...tombstones, ...newEvents];
    } finally {
      processingMemoryIds.current.delete(memory.id);
    }
  }, []);

  const removeEventsForMemory = useCallback(async (memoryId: string): Promise<CalendarEvent[]> => {
    // Soft-delete creates tombstone records that sync propagates to other devices
    const tombstones = await softDeleteCalendarEventsByMemoryId(memoryId);
    if (tombstones.length > 0) {
      setEventsList(prev => prev.map(e =>
        e.memoryId === memoryId ? { ...e, isDeleted: true, updatedAt: Date.now() } : e
      ));
    }
    return tombstones;
  }, []);

  const checkAndExpandHorizon = useCallback(async (): Promise<CalendarEvent[]> => {
    try {
      const allEvents = await getCalendarEvents();
      const newEvents = expandHorizon(allEvents);
      if (newEvents.length > 0) {
        await saveCalendarEvents(newEvents);
        setEventsList(prev => [...prev, ...newEvents]);
        console.log(`[Calendar] Expanded horizon: created ${newEvents.length} new occurrence(s)`);
      }
      return newEvents;
    } catch (err) {
      console.error('[Calendar] Failed to expand horizon:', err);
      return [];
    }
  }, []);

  // Sort by startDate ascending, filter out deleted
  const events = useMemo(
    () => eventsList
      .filter(e => !e.isDeleted)
      .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [eventsList]
  );

  // Count upcoming events (today and future)
  const upcomingCount = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return events.filter(e => e.startDate >= today).length;
  }, [events]);

  return {
    events,
    processDetectedEvents,
    removeEventsForMemory,
    refreshEvents,
    upcomingCount,
    checkAndExpandHorizon,
  };
};
