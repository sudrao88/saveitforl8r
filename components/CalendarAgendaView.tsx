/**
 * CalendarAgendaView.tsx
 *
 * Full-screen agenda view showing calendar events extracted from notes.
 * Events are grouped by individual date with month separators (Google Calendar agenda-style).
 * Multi-day events appear on every day they span, titled "(Day n/N)", with the
 * start time on the first day and "Until <time>" on the last.
 * Today and Tomorrow get special labels; all other dates show weekday + date.
 * Tapping an event card navigates to the source memory.
 */

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { useBackButton } from '../hooks/useBackButton';
import {
  X,
  Calendar,
  MapPin,
  Users,
  Clock,
  FileText,
  CalendarDays,
  Repeat,
  Pencil,
} from 'lucide-react';
import { CalendarEvent, TodoItem, Memory, Attachment } from '../types';
import MemoryPreviewModal from './MemoryPreviewModal';
import EventEditDialog from './EventEditDialog';
import { expandEventDays, MultiDayInfo } from '../utils/calendarUtils';
import { btn, overlay } from '../styles/design-system';

interface CalendarAgendaViewProps {
  events: CalendarEvent[];
  memories: Memory[];
  onClose: () => void;
  onViewAttachment?: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onDelete?: (id: string) => void;
  onEdit?: (memory: Memory) => void;
  onTogglePin?: (id: string, isPinned: boolean) => void;
  /** When set, scroll to this event and flash a highlight ring */
  highlightEventId?: string | null;
  /** Called once the highlight has been shown, so the owner can clear it */
  onHighlightHandled?: () => void;
  /** To-do items grouped by source memory (for links in the preview modal) */
  todosByMemory?: Map<string, TodoItem[]>;
  /** Opens the calendar scrolled to the given event (from preview modal links) */
  onOpenEvent?: (eventId: string) => void;
  /** Opens the to-do list scrolled to the given item (from preview modal links) */
  onOpenTodoItem?: (itemId: string) => void;
  /**
   * Persist edits to a single event. For occurrences of a recurring series
   * only that occurrence changes. When omitted, event editing is disabled.
   */
  onUpdateEvent?: (eventId: string, changes: Partial<CalendarEvent>) => Promise<void> | void;
}

// One event card within a day group; multi-day events produce an item
// on every day they span, tagged with their position in the span.
interface AgendaItem {
  event: CalendarEvent;
  sortKey: string;
  multiDay?: MultiDayInfo;
}

// Group events by individual date (Google Calendar agenda-style)
interface DateGroup {
  dateKey: string;
  label: string;
  sublabel?: string;
  items: AgendaItem[];
  isPast: boolean;
  isToday: boolean;
  month: string;
  monthLabel: string;
}

const formatTime = (isoString: string): string | null => {
  if (!isoString.includes('T')) return null;
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
};

const groupEventsByDate = (events: CalendarEvent[]): DateGroup[] => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // Group events by date, expanding multi-day events onto every day they span
  const dateMap = new Map<string, AgendaItem[]>();
  for (const event of events) {
    for (const occ of expandEventDays(event)) {
      if (!dateMap.has(occ.dateKey)) dateMap.set(occ.dateKey, []);
      dateMap.get(occ.dateKey)!.push({ event, sortKey: occ.sortKey, multiDay: occ.multiDay });
    }
  }

  // Sort dates chronologically, then reorder so past dates come after today+future
  const sortedDates = [...dateMap.keys()].sort();
  const futureDates = sortedDates.filter(d => d >= today);
  const pastDates = sortedDates.filter(d => d < today).reverse();
  const orderedDates = [...futureDates, ...pastDates];

  return orderedDates.map(dateKey => {
    const date = new Date(dateKey + 'T00:00:00');
    const isPast = dateKey < today;
    const isToday = dateKey === today;
    const isTomorrow = dateKey === tomorrowStr;
    const month = dateKey.substring(0, 7);

    let label: string;
    let sublabel: string | undefined;

    if (isToday || isTomorrow) {
      label = isToday ? 'Today' : 'Tomorrow';
      sublabel = date.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
    } else {
      label = date.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      });
    }

    const monthLabel = date.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });

    // Sort events within each day by time (multi-day continuations sort
    // first alongside all-day events — their sort key has no time portion)
    const dayItems = dateMap
      .get(dateKey)!
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    return {
      dateKey,
      label,
      sublabel,
      items: dayItems,
      isPast,
      isToday,
      month,
      monthLabel,
    };
  });
};

const statusColors: Record<string, string> = {
  confirmed: 'bg-(--color-success)/20 text-(--color-success) border-(--color-success)/30',
  tentative: 'bg-(--color-warning)/20 text-(--color-warning) border-(--color-warning)/30',
  cancelled: 'bg-(--color-danger)/20 text-(--color-danger) border-(--color-danger)/30 line-through',
};

