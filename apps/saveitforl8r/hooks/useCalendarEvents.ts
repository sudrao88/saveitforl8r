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

export interface UseCalendarEventsOptions {
  /** Active (non-deleted) memories. Events whose memoryId is missing from this set are treated as orphans and auto-tombstoned. */
  memories: Memory[];
  /** True once `memories` reflects IndexedDB. Reconciliation is gated on this to avoid tombstoning everything on first render. */
  memoriesLoaded: boolean;
  /**
   * True while a Drive sync is downloading. Reconciliation must wait for it
   * to finish — fresh syncs land event-*.json files in IDB before the bulkier
   * memory files, so a mid-sync orphan pass would tombstone every just-arrived
   * event whose parent memory hasn't downloaded yet (and then push those
   * tombstones back to Drive, deleting them on every device).
   */
  syncInProgress?: boolean;
  /** Optional callback invoked with healed-orphan tombstones so they can be synced to Drive. */
  onTombstones?: (tombstones: CalendarEvent[]) => void;
}

export interface UseCalendarEventsReturn {
  /** All active calendar events whose source memory still exists, sorted by startDate ascending. */
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

export const useCalendarEvents = ({ memories, memoriesLoaded, syncInProgress = false, onTombstones }: UseCalendarEventsOptions): UseCalendarEventsReturn => {
  const [eventsList, setEventsList] = useState<CalendarEvent[]>([]);
  const loaded = useRef(false);
  // Guard against concurrent processDetectedEvents calls for the same memory.
  // Without this, interleaved IDB reads/writes can cause both calls to miss
  // each other's events, resulting in duplicates.
  const processingMemoryIds = useRef(new Set<string>());
  const reconcilingMemoryIds = useRef(new Set<string>());
  const onTombstonesRef = useRef(onTombstones);
  useEffect(() => { onTombstonesRef.current = onTombstones; }, [onTombstones]);

  const activeMemoryIds = useMemo(() => new Set(memories.map(m => m.id)), [memories]);

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

  // Self-heal: tombstone any events whose source memory no longer exists, so they
  // disappear from the UI and the deletion propagates to other devices via sync.
  // Skipped while a sync is in progress — see `syncInProgress` docstring above.
  useEffect(() => {
    if (!memoriesLoaded || !loaded.current) return;
    if (syncInProgress) return;

    const orphanMemoryIds = new Set<string>();
    for (const event of eventsList) {
      if (event.isDeleted) continue;
      if (activeMemoryIds.has(event.memoryId)) continue;
      if (reconcilingMemoryIds.current.has(event.memoryId)) continue;
      orphanMemoryIds.add(event.memoryId);
    }
    if (orphanMemoryIds.size === 0) return;

    let cancelled = false;
    (async () => {
      const allTombstones: CalendarEvent[] = [];
      for (const memoryId of orphanMemoryIds) {
        reconcilingMemoryIds.current.add(memoryId);
        try {
          const tombstones = await softDeleteCalendarEventsByMemoryId(memoryId);
          if (tombstones.length > 0) allTombstones.push(...tombstones);
        } catch (err) {
          console.error(`[Calendar] Failed to reconcile orphans for memory ${memoryId}:`, err);
        } finally {
          reconcilingMemoryIds.current.delete(memoryId);
        }
      }
      if (cancelled || allTombstones.length === 0) return;

      const tombstoneMap = new Map(allTombstones.map(t => [t.id, t]));
      setEventsList(prev => prev.map(e =>
        tombstoneMap.has(e.id) ? tombstoneMap.get(e.id)! : e
      ));
      console.log(`[Calendar] Reconciled ${allTombstones.length} orphan event(s) across ${orphanMemoryIds.size} deleted memor${orphanMemoryIds.size === 1 ? 'y' : 'ies'}`);
      onTombstonesRef.current?.(allTombstones);
    })();

    return () => { cancelled = true; };
  }, [eventsList, activeMemoryIds, memoriesLoaded, syncInProgress]);

  // Sort by startDate ascending. Drops deleted events and any whose source memory
  // is missing — defensive guard for the brief window between an orphan being
  // detected and its tombstone landing in eventsList.
  const events = useMemo(
    () => eventsList
      .filter(e => !e.isDeleted && activeMemoryIds.has(e.memoryId))
      .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [eventsList, activeMemoryIds]
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
