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
  getCalendarEventsByMemoryId,
  saveCalendarEvent,
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
  /**
   * True once local IndexedDB has been reconciled with Drive this session —
   * the first download sync completed cleanly, or the device isn't linked to
   * Drive at all. Orphan reconciliation and event recovery must wait for it:
   * on a cold start the local copy of a parent memory may simply be missing
   * (Android can kill the process before the WebView flushes IndexedDB, even
   * though the memory still exists on Drive), so a missing memory does not
   * prove deletion until the first sync has had a chance to restore it.
   * Tombstoning in that window pushes the tombstones to Drive and permanently
   * deletes the events on every device.
   */
  initialSyncComplete?: boolean;
  /** Optional callback invoked with healed-orphan tombstones so they can be synced to Drive. */
  onTombstones?: (tombstones: CalendarEvent[]) => void;
  /** Optional callback invoked with events recreated from enrichment data (lost-write recovery) so they can be synced to Drive. */
  onRecovered?: (events: CalendarEvent[]) => void;
}

export interface UseCalendarEventsReturn {
  /** All active calendar events whose source memory still exists, sorted by startDate ascending. */
  events: CalendarEvent[];
  /** Create/replace events for a memory from enrichment results. Returns all events that need syncing (new + tombstones). */
  processDetectedEvents: (memory: Memory) => Promise<CalendarEvent[]>;
  /** Remove all events associated with a deleted memory. Returns tombstones that need syncing. */
  removeEventsForMemory: (memoryId: string) => Promise<CalendarEvent[]>;
  /**
   * Edit a single event. For an occurrence of a recurring series this changes
   * only that occurrence — it is marked as modified so the rest of the series
   * (including future horizon expansion) is unaffected. Returns the updated
   * event for syncing, or null if the event wasn't found or nothing changed.
   */
  updateEvent: (eventId: string, changes: Partial<CalendarEvent>) => Promise<CalendarEvent | null>;
  /** Reload events from IndexedDB (e.g. after sync) */
  refreshEvents: () => Promise<void>;
  /** Count of upcoming events (today and future) */
  upcomingCount: number;
  /** Extend recurring event series approaching their horizon. Returns new events for syncing. */
  checkAndExpandHorizon: () => Promise<CalendarEvent[]>;
}

