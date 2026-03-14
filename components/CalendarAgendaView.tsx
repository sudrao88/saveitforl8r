/**
 * CalendarAgendaView.tsx
 *
 * Full-screen agenda view showing calendar events extracted from notes.
 * Events are grouped by individual date with month separators (Google Calendar agenda-style).
 * Today and Tomorrow get special labels; all other dates show weekday + date.
 * Tapping an event card navigates to the source memory.
 */

import React, { useMemo, useCallback, useState } from 'react';
import {
  X,
  Calendar,
  MapPin,
  Users,
  Clock,
  FileText,
  CalendarDays,
  Repeat,
} from 'lucide-react';
import { CalendarEvent, Memory, Attachment } from '../types';
import MemoryCard from './MemoryCard';
import { overlay } from '../styles/design-system';

interface CalendarAgendaViewProps {
  events: CalendarEvent[];
  memories: Memory[];
  onClose: () => void;
  onViewAttachment?: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onDelete?: (id: string) => void;
  onEdit?: (memory: Memory) => void;
  onTogglePin?: (id: string, isPinned: boolean) => void;
}

// Group events by individual date (Google Calendar agenda-style)
interface DateGroup {
  dateKey: string;
  label: string;
  sublabel?: string;
  events: CalendarEvent[];
  isPast: boolean;
  isToday: boolean;
  month: string;
  monthLabel: string;
}

const getDateOnly = (isoString: string): string => {
  // Handle both date-only "2026-06-15" and datetime "2026-06-15T16:00:00"
  return isoString.split('T')[0];
};

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

  // Group events by date
  const dateMap = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const dateStr = getDateOnly(event.startDate);
    if (!dateMap.has(dateStr)) dateMap.set(dateStr, []);
    dateMap.get(dateStr)!.push(event);
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

    // Sort events within each day by time
    const dayEvents = dateMap
      .get(dateKey)!
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    return {
      dateKey,
      label,
      sublabel,
      events: dayEvents,
      isPast,
      isToday,
      month,
      monthLabel,
    };
  });
};

const statusColors: Record<string, string> = {
  confirmed: 'bg-green-500/20 text-green-400 border-green-500/30',
  tentative: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  cancelled: 'bg-red-500/20 text-red-400 border-red-500/30 line-through',
};

const EventCard: React.FC<{
  event: CalendarEvent;
  memory?: Memory;
  isPast: boolean;
  onViewMemory: (memory: Memory) => void;
}> = ({ event, memory, isPast, onViewMemory }) => {
  const time = formatTime(event.startDate);
  const endTime = event.endDate ? formatTime(event.endDate) : null;

  return (
    <div
      className={`rounded-(--radius-xl) border p-4 transition-all duration-(--duration-fast) ${
        isPast
          ? 'border-(--color-border-subtle) bg-gray-900/30 opacity-60'
          : event.status === 'cancelled'
            ? 'border-red-900/30 bg-red-950/20'
            : 'border-(--color-border-subtle) bg-(--color-surface-raised)/30 hover:bg-(--color-surface-raised)/50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Title */}
          <h3
            className={`font-semibold text-base ${
              event.status === 'cancelled'
                ? 'text-red-400 line-through'
                : isPast
                  ? 'text-(--color-text-tertiary)'
                  : 'text-(--color-text-primary)'
            }`}
          >
            {event.title}
          </h3>

          {/* Time */}
          {!event.allDay && time && (
            <div className="flex items-center gap-1.5 mt-1.5 text-sm text-(--color-text-secondary)">
              <Clock size={14} className="shrink-0" />
              <span>
                {time}
                {endTime && ` – ${endTime}`}
              </span>
            </div>
          )}
          {event.allDay && (
            <div className="flex items-center gap-1.5 mt-1.5 text-sm text-(--color-text-secondary)">
              <CalendarDays size={14} className="shrink-0" />
              <span>All day</span>
            </div>
          )}

          {/* Location */}
          {event.location && (
            <div className="flex items-center gap-1.5 mt-1 text-sm text-(--color-text-secondary)">
              <MapPin size={14} className="shrink-0" />
              <span className="truncate">{event.location}</span>
            </div>
          )}

          {/* People */}
          {event.people && event.people.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1 text-sm text-(--color-text-secondary)">
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
            <span className="flex items-center gap-1 text-xs text-blue-400">
              <Repeat size={10} />
              {event.recurrenceRule?.frequency}
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      {event.description && (
        <p className="mt-2 text-xs text-(--color-text-tertiary) line-clamp-2">{event.description}</p>
      )}

      {/* View source note */}
      {memory && (
        <button
          onClick={() => onViewMemory(memory)}
          className="mt-3 flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
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
}) => {
  const [previewMemoryId, setPreviewMemoryId] = useState<string | null>(null);

  const memoryMap = useMemo(
    () => new Map(memories.map(m => [m.id, m])),
    [memories]
  );

  const dateGroups = useMemo(() => groupEventsByDate(events), [events]);

  const previewMemory = previewMemoryId ? memoryMap.get(previewMemoryId) ?? null : null;

  const handleViewMemory = useCallback(
    (memory: Memory) => {
      setPreviewMemoryId(memory.id);
    },
    []
  );

  return (
    <div className={`${overlay.sheet}`}>
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
            <Calendar size={20} className="text-blue-400" />
            <h2 className="text-lg font-bold text-gray-100">Calendar</h2>
          </div>
        </div>
        <span className="text-sm text-gray-500">
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-8 text-center">
            <Calendar size={48} className="text-gray-700 mb-4" />
            <h3 className="text-lg font-semibold text-gray-400 mb-2">
              No events yet
            </h3>
            <p className="text-sm text-gray-500 max-w-xs">
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
                      {group.events.map((event) => (
                        <EventCard
                          key={event.id}
                          event={event}
                          memory={memoryMap.get(event.memoryId)}
                          isPast={group.isPast}
                          onViewMemory={handleViewMemory}
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

      {/* Memory Preview Modal */}
      {previewMemory && (
        <div
          className={overlay.previewBackdrop}
          onClick={() => setPreviewMemoryId(null)}
        >
          <div className="relative w-full max-w-lg max-h-[80vh] flex flex-col animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <div className="overflow-y-auto flex-1 min-h-0">
              <MemoryCard
                memory={previewMemory}
                isDialog={true}
                onViewAttachment={onViewAttachment}
                onDelete={onDelete}
                onEdit={onEdit}
                onTogglePin={onTogglePin}
              />
            </div>
            <button
              onClick={() => setPreviewMemoryId(null)}
              className={overlay.previewCloseBtn}
            >
              Close Preview
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarAgendaView;
