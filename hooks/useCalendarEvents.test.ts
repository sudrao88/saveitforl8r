import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCalendarEvents } from './useCalendarEvents';
import * as storageService from '../services/storageService';
import { CalendarEvent, DetectedEvent, Memory } from '../types';

vi.mock('../services/storageService');

const makeMemory = (id: string): Memory => ({
  id,
  content: 'test',
  timestamp: Date.now(),
  tags: [],
});

const makeDetectedEvent = (overrides: Partial<DetectedEvent> = {}): DetectedEvent => ({
  title: 'Dance class',
  startDate: '2026-07-01T17:00:00',
  allDay: false,
  status: 'confirmed',
  ...overrides,
});

const makeEnrichedMemory = (id: string, detectedEvents: DetectedEvent[]): Memory => ({
  ...makeMemory(id),
  enrichment: { detectedEvents } as Memory['enrichment'],
});

const makeEvent = (id: string, memoryId: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  memoryId,
  title: `event-${id}`,
  startDate: '2026-06-01',
  allDay: true,
  status: 'confirmed',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

describe('useCalendarEvents orphan reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageService.getCalendarEvents as any).mockResolvedValue([]);
    (storageService.getCalendarEventsByMemoryId as any).mockResolvedValue([]);
    (storageService.saveCalendarEvents as any).mockResolvedValue(undefined);
    (storageService.softDeleteCalendarEventsByMemoryId as any).mockResolvedValue([]);
    (storageService.replaceCalendarEventsForMemory as any).mockResolvedValue([]);
  });

  it('returns events whose source memory still exists', async () => {
    const events = [makeEvent('e1', 'note-1'), makeEvent('e2', 'note-2')];
    (storageService.getCalendarEvents as any).mockResolvedValue(events);

    const memories = [makeMemory('note-1'), makeMemory('note-2')];
    const { result } = renderHook(() =>
      useCalendarEvents({ memories, memoriesLoaded: true })
    );

    await waitFor(() => {
      expect(result.current.events).toHaveLength(2);
    });
  });

  it('filters events whose source memory has been deleted', async () => {
    const events = [
      makeEvent('e1', 'note-1'),
      makeEvent('e-orphan', 'deleted-note'),
    ];
    (storageService.getCalendarEvents as any).mockResolvedValue(events);
    (storageService.softDeleteCalendarEventsByMemoryId as any).mockImplementation(async (memoryId: string) => {
      if (memoryId === 'deleted-note') {
        return [{ ...events[1], isDeleted: true, updatedAt: Date.now() }];
      }
      return [];
    });

    const memories = [makeMemory('note-1')];
    const { result } = renderHook(() =>
      useCalendarEvents({ memories, memoriesLoaded: true })
    );

    await waitFor(() => {
      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0].id).toBe('e1');
    });
  });

  it('soft-deletes orphan events and invokes the onTombstones callback', async () => {
    const events = [
      makeEvent('e-orphan', 'deleted-note'),
      makeEvent('e-keep', 'note-1'),
    ];
    (storageService.getCalendarEvents as any).mockResolvedValue(events);
    const tombstone = { ...events[0], isDeleted: true, updatedAt: Date.now() };
    (storageService.softDeleteCalendarEventsByMemoryId as any).mockImplementation(async (memoryId: string) => {
      if (memoryId === 'deleted-note') return [tombstone];
      return [];
    });

    const onTombstones = vi.fn();
    const memories = [makeMemory('note-1')];
    renderHook(() =>
      useCalendarEvents({ memories, memoriesLoaded: true, onTombstones })
    );

    await waitFor(() => {
      expect(storageService.softDeleteCalendarEventsByMemoryId).toHaveBeenCalledWith('deleted-note');
      expect(onTombstones).toHaveBeenCalledWith([tombstone]);
    });
    expect(storageService.softDeleteCalendarEventsByMemoryId).not.toHaveBeenCalledWith('note-1');
  });

  it('does not reconcile while memoriesLoaded is false', async () => {
    const events = [makeEvent('e1', 'note-1')];
    (storageService.getCalendarEvents as any).mockResolvedValue(events);

    const onTombstones = vi.fn();
    renderHook(() =>
      useCalendarEvents({ memories: [], memoriesLoaded: false, onTombstones })
    );

    await waitFor(() => {
      expect(storageService.getCalendarEvents).toHaveBeenCalled();
    });
    await new Promise(r => setTimeout(r, 20));
    expect(storageService.softDeleteCalendarEventsByMemoryId).not.toHaveBeenCalled();
    expect(onTombstones).not.toHaveBeenCalled();
  });

  // Regression: after a wipe-and-fresh-sync the calendar-event shard finishes
  // downloading before the bulkier memory files. eventsList briefly contains
  // events whose memoryId hasn't landed in `memories` yet. The reconciliation
  // effect must wait for sync to drain — otherwise every restored event is
  // tombstoned mid-sync and the tombstone is pushed back to Drive, wiping
  // calendar events on every device.
  it('does not tombstone events with not-yet-synced memoryIds while syncInProgress=true', async () => {
    const events = [makeEvent('e1', 'note-not-yet-synced')];
    (storageService.getCalendarEvents as any).mockResolvedValue(events);
    const tombstone = { ...events[0], isDeleted: true, updatedAt: Date.now() };
    (storageService.softDeleteCalendarEventsByMemoryId as any).mockResolvedValue([tombstone]);

    const onTombstones = vi.fn();
    const { rerender } = renderHook(
      ({ memories, syncInProgress }) =>
        useCalendarEvents({ memories, memoriesLoaded: true, syncInProgress, onTombstones }),
      { initialProps: { memories: [] as Memory[], syncInProgress: true } }
    );

    await waitFor(() => {
      expect(storageService.getCalendarEvents).toHaveBeenCalled();
    });
    await new Promise(r => setTimeout(r, 20));
    // Mid-sync: events visible in IDB, parent memory not yet — must not tombstone.
    expect(storageService.softDeleteCalendarEventsByMemoryId).not.toHaveBeenCalled();
    expect(onTombstones).not.toHaveBeenCalled();

    // Sync completes; parent memory is now in the active set. Still no tombstones.
    rerender({ memories: [makeMemory('note-not-yet-synced')], syncInProgress: false });
    await new Promise(r => setTimeout(r, 20));
    expect(storageService.softDeleteCalendarEventsByMemoryId).not.toHaveBeenCalled();
    expect(onTombstones).not.toHaveBeenCalled();
  });

  // Once a sync finishes, a truly-orphaned event (memory really is gone) must
  // still be reconciled — the syncInProgress gate is a deferral, not a bypass.
  it('reconciles real orphans once syncInProgress transitions to false', async () => {
    const events = [makeEvent('e-orphan', 'deleted-note')];
    (storageService.getCalendarEvents as any).mockResolvedValue(events);
    const tombstone = { ...events[0], isDeleted: true, updatedAt: Date.now() };
    (storageService.softDeleteCalendarEventsByMemoryId as any).mockResolvedValue([tombstone]);

    const onTombstones = vi.fn();
    const { rerender } = renderHook(
      ({ syncInProgress }) =>
        useCalendarEvents({ memories: [], memoriesLoaded: true, syncInProgress, onTombstones }),
      { initialProps: { syncInProgress: true } }
    );

    await waitFor(() => {
      expect(storageService.getCalendarEvents).toHaveBeenCalled();
    });
    expect(storageService.softDeleteCalendarEventsByMemoryId).not.toHaveBeenCalled();

    rerender({ syncInProgress: false });
    await waitFor(() => {
      expect(storageService.softDeleteCalendarEventsByMemoryId).toHaveBeenCalledWith('deleted-note');
      expect(onTombstones).toHaveBeenCalledWith([tombstone]);
    });
  });

  // Regression: on a cold start after an Android process kill, IndexedDB can
  // be missing recently-written memories that still exist on Drive, while
  // their extracted calendar events survived locally. Until the first sync of
  // the session restores the memory, a missing parent must NOT be treated as
  // deleted — tombstoning would push the tombstones to Drive and delete the
  // events on every device.
  it('does not tombstone orphans before the initial sync completes', async () => {
    const events = [makeEvent('e1', 'note-lost-from-idb')];
    (storageService.getCalendarEvents as any).mockResolvedValue(events);
    (storageService.softDeleteCalendarEventsByMemoryId as any).mockResolvedValue([
      { ...events[0], isDeleted: true, updatedAt: Date.now() },
    ]);

    const onTombstones = vi.fn();
    const { rerender } = renderHook(
      ({ memories, initialSyncComplete }) =>
        useCalendarEvents({ memories, memoriesLoaded: true, initialSyncComplete, onTombstones }),
      { initialProps: { memories: [] as Memory[], initialSyncComplete: false } }
    );

    await waitFor(() => {
      expect(storageService.getCalendarEvents).toHaveBeenCalled();
    });
    await new Promise(r => setTimeout(r, 20));
    // Pre-sync: parent memory missing locally — must not tombstone.
    expect(storageService.softDeleteCalendarEventsByMemoryId).not.toHaveBeenCalled();
    expect(onTombstones).not.toHaveBeenCalled();

    // Initial sync restores the memory from Drive. Still no tombstones.
    rerender({ memories: [makeMemory('note-lost-from-idb')], initialSyncComplete: true });
    await new Promise(r => setTimeout(r, 20));
    expect(storageService.softDeleteCalendarEventsByMemoryId).not.toHaveBeenCalled();
    expect(onTombstones).not.toHaveBeenCalled();
  });

  it('reconciles real orphans once initialSyncComplete turns true', async () => {
    const events = [makeEvent('e-orphan', 'deleted-note')];
    (storageService.getCalendarEvents as any).mockResolvedValue(events);
    const tombstone = { ...events[0], isDeleted: true, updatedAt: Date.now() };
    (storageService.softDeleteCalendarEventsByMemoryId as any).mockResolvedValue([tombstone]);

    const onTombstones = vi.fn();
    const { rerender } = renderHook(
      ({ initialSyncComplete }) =>
        useCalendarEvents({ memories: [], memoriesLoaded: true, initialSyncComplete, onTombstones }),
      { initialProps: { initialSyncComplete: false } }
    );

    await waitFor(() => {
      expect(storageService.getCalendarEvents).toHaveBeenCalled();
    });
    expect(storageService.softDeleteCalendarEventsByMemoryId).not.toHaveBeenCalled();

    rerender({ initialSyncComplete: true });
    await waitFor(() => {
      expect(storageService.softDeleteCalendarEventsByMemoryId).toHaveBeenCalledWith('deleted-note');
      expect(onTombstones).toHaveBeenCalledWith([tombstone]);
    });
  });
});

