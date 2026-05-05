import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCalendarEvents } from './useCalendarEvents';
import * as storageService from '../services/storageService';
import { CalendarEvent, Memory } from '../types';

vi.mock('../services/storageService');

const makeMemory = (id: string): Memory => ({
  id,
  content: 'test',
  timestamp: Date.now(),
  tags: [],
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
    (storageService.saveCalendarEvents as any).mockResolvedValue(undefined);
    (storageService.softDeleteCalendarEventsByMemoryId as any).mockResolvedValue([]);
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
});
