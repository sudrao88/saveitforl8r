/**
 * DeletionCandidatesSheet.tsx
 *
 * Full-screen sheet showing memories that are candidates for deletion
 * because all their calendar events are past and all todo items are completed.
 * Users can select candidates to delete or dismiss them from future suggestions.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useBackButton } from '../hooks/useBackButton';
import {
  X,
  Trash2,
  AlertTriangle,
  CheckSquare,
  Square,
  Calendar,
  CheckCircle2,
  EyeOff,
} from 'lucide-react';
import { Memory, CalendarEvent, TodoItem, Attachment } from '../types';
import MemoryCard from './MemoryCard';
import { overlay, btn } from '../styles/design-system';

interface DeletionCandidatesSheetProps {
  candidates: Memory[];
  calendarEvents: CalendarEvent[];
  todoItems: TodoItem[];
  onClose: () => void;
  onDelete: (id: string) => void;
  onDismiss: (id: string) => void;
  onViewAttachment?: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onEdit?: (memory: Memory) => void;
  onTogglePin?: (id: string, isPinned: boolean) => void;
}

type ConfirmMode = 'delete' | 'dismiss' | null;

const getMemorySummary = (memory: Memory): string => {
  if (memory.enrichment?.summary) return memory.enrichment.summary;
  // Strip HTML tags for plain-text preview
  const text = memory.content.replace(/<[^>]*>/g, '').trim();
  return text.length > 100 ? text.slice(0, 100) + '…' : text;
};

const DeletionCandidatesSheet: React.FC<DeletionCandidatesSheetProps> = ({
  candidates,
  calendarEvents,
  todoItems,
  onClose,
  onDelete,
  onDismiss,
  onViewAttachment,
  onEdit,
  onTogglePin,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(candidates.map(c => c.id)));
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null);
  const [previewMemoryId, setPreviewMemoryId] = useState<string | null>(null);

  // Stats per memory
  const statsMap = useMemo(() => {
    const eventsByMemoryId = new Map<string, CalendarEvent[]>();
    for (const event of calendarEvents) {
      if (event.isDeleted) continue;
      const list = eventsByMemoryId.get(event.memoryId) || [];
      list.push(event);
      eventsByMemoryId.set(event.memoryId, list);
    }

    const todosByMemoryId = new Map<string, TodoItem[]>();
    for (const todo of todoItems) {
      if (todo.isDeleted || todo.isDismissed) continue;
      const list = todosByMemoryId.get(todo.memoryId) || [];
      list.push(todo);
      todosByMemoryId.set(todo.memoryId, list);
    }

    const map = new Map<string, { pastEvents: number; completedTodos: number }>();
    for (const c of candidates) {
      const events = eventsByMemoryId.get(c.id) || [];
      const todos = todosByMemoryId.get(c.id) || [];
      map.set(c.id, {
        pastEvents: events.length,
        completedTodos: todos.length,
      });
    }
    return map;
  }, [candidates, calendarEvents, todoItems]);

  const allSelected = selectedIds.size === candidates.length && candidates.length > 0;
  const noneSelected = selectedIds.size === 0;

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(candidates.map(c => c.id)));
    }
  }, [allSelected, candidates]);

  const handleConfirmDelete = useCallback(() => {
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      onDelete(id);
    }
    setSelectedIds(new Set());
    setConfirmMode(null);
    if (ids.length === candidates.length) {
      onClose();
    }
  }, [selectedIds, onDelete, candidates.length, onClose]);

  const handleConfirmDismiss = useCallback(() => {
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      onDismiss(id);
    }
    setSelectedIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
    setConfirmMode(null);
  }, [selectedIds, onDismiss]);

  // Dismiss nested dialogs on Android back button (before the sheet itself closes)
  useBackButton(() => setPreviewMemoryId(null), previewMemoryId !== null);
  useBackButton(() => setConfirmMode(null), confirmMode !== null);

  const previewMemory = previewMemoryId ? candidates.find(c => c.id === previewMemoryId) ?? null : null;

  return (
    <div className={overlay.sheet}>
      {/* Header */}
      <div className={overlay.sheetHeader}>
        <div className="flex items-center gap-3">
          <button onClick={onClose} className={overlay.closeBtn}>
            <X size={24} />
          </button>
          <div className="flex items-center gap-2">
            <Trash2 size={20} className="text-(--color-danger)" />
            <h2 className="text-lg font-bold text-(--color-text-primary)">Stale Notes</h2>
          </div>
        </div>
        <span className="text-sm text-(--color-text-secondary)">
          {candidates.length} note{candidates.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {candidates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-8 text-center">
            <Trash2 size={48} className="text-(--color-text-tertiary) mb-4" />
            <h3 className="text-lg font-semibold text-(--color-text-secondary) mb-2">
              All caught up
            </h3>
            <p className="text-sm text-(--color-text-secondary) max-w-xs">
              No stale notes to clean up right now.
            </p>
          </div>
        ) : (
          <div className="px-4 py-4 pb-40 max-w-2xl mx-auto w-full space-y-3">
            {/* Select all toggle */}
            <button
              onClick={toggleAll}
              className="flex items-center gap-2 text-sm text-(--color-text-secondary) hover:text-(--color-text-primary) transition-colors duration-(--duration-fast) mb-2"
            >
              {allSelected ? (
                <CheckSquare size={18} className="text-(--color-accent)" />
              ) : (
                <Square size={18} />
              )}
              <span className="font-medium">
                {allSelected ? 'Deselect all' : 'Select all'}
              </span>
            </button>

            {/* Candidate list */}
            {candidates.map(memory => {
              const stats = statsMap.get(memory.id);
              const selected = selectedIds.has(memory.id);
              return (
                <div
                  key={memory.id}
                  className={`rounded-(--radius-xl) border p-4 transition-all duration-(--duration-fast) cursor-pointer ${
                    selected
                      ? 'border-(--color-accent)/50 bg-(--color-accent-muted)'
                      : 'border-(--color-border-subtle) bg-(--color-surface-raised)/30 hover:bg-(--color-surface-raised)/50'
                  }`}
                  onClick={() => toggleSelect(memory.id)}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <div className="mt-0.5 shrink-0">
                      {selected ? (
                        <CheckSquare size={20} className="text-(--color-accent)" />
                      ) : (
                        <Square size={20} className="text-(--color-text-tertiary)" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Summary */}
                      <p className="text-sm text-(--color-text-primary) line-clamp-2">
                        {getMemorySummary(memory)}
                      </p>

                      {/* Stats */}
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        {stats && stats.pastEvents > 0 && (
                          <div className="flex items-center gap-1 text-xs text-(--color-text-tertiary)">
                            <Calendar size={12} />
                            <span>{stats.pastEvents} past event{stats.pastEvents !== 1 ? 's' : ''}</span>
                          </div>
                        )}
                        {stats && stats.completedTodos > 0 && (
                          <div className="flex items-center gap-1 text-xs text-(--color-text-tertiary)">
                            <CheckCircle2 size={12} />
                            <span>{stats.completedTodos} completed</span>
                          </div>
                        )}
                      </div>

                      {/* View source note */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewMemoryId(memory.id);
                        }}
                        className="mt-2 text-xs text-(--color-accent) hover:text-(--color-accent-hover) transition-colors duration-(--duration-fast)"
                      >
                        View note
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer action bar */}
      {candidates.length > 0 && (
        <div className="sticky bottom-0 px-4 py-4 border-t border-(--color-border-default) bg-(--color-surface-overlay)/95 backdrop-blur-xl pb-[max(1rem,var(--sab))]">
          <div className="max-w-2xl mx-auto flex gap-3">
            <button
              onClick={() => setConfirmMode('dismiss')}
              disabled={noneSelected}
              className={`${btn.base} ${btn.ghost} flex-1 gap-2`}
            >
              <EyeOff size={16} />
              Dismiss ({selectedIds.size})
            </button>
            <button
              onClick={() => setConfirmMode('delete')}
              disabled={noneSelected}
              className={`${btn.base} ${btn.danger} flex-1 gap-2`}
            >
              <Trash2 size={16} />
              Delete ({selectedIds.size})
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {confirmMode === 'delete' && (
        <div
          className={overlay.dialogBackdrop}
          onClick={() => setConfirmMode(null)}
        >
          <div
            className={`${overlay.modal} p-6 mx-4 max-w-sm w-full animate-in zoom-in-95 fade-in duration-(--duration-normal)`}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-(--color-danger)/30 flex items-center justify-center">
                <AlertTriangle size={24} className="text-(--color-danger)" />
              </div>
              <h3 className="text-lg font-bold text-(--color-text-primary)">
                Delete {selectedIds.size} {selectedIds.size === 1 ? 'Memory' : 'Memories'}?
              </h3>
              <p className="text-sm text-(--color-text-secondary)">
                This action cannot be undone. The selected notes and their associated events and tasks will be permanently removed.
              </p>
              <div className="flex gap-3 w-full mt-2">
                <button
                  onClick={() => setConfirmMode(null)}
                  className={`${btn.base} ${btn.secondary} flex-1`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className={`${btn.base} ${btn.danger} flex-1`}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dismiss Confirmation Dialog */}
      {confirmMode === 'dismiss' && (
        <div
          className={overlay.dialogBackdrop}
          onClick={() => setConfirmMode(null)}
        >
          <div
            className={`${overlay.modal} p-6 mx-4 max-w-sm w-full animate-in zoom-in-95 fade-in duration-(--duration-normal)`}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-(--color-warning)/30 flex items-center justify-center">
                <EyeOff size={24} className="text-(--color-warning)" />
              </div>
              <h3 className="text-lg font-bold text-(--color-text-primary)">
                Dismiss {selectedIds.size} {selectedIds.size === 1 ? 'Note' : 'Notes'}?
              </h3>
              <p className="text-sm text-(--color-text-secondary)">
                Dismissed notes won&apos;t be suggested for deletion again. You can still delete them manually from their note cards.
              </p>
              <div className="flex gap-3 w-full mt-2">
                <button
                  onClick={() => setConfirmMode(null)}
                  className={`${btn.base} ${btn.secondary} flex-1`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDismiss}
                  className={`${btn.base} ${btn.primary} flex-1`}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

export default DeletionCandidatesSheet;