describe('useCalendarEvents lost-event recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageService.getCalendarEvents as any).mockResolvedValue([]);
    (storageService.getCalendarEventsByMemoryId as any).mockResolvedValue([]);
    (storageService.saveCalendarEvents as any).mockResolvedValue(undefined);
    (storageService.softDeleteCalendarEventsByMemoryId as any).mockResolvedValue([]);
    (storageService.replaceCalendarEventsForMemory as any).mockResolvedValue([]);
  });

  it('recreates events from enrichment when none exist in IDB', async () => {
    const memory = makeEnrichedMemory('note-1', [makeDetectedEvent()]);

    const onRecovered = vi.fn();
    renderHook(() =>
      useCalendarEvents({ memories: [memory], memoriesLoaded: true, initialSyncComplete: true, onRecovered })
    );

    await waitFor(() => {
      expect(storageService.replaceCalendarEventsForMemory).toHaveBeenCalledTimes(1);
    });
    const [memoryId, created] = (storageService.replaceCalendarEventsForMemory as any).mock.calls[0];
    expect(memoryId).toBe('note-1');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ memoryId: 'note-1', title: 'Dance class' });

    await waitFor(() => {
      expect(onRecovered).toHaveBeenCalledWith(created);
    });
  });

  it('expands recurring detected events when recovering', async () => {
    const memory = makeEnrichedMemory('note-recurring', [
      makeDetectedEvent({ isRecurring: true, recurrenceFrequency: 'weekly' }),
    ]);

    renderHook(() =>
      useCalendarEvents({ memories: [memory], memoriesLoaded: true, initialSyncComplete: true })
    );

    await waitFor(() => {
      expect(storageService.replaceCalendarEventsForMemory).toHaveBeenCalledTimes(1);
    });
    const [, created] = (storageService.replaceCalendarEventsForMemory as any).mock.calls[0];
    expect(created.length).toBeGreaterThan(1);
    expect(created.every((e: CalendarEvent) => e.memoryId === 'note-recurring')).toBe(true);
  });

  it('does not recreate when IDB still has rows for the memory', async () => {
    const memory = makeEnrichedMemory('note-1', [makeDetectedEvent()]);
    // Rows exist in IDB (e.g. tombstones, or events not yet loaded into state).
    (storageService.getCalendarEventsByMemoryId as any).mockResolvedValue([
      { ...makeEvent('e1', 'note-1'), isDeleted: true },
    ]);

    const onRecovered = vi.fn();
    renderHook(() =>
      useCalendarEvents({ memories: [memory], memoriesLoaded: true, initialSyncComplete: true, onRecovered })
    );

    await waitFor(() => {
      expect(storageService.getCalendarEventsByMemoryId).toHaveBeenCalledWith('note-1');
    });
    await new Promise(r => setTimeout(r, 20));
    expect(storageService.replaceCalendarEventsForMemory).not.toHaveBeenCalled();
    expect(onRecovered).not.toHaveBeenCalled();
  });

  it('does not recover before the initial sync completes', async () => {
    const memory = makeEnrichedMemory('note-1', [makeDetectedEvent()]);

    const { rerender } = renderHook(
      ({ initialSyncComplete }) =>
        useCalendarEvents({ memories: [memory], memoriesLoaded: true, initialSyncComplete }),
      { initialProps: { initialSyncComplete: false } }
    );

    await waitFor(() => {
      expect(storageService.getCalendarEvents).toHaveBeenCalled();
    });
    await new Promise(r => setTimeout(r, 20));
    // Events may simply not have downloaded yet — recreating now would
    // duplicate them under fresh IDs once the download lands.
    expect(storageService.replaceCalendarEventsForMemory).not.toHaveBeenCalled();

    rerender({ initialSyncComplete: true });
    await waitFor(() => {
      expect(storageService.replaceCalendarEventsForMemory).toHaveBeenCalledTimes(1);
    });
  });
});