const EventCard: React.FC<{
  event: CalendarEvent;
  memory?: Memory;
  isPast: boolean;
  isHighlighted?: boolean;
  multiDay?: MultiDayInfo;
  onViewMemory: (memory: Memory) => void;
  onEditEvent?: (event: CalendarEvent) => void;
}> = ({ event, memory, isPast, isHighlighted, multiDay, onViewMemory, onEditEvent }) => {
  const time = formatTime(event.startDate);
  const endTime = event.endDate ? formatTime(event.endDate) : null;
  const detailTextClass = isPast ? 'text-(--color-text-tertiary)' : 'text-(--color-text-secondary)';

  // Multi-day timed events show the start time on day 1, "Until <end>" on
  // the last day, and no time on middle days (Google Calendar style).
  const isFirstDay = !multiDay || multiDay.dayIndex === 1;
  let timeLabel: string | null = null;
  if (!event.allDay) {
    if (!multiDay) {
      timeLabel = time ? `${time}${endTime ? ` – ${endTime}` : ''}` : null;
    } else if (multiDay.dayIndex === 1) {
      timeLabel = time;
    } else if (multiDay.dayIndex === multiDay.totalDays && endTime) {
      timeLabel = `Until ${endTime}`;
    }
  }

  return (
    <div
      data-event-id={event.id}
      className={`rounded-(--radius-xl) border p-4 transition-all duration-(--duration-fast) ${
        isPast
          ? 'border-(--color-border-subtle) bg-(--color-surface-overlay)/30'
          : event.status === 'cancelled'
            ? 'border-(--color-danger)/30 bg-(--color-danger)/20'
            : 'border-(--color-border-subtle) bg-(--color-surface-raised)/30 hover:bg-(--color-surface-raised)/50'
      } ${isHighlighted ? 'ring-2 ring-(--color-accent)' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Title */}
          <h3
            className={`font-semibold text-base ${
              event.status === 'cancelled'
                ? 'text-(--color-danger) line-through'
                : isPast
                  ? 'text-(--color-text-tertiary)'
                  : 'text-(--color-text-primary)'
            }`}
          >
            {event.title}
            {multiDay && ` (Day ${multiDay.dayIndex}/${multiDay.totalDays})`}
          </h3>

          {/* Time */}
          {timeLabel && (
            <div className={`flex items-center gap-1.5 mt-1.5 text-sm ${detailTextClass}`}>
              <Clock size={14} className="shrink-0" />
              <span>{timeLabel}</span>
            </div>
          )}
          {event.allDay && (
            <div className={`flex items-center gap-1.5 mt-1.5 text-sm ${detailTextClass}`}>
              <CalendarDays size={14} className="shrink-0" />
              <span>All day</span>
            </div>
          )}

          {/* Location */}
          {isFirstDay && event.location && (
            <div className={`flex items-center gap-1.5 mt-1 text-sm ${detailTextClass}`}>
              <MapPin size={14} className="shrink-0" />
              <span className="truncate">{event.location}</span>
            </div>
          )}

          {/* People */}
          {isFirstDay && event.people && event.people.length > 0 && (
            <div className={`flex items-center gap-1.5 mt-1 text-sm ${detailTextClass}`}>
              <Users size={14} className="shrink-0" />
              <span className="truncate">{event.people.join(', ')}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {/* Status badge */}
          <span
            className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
              statusColors[event.status] || statusColors.confirmed
            }`}
          >
            {event.status}
          </span>
          {/* Recurrence indicator */}
          {event.recurringGroupId && (
            <span className="flex items-center gap-1 text-xs text-(--color-accent)">
              <Repeat size={10} />
              {event.recurrenceRule?.frequency}
              {event.isModifiedOccurrence ? ' · edited' : ''}
            </span>
          )}
          {/* Edit (first day only for multi-day spans) */}
          {onEditEvent && isFirstDay && (
            <button
              onClick={() => onEditEvent(event)}
              className={`${btn.icon} -mr-2`}
              aria-label="Edit event"
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Description (first day only for multi-day spans) */}
      {isFirstDay && event.description && (
        <p className="mt-2 text-xs text-(--color-text-tertiary) line-clamp-2">{event.description}</p>
      )}

      {/* View source note */}
      {memory && (
        <button
          onClick={() => onViewMemory(memory)}
          className="mt-3 flex items-center gap-1.5 text-xs text-(--color-accent) hover:text-(--color-accent-hover) transition-colors"
        >
          <FileText size={12} />
          View source note
        </button>
      )}
    </div>
  );
};

const CalendarAgendaView: React.FC<CalendarAgendaViewProps> = ({
  events,
  memories,
  onClose,
  onViewAttachment,
  onDelete,
  onEdit,
  onTogglePin,
  highlightEventId,
  onHighlightHandled,
  todosByMemory,
  onOpenEvent,
  onOpenTodoItem,
  onUpdateEvent,
}) => {
  const [previewMemoryId, setPreviewMemoryId] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const memoryMap = useMemo(
    () => new Map(memories.map(m => [m.id, m])),
    [memories]
  );

  const dateGroups = useMemo(() => groupEventsByDate(events), [events]);

  const previewMemory = previewMemoryId ? memoryMap.get(previewMemoryId) ?? null : null;

  const previewEvents = useMemo(
    () => (previewMemoryId ? events.filter(e => e.memoryId === previewMemoryId) : []),
    [events, previewMemoryId]
  );
  const previewTodos = previewMemoryId ? todosByMemory?.get(previewMemoryId) : undefined;

  // Scroll to and briefly highlight the requested event (e.g. from a note's
  // "In Calendar" link), closing any open preview so the scroll is visible.
  useEffect(() => {
    if (!highlightEventId) return;
    setPreviewMemoryId(null);
    setActiveHighlightId(highlightEventId);
    let innerRaf = 0;
    const raf = requestAnimationFrame(() => {
      // Second frame so the preview-close re-render has committed
      innerRaf = requestAnimationFrame(() => {
        const el = scrollContainerRef.current?.querySelector(`[data-event-id="${highlightEventId}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
    const timer = setTimeout(() => {
      setActiveHighlightId(null);
      onHighlightHandled?.();
    }, 2000);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(innerRaf);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightEventId]);

  // Dismiss preview modal on Android back button
  useBackButton(() => setPreviewMemoryId(null), previewMemoryId !== null);

  // Dismiss event edit dialog on Android back button
  useBackButton(() => setEditingEvent(null), editingEvent !== null);

  const handleViewMemory = useCallback(
    (memory: Memory) => {
      setPreviewMemoryId(memory.id);
    },
    []
  );

  return (
    <div className={overlay.sheetBase}>
      {/* Header */}
      <div className={overlay.sheetHeader}>
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className={overlay.closeBtn}
          >
            <X size={24} />
          </button>
          <div className="flex items-center gap-2">
            <Calendar size={20} className="text-(--color-accent)" />
            <h2 className="text-lg font-bold text-(--color-text-primary)">Calendar</h2>
          </div>
        </div>
        <span className="text-sm text-(--color-text-tertiary)">
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-8 text-center">
            <Calendar size={48} className="text-(--color-text-tertiary) mb-4" />
            <h3 className="text-lg font-semibold text-(--color-text-secondary) mb-2">
              No events yet
            </h3>
            <p className="text-sm text-(--color-text-tertiary) max-w-xs">
              Your calendar builds itself. Save a note with a date — like a
              wedding invite, meeting, or appointment — and it&apos;ll show up here.
            </p>
          </div>
        ) : (
          <div className="px-4 py-4 pb-20 max-w-2xl mx-auto w-full">
            {dateGroups.map((group, idx) => {
              const prevMonth = idx > 0 ? dateGroups[idx - 1].month : null;
              const showMonthSeparator = group.month !== prevMonth;

              return (
                <React.Fragment key={group.dateKey}>
                  {/* Month separator */}
                  {showMonthSeparator && (
                    <div className={`flex items-center gap-3 ${idx > 0 ? 'mt-8' : ''} mb-4`}>
                      <h2 className="text-sm font-bold text-(--color-text-primary) whitespace-nowrap">
                        {group.monthLabel}
                      </h2>
                      <div className="flex-1 h-px bg-(--color-border-default)" />
                    </div>
                  )}

                  {/* Date group */}
                  <section className="mb-4">
                    <div className="flex items-baseline gap-2 mb-2">
                      <h3
                        className={`text-sm font-semibold ${
                          group.isToday
                            ? 'text-(--color-accent)'
                            : group.isPast
                              ? 'text-(--color-text-tertiary)'
                              : 'text-(--color-text-secondary)'
                        }`}
                      >
                        {group.label}
                      </h3>
                      {group.sublabel && (
                        <span className="text-xs text-(--color-text-tertiary)">
                          {group.sublabel}
                        </span>
                      )}
                    </div>
                    <div className="space-y-3">
                      {group.items.map(({ event, multiDay }) => (
                        <EventCard
                          key={event.id}
                          event={event}
                          memory={memoryMap.get(event.memoryId)}
                          isPast={group.isPast}
                          isHighlighted={activeHighlightId === event.id}
                          multiDay={multiDay}
                          onViewMemory={handleViewMemory}
                          onEditEvent={onUpdateEvent ? setEditingEvent : undefined}
                        />
                      ))}
                    </div>
                  </section>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* Event Edit Dialog */}
      {editingEvent && onUpdateEvent && (
        <EventEditDialog
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSave={changes => onUpdateEvent(editingEvent.id, changes)}
        />
      )}

      {/* Memory Preview Modal */}
      {previewMemory && (
        <MemoryPreviewModal
          memory={previewMemory}
          onClose={() => setPreviewMemoryId(null)}
          onViewAttachment={onViewAttachment}
          onDelete={onDelete}
          onEdit={onEdit}
          onTogglePin={onTogglePin}
          calendarEvents={previewEvents}
          todoItems={previewTodos}
          onOpenCalendarEvent={onOpenEvent}
          onOpenTodoItem={onOpenTodoItem}
        />
      )}
    </div>
  );
};

export default CalendarAgendaView;
