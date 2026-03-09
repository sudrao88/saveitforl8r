/**
 * CalendarAgendaView.tsx
 *
 * Full-screen agenda view showing calendar events extracted from notes.
 * Events are grouped by time period: Today, This Week, This Month, Later, Past.
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

interface CalendarAgendaViewProps {
  events: CalendarEvent[];
  memories: Memory[];
  onClose: () => void;
  onViewAttachment?: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onDelete?: (id: string) => void;
  onEdit?: (memory: Memory) => void;
  onTogglePin?: (id: string, isPinned: boolean) => void;
}

// Group events into time-based sections
interface EventGroup {
  label: string;
  events: CalendarEvent[];
}

const getDateOnly = (isoString: string): string => {
  // Handle both date-only "2026-06-15" and datetime "2026-06-15T16:00:00"
  return isoString.split('T')[0];
};

const formatDate = (isoString: string): string => {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoString;
  }
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

const groupEvents = (events: CalendarEvent[]): EventGroup[] => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Calculate end of week (Sunday)
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
  const endOfWeekStr = endOfWeek.toISOString().split('T')[0];

  // Calculate end of month
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const endOfMonthStr = endOfMonth.toISOString().split('T')[0];

  const groups: Record<string, CalendarEvent[]> = {
    today: [],
    thisWeek: [],
    thisMonth: [],
    later: [],
    past: [],
  };

  for (const event of events) {
    const dateStr = getDateOnly(event.startDate);

    if (dateStr < today) {
      groups.past.push(event);
    } else if (dateStr === today) {
      groups.today.push(event);
    } else if (dateStr <= endOfWeekStr) {
      groups.thisWeek.push(event);
    } else if (dateStr <= endOfMonthStr) {
      groups.thisMonth.push(event);
    } else {
      groups.later.push(event);
    }
  }

  const result: EventGroup[] = [];
  if (groups.today.length > 0) result.push({ label: 'Today', events: groups.today });
  if (groups.thisWeek.length > 0) result.push({ label: 'This Week', events: groups.thisWeek });
  if (groups.thisMonth.length > 0) result.push({ label: 'This Month', events: groups.thisMonth });
  if (groups.later.length > 0) result.push({ label: 'Later', events: groups.later });
  if (groups.past.length > 0) result.push({ label: 'Past', events: groups.past.reverse() });

  return result;
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
  const date = formatDate(event.startDate);

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        isPast
          ? 'border-gray-800/50 bg-gray-900/30 opacity-60'
          : event.status === 'cancelled'
            ? 'border-red-900/30 bg-red-950/20'
            : 'border-gray-700/50 bg-gray-800/30 hover:bg-gray-800/50'
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
                  ? 'text-gray-400'
                  : 'text-gray-100'
            }`}
          >
            {event.title}
          </h3>

          {/* Date & Time */}
          <div className="flex items-center gap-1.5 mt-1.5 text-sm text-gray-400">
            <CalendarDays size={14} className="shrink-0" />
            <span>{date}</span>
          </div>
          {!event.allDay && time && (
            <div className="flex items-center gap-1.5 mt-1 text-sm text-gray-400">
              <Clock size={14} className="shrink-0" />
              <span>
                {time}
                {endTime && ` – ${endTime}`}
              </span>
            </div>
          )}

          {/* Location */}
          {event.location && (
            <div className="flex items-center gap-1.5 mt-1 text-sm text-gray-400">
              <MapPin size={14} className="shrink-0" />
              <span className="truncate">{event.location}</span>
            </div>
          )}

          {/* People */}
          {event.people && event.people.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1 text-sm text-gray-400">
              <Users size={14} className="shrink-0" />
              <span className="truncate">{event.people.join(', ')}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {/* Status badge */}
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
              statusColors[event.status] || statusColors.confirmed
            }`}
          >
            {event.status}
          </span>
          {/* Recurrence indicator */}
          {event.recurringGroupId && (
            <span className="flex items-center gap-1 text-[10px] text-blue-400">
              <Repeat size={10} />
              {event.recurrenceRule?.frequency}
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      {event.description && (
        <p className="mt-2 text-xs text-gray-500 line-clamp-2">{event.description}</p>
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

  const eventGroups = useMemo(() => groupEvents(events), [events]);

  const previewMemory = previewMemoryId ? memoryMap.get(previewMemoryId) ?? null : null;

  const handleViewMemory = useCallback(
    (memory: Memory) => {
      setPreviewMemoryId(memory.id);
    },
    []
  );

  return (
    <div className="fixed inset-0 z-[100] bg-gray-950/95 backdrop-blur-md flex flex-col animate-in fade-in duration-300">
      {/* Header */}
      <div className="sticky top-0 z-10 px-4 py-3 border-b border-gray-800 flex items-center justify-between bg-gray-950/80 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-3 -ml-3 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white transition-colors active:scale-95"
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
          <div className="px-4 py-4 pb-20 max-w-2xl mx-auto w-full space-y-6">
            {eventGroups.map((group) => (
              <section key={group.label}>
                <h3
                  className={`text-xs font-bold uppercase tracking-wider mb-3 ${
                    group.label === 'Today'
                      ? 'text-blue-400'
                      : group.label === 'Past'
                        ? 'text-gray-600'
                        : 'text-gray-400'
                  }`}
                >
                  {group.label}
                </h3>
                <div className="space-y-3">
                  {group.events.map((event) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      memory={memoryMap.get(event.memoryId)}
                      isPast={group.label === 'Past'}
                      onViewMemory={handleViewMemory}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Memory Preview Modal */}
      {previewMemory && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
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
              className="mt-4 w-full py-3 bg-gray-800 text-white rounded-xl font-bold shadow-xl border border-gray-700 text-sm active:scale-95 shrink-0"
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