export const useCalendarEvents = ({ memories, memoriesLoaded, syncInProgress = false, initialSyncComplete = true, onTombstones, onRecovered }: UseCalendarEventsOptions): UseCalendarEventsReturn => {
  const [eventsList, setEventsList] = useState<CalendarEvent[]>([]);
  const loaded = useRef(false);
  // Guard against concurrent processDetectedEvents calls for the same memory.
  // Without this, interleaved IDB reads/writes can cause both calls to miss
  // each other's events, resulting in duplicates.
  const processingMemoryIds = useRef(new Set<string>());
  const reconcilingMemoryIds = useRef(new Set<string>());
  const onTombstonesRef = useRef(onTombstones);
  useEffect(() => { onTombstonesRef.current = onTombstones; }, [onTombstones]);
  const onRecoveredRef = useRef(onRecovered);
  useEffect(() => { onRecoveredRef.current = onRecovered; }, [onRecovered]);

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

  const updateEvent = useCallback(async (eventId: string, changes: Partial<CalendarEvent>): Promise<CalendarEvent | null> => {
    try {
      // Read from IDB rather than state so a stale eventsList can't resurrect
      // fields another writer (e.g. sync) just updated.
      const allEvents = await getCalendarEvents();
      const existing = allEvents.find(e => e.id === eventId);
      if (!existing) {
        console.error(`[Calendar] Cannot update unknown event ${eventId}`);
        return null;
      }

      // Saving without actual changes must not mark the occurrence as edited
      // or trigger a redundant write + sync.
      const editableFields = ['title', 'description', 'startDate', 'endDate', 'allDay', 'location', 'people', 'status'] as const;
      const hasChanges = editableFields.some(f => f in changes && existing[f] !== changes[f]);
      if (!hasChanges) return null;

      const updated: CalendarEvent = {
        ...existing,
        ...changes,
        // Identity and series-tracking fields are never editable. In particular
        // occurrenceDate must keep the original series slot so horizon
        // expansion doesn't regenerate the slot this occurrence was moved from.
        id: existing.id,
        memoryId: existing.memoryId,
        createdAt: existing.createdAt,
        recurringGroupId: existing.recurringGroupId,
        recurrenceRule: existing.recurrenceRule,
        occurrenceDate: existing.occurrenceDate,
        isModifiedOccurrence: existing.recurringGroupId ? true : existing.isModifiedOccurrence,
        updatedAt: Date.now(),
      };

      await saveCalendarEvent(updated);
      setEventsList(prev => prev.map(e => (e.id === eventId ? updated : e)));
      return updated;
    } catch (err) {
      console.error(`[Calendar] Failed to update event ${eventId}:`, err);
      return null;
    }
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
  // Skipped while a sync is in progress and until the first sync of the session
  // has completed — see the `syncInProgress` and `initialSyncComplete` docstrings.
  useEffect(() => {
    if (!memoriesLoaded || !loaded.current) return;
    if (syncInProgress || !initialSyncComplete) return;

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
  }, [eventsList, activeMemoryIds, memoriesLoaded, syncInProgress, initialSyncComplete]);

  // Self-heal, inverse direction: recreate events for active memories whose
  // enrichment detected events but which have no event rows at all in IDB —
  // not even tombstones. This recovers from lost IndexedDB writes (e.g. an
  // Android process kill right after enrichment): the enriched note survives
  // on Drive and is re-downloaded, but the extracted events never reached
  // Drive, so nothing else can bring them back. Gated like orphan
  // reconciliation: only after the first sync has completed, so any events
  // that DO exist remotely have already been downloaded — recreating before
  // that would duplicate them under fresh IDs.
  const recoveryAttemptedIds = useRef(new Set<string>());
  useEffect(() => {
    if (!memoriesLoaded || !loaded.current) return;
    if (syncInProgress || !initialSyncComplete) return;

    const memoryIdsWithEvents = new Set(eventsList.map(e => e.memoryId));
    const candidates = memories.filter(m =>
      (m.enrichment?.detectedEvents?.length ?? 0) > 0 &&
      !memoryIdsWithEvents.has(m.id) &&
      !recoveryAttemptedIds.current.has(m.id)
    );
    if (candidates.length === 0) return;

    // Mark candidates synchronously, before the first await: if the effect
    // re-runs while the loop below is suspended, the new run must not pick
    // up the same memories and start a concurrent recovery loop.
    for (const memory of candidates) {
      recoveryAttemptedIds.current.add(memory.id);
    }

    let cancelled = false;
    (async () => {
      const recovered: CalendarEvent[] = [];
      for (const memory of candidates) {
        try {
          // Verify against IDB, not just eventsList state: rows that synced
          // down but haven't reached state yet, or tombstones from a
          // deliberate removal, must not be recreated.
          const existing = await getCalendarEventsByMemoryId(memory.id);
          if (existing.length > 0) continue;
          const created = await processDetectedEvents(memory);
          recovered.push(...created);
        } catch (err) {
          console.error(`[Calendar] Failed to recover events for memory ${memory.id}:`, err);
        }
      }
      if (cancelled || recovered.length === 0) return;
      console.log(`[Calendar] Recovered ${recovered.length} lost event(s) from enrichment data`);
      onRecoveredRef.current?.(recovered);
    })();

    return () => { cancelled = true; };
  }, [memories, eventsList, memoriesLoaded, syncInProgress, initialSyncComplete, processDetectedEvents]);

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
    updateEvent,
    refreshEvents,
    upcomingCount,
    checkAndExpandHorizon,
  };
};
