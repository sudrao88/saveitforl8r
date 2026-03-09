/**
 * useCalendarEvents.ts
 *
 * React hook for managing calendar events extracted from notes.
 * Events are automatically created/updated when enrichment detects
 * date-based events in note content. No manual event creation.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CalendarEvent, DetectedEvent, Memory } from '../types';
import {
  getCalendarEvents,
  saveCalendarEvents,
  softDeleteCalendarEventsByMemoryId,
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

    // Soft-delete old events for this memory (creates tombstones for sync)
    const tombstones = await softDeleteCalendarEventsByMemoryId(memory.id);

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

    await saveCalendarEvents(newEvents);
    setEventsList(prev => [
      ...prev.filter(e => e.memoryId !== memory.id),
      ...newEvents,
    ]);

    console.log(`[Calendar] Created ${newEvents.length} event(s) from memory ${memory.id}`);
    return [...tombstones, ...newEvents];
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
