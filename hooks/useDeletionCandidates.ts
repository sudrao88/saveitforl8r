/**
 * useDeletionCandidates.ts
 *
 * Computes memories that are candidates for deletion because all their
 * associated calendar events are in the past and all todo items are completed.
 * Memories with no events AND no todos are excluded.
 * Memories the user has previously dismissed are excluded.
 */

import { useMemo } from 'react';
import { Memory, CalendarEvent, TodoItem } from '../types';

/** Returns true if a calendar event's effective end time is in the past. */
const isEventPast = (event: CalendarEvent, now: Date): boolean => {
  const endStr = event.endDate || event.startDate;
  if (event.allDay) {
    // All-day events: consider past if the date is before today
    const dateOnly = endStr.split('T')[0];
    const todayStr = now.toISOString().split('T')[0];
    return dateOnly < todayStr;
  }
  return new Date(endStr).getTime() < now.getTime();
};

export const useDeletionCandidates = (
  memories: Memory[],
  calendarEvents: CalendarEvent[],
  todoItems: TodoItem[],
): Memory[] => {
  return useMemo(() => {
    const now = new Date();

    // Build lookup maps: memoryId → active items
    const eventsByMemory = new Map<string, CalendarEvent[]>();
    for (const event of calendarEvents) {
      if (event.isDeleted) continue;
      const list = eventsByMemory.get(event.memoryId) || [];
      list.push(event);
      eventsByMemory.set(event.memoryId, list);
    }

    const todosByMemory = new Map<string, TodoItem[]>();
    for (const item of todoItems) {
      if (item.isDeleted || item.isDismissed) continue;
      const list = todosByMemory.get(item.memoryId) || [];
      list.push(item);
      todosByMemory.set(item.memoryId, list);
    }

    const candidates: Memory[] = [];

    for (const memory of memories) {
      if (memory.isDeleted || memory.isDeletionDismissed) continue;

      const events = eventsByMemory.get(memory.id) || [];
      const todos = todosByMemory.get(memory.id) || [];

      // Must have at least one event or todo to be considered
      if (events.length === 0 && todos.length === 0) continue;

      const allEventsPast = events.length === 0 || events.every(e => isEventPast(e, now));
      const allTodosCompleted = todos.length === 0 || todos.every(t => t.isCompleted);

      if (allEventsPast && allTodosCompleted) {
        candidates.push(memory);
      }
    }

    return candidates;
  }, [memories, calendarEvents, todoItems]);
};
