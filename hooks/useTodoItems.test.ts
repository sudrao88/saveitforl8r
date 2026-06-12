import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTodoItems } from './useTodoItems';
import * as storageService from '../services/storageService';
import { Memory, TodoItem } from '../types';

vi.mock('../services/storageService');

const makeMemory = (id: string): Memory => ({
  id,
  content: 'test',
  timestamp: Date.now(),
  tags: [],
});

const makeTodo = (id: string, memoryId: string, overrides: Partial<TodoItem> = {}): TodoItem => ({
  id,
  memoryId,
  title: `todo-${id}`,
  priority: 'medium',
  isCompleted: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

describe('useTodoItems orphan reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageService.getTodoItems as any).mockResolvedValue([]);
    (storageService.saveTodoItems as any).mockResolvedValue(undefined);
    (storageService.updateTodoItem as any).mockResolvedValue(undefined);
    (storageService.softDeleteTodoItemsByMemoryId as any).mockResolvedValue([]);
  });

  it('returns items whose source memory still exists', async () => {
    const items = [makeTodo('t1', 'note-1'), makeTodo('t2', 'note-2')];
    (storageService.getTodoItems as any).mockResolvedValue(items);

    const memories = [makeMemory('note-1'), makeMemory('note-2')];
    const { result } = renderHook(() =>
      useTodoItems({ memories, memoriesLoaded: true })
    );

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });
  });

  it('filters items whose source memory has been deleted', async () => {
    const items = [
      makeTodo('t1', 'note-1'),
      makeTodo('t-orphan', 'deleted-note'),
    ];
    (storageService.getTodoItems as any).mockResolvedValue(items);
    // Reconciliation will softDelete the orphan; return its tombstone.
    (storageService.softDeleteTodoItemsByMemoryId as any).mockImplementation(async (memoryId: string) => {
      if (memoryId === 'deleted-note') {
        return [{ ...items[1], isDeleted: true, updatedAt: Date.now() }];
      }
      return [];
    });

    const memories = [makeMemory('note-1')]; // 'deleted-note' is gone
    const { result } = renderHook(() =>
      useTodoItems({ memories, memoriesLoaded: true })
    );

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].id).toBe('t1');
    });
  });

  it('soft-deletes orphan items in IndexedDB and invokes the onTombstones callback', async () => {
    const items = [
      makeTodo('t-orphan', 'deleted-note'),
      makeTodo('t-keep', 'note-1'),
    ];
    (storageService.getTodoItems as any).mockResolvedValue(items);
    const tombstone = { ...items[0], isDeleted: true, updatedAt: Date.now() };
    (storageService.softDeleteTodoItemsByMemoryId as any).mockImplementation(async (memoryId: string) => {
      if (memoryId === 'deleted-note') return [tombstone];
      return [];
    });

    const onTombstones = vi.fn();
    const memories = [makeMemory('note-1')];
    renderHook(() =>
      useTodoItems({ memories, memoriesLoaded: true, onTombstones })
    );

    await waitFor(() => {
      expect(storageService.softDeleteTodoItemsByMemoryId).toHaveBeenCalledWith('deleted-note');
      expect(onTombstones).toHaveBeenCalledWith([tombstone]);
    });
    // Should not tombstone the live note's items.
    expect(storageService.softDeleteTodoItemsByMemoryId).not.toHaveBeenCalledWith('note-1');
  });

  it('does not reconcile while memoriesLoaded is false', async () => {
    const items = [makeTodo('t1', 'note-1')];
    (storageService.getTodoItems as any).mockResolvedValue(items);

    const onTombstones = vi.fn();
    const { result, rerender } = renderHook(
      ({ memories, memoriesLoaded }) =>
        useTodoItems({ memories, memoriesLoaded, onTombstones }),
      {
        // Memories empty AND not yet loaded — would otherwise look like every item is orphaned.
        initialProps: { memories: [] as Memory[], memoriesLoaded: false },
      }
    );

    // Wait for the items to load from IDB.
    await waitFor(() => {
      // While memoriesLoaded is false, no orphan filter is applied yet either,
      // so items can still appear (the gate is solely on tombstoning, not display).
      // What we care about: softDelete must not be called.
      expect(storageService.getTodoItems).toHaveBeenCalled();
    });

    // Give any stray reconciliation effect a chance to run (it shouldn't).
    await new Promise(r => setTimeout(r, 20));
    expect(storageService.softDeleteTodoItemsByMemoryId).not.toHaveBeenCalled();
    expect(onTombstones).not.toHaveBeenCalled();

    // Once memories load (and note-1 is present), still no tombstones.
    rerender({ memories: [makeMemory('note-1')], memoriesLoaded: true });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    expect(storageService.softDeleteTodoItemsByMemoryId).not.toHaveBeenCalled();
  });

  // Regression: see the matching test in useCalendarEvents.test.ts. After a
  // wipe-and-fresh-sync the todo shard finishes before the bulkier memory
  // files. Reconciliation must defer until sync drains, otherwise every
  // just-restored item is tombstoned and the tombstone is pushed back to Drive.
  it('does not tombstone items with not-yet-synced memoryIds while syncInProgress=true', async () => {
    const items = [makeTodo('t1', 'note-not-yet-synced')];
    (storageService.getTodoItems as any).mockResolvedValue(items);
    const tombstone = { ...items[0], isDeleted: true, updatedAt: Date.now() };
    (storageService.softDeleteTodoItemsByMemoryId as any).mockResolvedValue([tombstone]);

    const onTombstones = vi.fn();
    const { rerender } = renderHook(
      ({ memories, syncInProgress }) =>
        useTodoItems({ memories, memoriesLoaded: true, syncInProgress, onTombstones }),
      { initialProps: { memories: [] as Memory[], syncInProgress: true } }
    );

    await waitFor(() => {
      expect(storageService.getTodoItems).toHaveBeenCalled();
    });
    await new Promise(r => setTimeout(r, 20));
    expect(storageService.softDeleteTodoItemsByMemoryId).not.toHaveBeenCalled();
    expect(onTombstones).not.toHaveBeenCalled();

    rerender({ memories: [makeMemory('note-not-yet-synced')], syncInProgress: false });
    await new Promise(r => setTimeout(r, 20));
    expect(storageService.softDeleteTodoItemsByMemoryId).not.toHaveBeenCalled();
    expect(onTombstones).not.toHaveBeenCalled();
  });

  it('reconciles real orphans once syncInProgress transitions to false', async () => {
    const items = [makeTodo('t-orphan', 'deleted-note')];
    (storageService.getTodoItems as any).mockResolvedValue(items);
    const tombstone = { ...items[0], isDeleted: true, updatedAt: Date.now() };
    (storageService.softDeleteTodoItemsByMemoryId as any).mockResolvedValue([tombstone]);

    const onTombstones = vi.fn();
    const { rerender } = renderHook(
      ({ syncInProgress }) =>
        useTodoItems({ memories: [], memoriesLoaded: true, syncInProgress, onTombstones }),
      { initialProps: { syncInProgress: true } }
    );

    await waitFor(() => {
      expect(storageService.getTodoItems).toHaveBeenCalled();
    });
    expect(storageService.softDeleteTodoItemsByMemoryId).not.toHaveBeenCalled();

    rerender({ syncInProgress: false });
    await waitFor(() => {
      expect(storageService.softDeleteTodoItemsByMemoryId).toHaveBeenCalledWith('deleted-note');
      expect(onTombstones).toHaveBeenCalledWith([tombstone]);
    });
  });

  // Regression: on a cold start after an Android process kill, IndexedDB can
  // be missing recently-written memories that still exist on Drive, while
  // their extracted todo items survived locally. Until the first sync of the
  // session restores the memory, a missing parent must NOT be treated as
  // deleted — tombstoning would push the tombstones to Drive and delete the
  // items on every device.
  it('does not tombstone orphans before the initial sync completes', async () => {
    const items = [makeTodo('t1', 'note-lost-from-idb')];
    (storageService.getTodoItems as any).mockResolvedValue(items);
    (storageService.softDeleteTodoItemsByMemoryId as any).mockResolvedValue([
      { ...items[0], isDeleted: true, updatedAt: Date.now() },
    ]);

    const onTombstones = vi.fn();
    const { rerender } = renderHook(
      ({ memories, initialSyncComplete }) =>
        useTodoItems({ memories, memoriesLoaded: true, initialSyncComplete, onTombstones }),
      { initialProps: { memories: [] as Memory[], initialSyncComplete: false } }
    );

    await waitFor(() => {
      expect(storageService.getTodoItems).toHaveBeenCalled();
    });
    await new Promise(r => setTimeout(r, 20));
    // Pre-sync: parent memory missing locally — must not tombstone.
    expect(storageService.softDeleteTodoItemsByMemoryId).not.toHaveBeenCalled();
    expect(onTombstones).not.toHaveBeenCalled();

    // Initial sync restores the memory from Drive. Still no tombstones.
    rerender({ memories: [makeMemory('note-lost-from-idb')], initialSyncComplete: true });
    await new Promise(r => setTimeout(r, 20));
    expect(storageService.softDeleteTodoItemsByMemoryId).not.toHaveBeenCalled();
    expect(onTombstones).not.toHaveBeenCalled();
  });

  it('reconciles real orphans once initialSyncComplete turns true', async () => {
    const items = [makeTodo('t-orphan', 'deleted-note')];
    (storageService.getTodoItems as any).mockResolvedValue(items);
    const tombstone = { ...items[0], isDeleted: true, updatedAt: Date.now() };
    (storageService.softDeleteTodoItemsByMemoryId as any).mockResolvedValue([tombstone]);

    const onTombstones = vi.fn();
    const { rerender } = renderHook(
      ({ initialSyncComplete }) =>
        useTodoItems({ memories: [], memoriesLoaded: true, initialSyncComplete, onTombstones }),
      { initialProps: { initialSyncComplete: false } }
    );

    await waitFor(() => {
      expect(storageService.getTodoItems).toHaveBeenCalled();
    });
    expect(storageService.softDeleteTodoItemsByMemoryId).not.toHaveBeenCalled();

    rerender({ initialSyncComplete: true });
    await waitFor(() => {
      expect(storageService.softDeleteTodoItemsByMemoryId).toHaveBeenCalledWith('deleted-note');
      expect(onTombstones).toHaveBeenCalledWith([tombstone]);
    });
  });
});
