/**
 * useTodoItems.ts
 *
 * React hook for managing todo items extracted from notes.
 * Items are automatically created/updated when enrichment detects
 * action items in note content. Users can toggle completion.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TodoItem, DetectedActionItem, Memory } from '../types';
import { logEvent } from '../services/analytics';
import { ANALYTICS_EVENTS } from '../constants';
import {
  getTodoItems,
  saveTodoItems,
  updateTodoItem,
  softDeleteTodoItemsByMemoryId,
  replaceTodoItemsForMemory,
} from '../services/storageService';

export interface UseTodoItemsReturn {
  /** All active todo items, sorted by deadline ascending (no-deadline last), completed last */
  items: TodoItem[];
  /** Create/replace items for a memory from enrichment results. Returns all items that need syncing (new + tombstones). */
  processDetectedActionItems: (memory: Memory) => Promise<TodoItem[]>;
  /** Remove all items associated with a deleted memory. Returns tombstones that need syncing. */
  removeItemsForMemory: (memoryId: string) => Promise<TodoItem[]>;
  /** Toggle completion status of a todo item. Returns the updated item for syncing, or null if not found. */
  toggleComplete: (itemId: string) => Promise<TodoItem | null>;
  /** Reload items from IndexedDB (e.g. after sync) */
  refreshItems: () => Promise<void>;
  /** Count of pending (not completed) items */
  pendingCount: number;
}

export const useTodoItems = (): UseTodoItemsReturn => {
  const [itemsList, setItemsList] = useState<TodoItem[]>([]);
  const loaded = useRef(false);
  const processingMemoryIds = useRef(new Set<string>());

  const refreshItems = useCallback(async () => {
    try {
      const loadedItems = await getTodoItems();
      setItemsList(loadedItems);
    } catch (err) {
      console.error('[Todo] Failed to refresh items:', err);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    refreshItems();
  }, [refreshItems]);

  const processDetectedActionItems = useCallback(async (memory: Memory): Promise<TodoItem[]> => {
    if (processingMemoryIds.current.has(memory.id)) {
      console.log(`[Todo] Skipping concurrent processDetectedActionItems for memory ${memory.id}`);
      return [];
    }
    processingMemoryIds.current.add(memory.id);

    try {
      const detected = memory.enrichment?.detectedActionItems;
      if (!detected || detected.length === 0) {
        // No action items detected — soft-delete any old items for this memory
        const tombstones = await softDeleteTodoItemsByMemoryId(memory.id);
        if (tombstones.length > 0) {
          const tombstoneMap = new Map(tombstones.map(t => [t.id, t]));
          setItemsList(prev => prev.map(item =>
            tombstoneMap.has(item.id) ? tombstoneMap.get(item.id)! : item
          ));
        }
        return tombstones;
      }

      const now = Date.now();
      const newItems: TodoItem[] = detected.map((det: DetectedActionItem) => ({
        id: crypto.randomUUID(),
        memoryId: memory.id,
        title: det.title,
        description: memory.enrichment?.summary,
        deadline: det.deadline,
        priority: det.priority || 'medium',
        isCompleted: false,
        createdAt: now,
        updatedAt: now,
      }));

      const tombstones = await replaceTodoItemsForMemory(memory.id, newItems);

      setItemsList(prev => [
        // Keep tombstones in state for consistency with IDB
        ...prev.filter(item => item.memoryId !== memory.id),
        ...tombstones,
        ...newItems,
      ]);

      logEvent(ANALYTICS_EVENTS.TODO_ITEM.CATEGORY, ANALYTICS_EVENTS.TODO_ITEM.ACTION_CREATED, undefined, newItems.length);
      console.log(`[Todo] Created ${newItems.length} item(s) from memory ${memory.id}`);
      return [...tombstones, ...newItems];
    } finally {
      processingMemoryIds.current.delete(memory.id);
    }
  }, []);

  const removeItemsForMemory = useCallback(async (memoryId: string): Promise<TodoItem[]> => {
    const tombstones = await softDeleteTodoItemsByMemoryId(memoryId);
    if (tombstones.length > 0) {
      const tombstoneMap = new Map(tombstones.map(t => [t.id, t]));
      setItemsList(prev => prev.map(item =>
        tombstoneMap.has(item.id) ? tombstoneMap.get(item.id)! : item
      ));
    }
    return tombstones;
  }, []);

  const toggleComplete = useCallback(async (itemId: string): Promise<TodoItem | null> => {
    const item = itemsList.find(i => i.id === itemId);
    if (!item) return null;

    const now = Date.now();
    const updated: TodoItem = {
      ...item,
      isCompleted: !item.isCompleted,
      completedAt: !item.isCompleted ? now : undefined,
      updatedAt: now,
    };

    await updateTodoItem(updated);
    setItemsList(prev => prev.map(i => i.id === itemId ? updated : i));

    const action = updated.isCompleted
      ? ANALYTICS_EVENTS.TODO_ITEM.ACTION_COMPLETED
      : ANALYTICS_EVENTS.TODO_ITEM.ACTION_UNCOMPLETED;
    logEvent(ANALYTICS_EVENTS.TODO_ITEM.CATEGORY, action);

    return updated;
  }, [itemsList]);

  // Sort: non-completed first (by deadline asc, no-deadline last), then completed (by completedAt desc)
  const items = useMemo(
    () => itemsList
      .filter(item => !item.isDeleted)
      .sort((a, b) => {
        // Completed items go last
        if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
        // Within completed: most recently completed first
        if (a.isCompleted && b.isCompleted) return (b.completedAt || 0) - (a.completedAt || 0);
        // Within non-completed: sort by deadline (no deadline last)
        if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
        if (a.deadline && !b.deadline) return -1;
        if (!a.deadline && b.deadline) return 1;
        return 0;
      }),
    [itemsList]
  );

  const pendingCount = useMemo(
    () => items.filter(item => !item.isCompleted).length,
    [items]
  );

  return {
    items,
    processDetectedActionItems,
    removeItemsForMemory,
    toggleComplete,
    refreshItems,
    pendingCount,
  };
};
