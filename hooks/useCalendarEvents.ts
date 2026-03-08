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
  deleteCalendarEventsByMemoryId,
  saveCalendarEvent,
} from '../services/storageService';

export interface UseCalendarEventsReturn {
  /** All active calendar events, sorted by startDate ascending */
  events: CalendarEvent[];
  /** Create/replace events for a memory from enrichment results */
  processDetectedEvents: (memory: Memory) => Promise<void>;
  /** Remove all events associated with a deleted memory */
  removeEventsForMemory: (memoryId: string) => Promise<void>;
  /** Reload events from IndexedDB (e.g. after sync) */
  refreshEvents: () => Promise<void>;
  /** Count of upcoming events (today and future) */
  upcomingCount: number;
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

  const processDetectedEvents = useCallback(async (memory: Memory) => {
    const detected = memory.enrichment?.detectedEvents;
    if (!detected || detected.length === 0) {
      // No events detected — clean up any old events for this memory
      await deleteCalendarEventsByMemoryId(memory.id);
      setEventsList(prev => prev.filter(e => e.memoryId !== memory.id));
      return;
    }

    // Remove old events for this memory first
    await deleteCalendarEventsByMemoryId(memory.id);

    const now = Date.now();
    const newEvents: CalendarEvent[] = detected.map((det: DetectedEvent) => ({
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
    }));

    await saveCalendarEvents(newEvents);
    setEventsList(prev => [
      ...prev.filter(e => e.memoryId !== memory.id),
      ...newEvents,
    ]);

    console.log(`[Calendar] Created ${newEvents.length} event(s) from memory ${memory.id}`);
  }, []);

  const removeEventsForMemory = useCallback(async (memoryId: string) => {
    await deleteCalendarEventsByMemoryId(memoryId);
    setEventsList(prev => prev.filter(e => e.memoryId !== memoryId));
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
  };
};
