/**
 * EventEditDialog.tsx
 *
 * Modal dialog for editing a single calendar event. For an occurrence of a
 * recurring series, edits apply to that occurrence only — the rest of the
 * series is left untouched (the occurrence is marked as modified so horizon
 * expansion won't overwrite or duplicate it).
 */

import React, { useState, useCallback } from 'react';
import { X, Loader2, Pencil, Repeat } from 'lucide-react';
import { CalendarEvent } from '../types';
import { btn, input, overlay } from '../styles/design-system';

interface EventEditDialogProps {
  event: CalendarEvent;
  onClose: () => void;
  /** Persist the changes. The dialog closes itself once this resolves. */
  onSave: (changes: Partial<CalendarEvent>) => Promise<void> | void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalDateStr = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Date-only strings are treated as local midnight so deltas between date-only
// and timed values stay consistent.
const parseLocal = (iso: string) => new Date(iso.includes('T') ? iso : iso + 'T00:00:00');

/**
 * Shift the event's end by the same offset the start moved, preserving the
 * original duration. Returns the old end unchanged if anything fails to parse.
 */
const shiftEnd = (oldStart: string, newStart: string, oldEnd: string, newAllDay: boolean): string => {
  const deltaMs = parseLocal(newStart).getTime() - parseLocal(oldStart).getTime();
  const shifted = new Date(parseLocal(oldEnd).getTime() + deltaMs);
  if (isNaN(deltaMs) || isNaN(shifted.getTime())) return oldEnd;
  const dateStr = toLocalDateStr(shifted);
  if (newAllDay || !oldEnd.includes('T')) return dateStr;
  return `${dateStr}T${pad(shifted.getHours())}:${pad(shifted.getMinutes())}:00`;
};

const STATUS_OPTIONS: CalendarEvent['status'][] = ['confirmed', 'tentative', 'cancelled'];

const EventEditDialog: React.FC<EventEditDialogProps> = ({ event, onClose, onSave }) => {
  const tIdx = event.startDate.indexOf('T');
  const [title, setTitle] = useState(event.title);
  const [date, setDate] = useState(event.startDate.split('T')[0]);
  const [time, setTime] = useState(tIdx >= 0 ? event.startDate.substring(tIdx + 1, tIdx + 6) : '09:00');
  const [allDay, setAllDay] = useState(event.allDay);
  const [location, setLocation] = useState(event.location ?? '');
  const [status, setStatus] = useState<CalendarEvent['status']>(event.status);
  const [saving, setSaving] = useState(false);

  const canSave = title.trim().length > 0 && date.length > 0 && (allDay || time.length > 0);

  const handleSave = useCallback(async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const newStart = allDay ? date : `${date}T${time}:00`;
      const changes: Partial<CalendarEvent> = {
        title: title.trim(),
        startDate: newStart,
        allDay,
        location: location.trim() || undefined,
        status,
      };
      if (event.endDate) {
        changes.endDate = shiftEnd(event.startDate, newStart, event.endDate, allDay);
      }
      await onSave(changes);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [canSave, saving, allDay, date, time, title, location, status, event, onSave, onClose]);

  return (
    <div className={overlay.dialogBackdrop}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-(--color-surface-base)/60 backdrop-blur-sm animate-in fade-in duration-(--duration-fast)"
        onClick={saving ? undefined : onClose}
      />

      {/* Dialog */}
      <div className={`relative w-full max-w-lg mx-4 mb-4 sm:mb-0 ${overlay.modal} ${overlay.modalEnter}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-(--color-border-default)">
          <div className="flex items-center gap-2">
            <Pencil size={18} className="text-(--color-accent)" />
            <h3 className="text-base font-bold text-(--color-text-primary)">Edit event</h3>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className={`${overlay.closeBtnRight} disabled:opacity-50`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {event.recurringGroupId && (
            <div className="flex items-start gap-2 text-xs text-(--color-text-secondary) bg-(--color-accent-muted) border border-(--color-accent)/30 rounded-(--radius-lg) px-3 py-2">
              <Repeat size={14} className="text-(--color-accent) shrink-0 mt-0.5" />
              <span>
                This is a {event.recurrenceRule?.frequency ?? 'repeating'} event. Your changes
                apply to this occurrence only — the rest of the series won&apos;t change.
              </span>
            </div>
          )}

          <div>
            <label className="block text-sm text-(--color-text-secondary) mb-1.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={saving}
              className={input.base}
              maxLength={300}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm text-(--color-text-secondary) mb-1.5">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                disabled={saving}
                className={input.base}
                style={{ colorScheme: 'dark' }}
              />
            </div>
            {!allDay && (
              <div className="flex-1">
                <label className="block text-sm text-(--color-text-secondary) mb-1.5">Time</label>
                <input
                  type="time"
                  value={time}
                  onChange={e => setTime(e.target.value)}
                  disabled={saving}
                  className={input.base}
                  style={{ colorScheme: 'dark' }}
                />
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-(--color-text-secondary)">
            <input
              type="checkbox"
              checked={allDay}
              onChange={e => setAllDay(e.target.checked)}
              disabled={saving}
              className="w-4 h-4 accent-(--color-accent)"
            />
            All day
          </label>

          <div>
            <label className="block text-sm text-(--color-text-secondary) mb-1.5">Location</label>
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="Optional"
              disabled={saving}
              className={input.base}
              maxLength={300}
            />
          </div>

          <div>
            <label className="block text-sm text-(--color-text-secondary) mb-1.5">Status</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as CalendarEvent['status'])}
              disabled={saving}
              className={input.base}
            >
              {STATUS_OPTIONS.map(opt => (
                <option key={opt} value={opt}>
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-(--color-border-default) flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className={`${btn.base} ${btn.ghost} text-sm`}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className={`${btn.base} ${btn.primary} px-5 py-2 text-sm flex items-center gap-2 disabled:cursor-not-allowed`}
          >
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EventEditDialog;
