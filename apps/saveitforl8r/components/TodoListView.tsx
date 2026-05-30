/**
 * TodoListView.tsx
 *
 * Full-screen view showing action items extracted from notes.
 * Items are grouped by urgency: Overdue, Today, This Week, Later, No Deadline, Done.
 * Users can tap to toggle completion, dismiss unwanted items, or restore dismissed ones.
 */

import React, { useMemo, useCallback, useState } from 'react';
import { useBackButton } from '../hooks/useBackButton';
import {
  X,
  XCircle,
  CheckSquare,
  Square,
  CalendarDays,
  FileText,
  Circle,
  ChevronDown,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import { TodoItem, Memory, Attachment } from '../types';
import MemoryPreviewModal from './MemoryPreviewModal';
import { overlay } from '../styles/design-system';

interface TodoListViewProps {
  items: TodoItem[];
  memories: Memory[];
  pendingCount: number;
  onClose: () => void;
  onToggleComplete: (itemId: string) => void;
  onDismiss: (itemId: string) => void;
  onRestore: (itemId: string) => void;
  onViewAttachment?: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onDelete?: (id: string) => void;
  onEdit?: (memory: Memory) => void;
  onTogglePin?: (id: string, isPinned: boolean) => void;
}

interface TodoGroup {
  label: string;
  items: TodoItem[];
}

const getDateOnly = (isoString: string): string => {
  return isoString.split('T')[0];
};

const formatDeadline = (isoString: string): string => {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return isoString;
  }
};

const groupTodoItems = (items: TodoItem[]): { groups: TodoGroup[]; dismissed: TodoItem[] } => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + (6 - now.getDay()));
  const endOfWeekStr = endOfWeek.toISOString().split('T')[0];

  const groups: Record<string, TodoItem[]> = {
    overdue: [],
    today: [],
    thisWeek: [],
    later: [],
    noDeadline: [],
    done: [],
  };
  const dismissed: TodoItem[] = [];

  for (const item of items) {
    if (item.isDismissed) {
      dismissed.push(item);
      continue;
    }

    if (item.isCompleted) {
      groups.done.push(item);
      continue;
    }

    if (!item.deadline) {
      groups.noDeadline.push(item);
      continue;
    }

    const dateStr = getDateOnly(item.deadline);
    if (dateStr < today) {
      groups.overdue.push(item);
    } else if (dateStr === today) {
      groups.today.push(item);
    } else if (dateStr <= endOfWeekStr) {
      groups.thisWeek.push(item);
    } else {
      groups.later.push(item);
    }
  }

  const result: TodoGroup[] = [];
  if (groups.overdue.length > 0) result.push({ label: 'Overdue', items: groups.overdue });
  if (groups.today.length > 0) result.push({ label: 'Today', items: groups.today });
  if (groups.thisWeek.length > 0) result.push({ label: 'This Week', items: groups.thisWeek });
  if (groups.later.length > 0) result.push({ label: 'Later', items: groups.later });
  if (groups.noDeadline.length > 0) result.push({ label: 'No Deadline', items: groups.noDeadline });
  if (groups.done.length > 0) result.push({ label: 'Done', items: groups.done });

  return { groups: result, dismissed };
};

const groupLabelColors: Record<string, string> = {
  Overdue: 'text-(--color-danger)',
  Today: 'text-(--color-accent)',
  'This Week': 'text-(--color-text-secondary)',
  Later: 'text-(--color-text-secondary)',
  'No Deadline': 'text-(--color-text-secondary)',
  Done: 'text-(--color-text-tertiary)',
};

const priorityColors: Record<string, string> = {
  high: 'text-(--color-danger)',
  medium: 'text-(--color-warning)',
  low: 'text-(--color-text-secondary)',
};

const deadlineColor = (deadline: string): string => {
  const today = new Date().toISOString().split('T')[0];
  const dateStr = getDateOnly(deadline);
  if (dateStr < today) return 'text-(--color-danger)';
  if (dateStr === today) return 'text-(--color-warning)';
  return 'text-(--color-text-secondary)';
};

const TodoItemCard: React.FC<{
  item: TodoItem;
  memory?: Memory;
  onToggle: (itemId: string) => void;
  onDismiss: (itemId: string) => void;
  onViewMemory: (memory: Memory) => void;
}> = ({ item, memory, onToggle, onDismiss, onViewMemory }) => {
  return (
    <div
      className={`rounded-(--radius-xl) border p-4 transition-all duration-(--duration-fast) ${
        item.isCompleted
          ? 'border-(--color-border-subtle) bg-(--color-surface-raised)/30 opacity-60'
          : 'border-(--color-border-subtle) bg-(--color-surface-raised)/30 hover:bg-(--color-surface-raised)/50'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          onClick={() => onToggle(item.id)}
          className="mt-0.5 shrink-0 text-(--color-text-secondary) hover:text-(--color-success) transition-colors duration-(--duration-fast)"
        >
          {item.isCompleted ? (
            <CheckSquare size={20} className="text-(--color-success)" />
          ) : (
            <Square size={20} />
          )}
        </button>

        <div className="flex-1 min-w-0">
          {/* Title */}
          <h3
            className={`font-semibold text-base ${
              item.isCompleted
                ? 'text-(--color-text-secondary) line-through'
                : 'text-(--color-text-primary)'
            }`}
          >
            {item.title}
          </h3>

          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {/* Deadline */}
            {item.deadline && (
              <div className={`flex items-center gap-1 text-sm ${item.isCompleted ? 'text-(--color-text-tertiary)' : deadlineColor(item.deadline)}`}>
                <CalendarDays size={13} className="shrink-0" />
                <span>{formatDeadline(item.deadline)}</span>
              </div>
            )}

            {/* Priority */}
            {!item.isCompleted && (
              <div className={`flex items-center gap-1 text-xs ${priorityColors[item.priority] || priorityColors.medium}`}>
                <Circle size={6} fill="currentColor" />
                <span className="uppercase tracking-wider font-bold">{item.priority}</span>
              </div>
            )}
          </div>

          {/* Description */}
          {item.description && !item.isCompleted && (
            <p className="mt-1.5 text-xs text-(--color-text-secondary) line-clamp-2">{item.description}</p>
          )}

          {/* View source note */}
          {memory && (
            <button
              onClick={() => onViewMemory(memory)}
              className="mt-2 flex items-center gap-1.5 text-xs text-(--color-accent) hover:text-(--color-accent-hover) transition-colors duration-(--duration-fast)"
            >
              <FileText size={12} />
              View source note
            </button>
          )}
        </div>

        {/* Dismiss button — only on active (non-completed) items */}
        {!item.isCompleted && (
          <button
            onClick={() => onDismiss(item.id)}
            className="mt-0.5 shrink-0 text-(--color-text-tertiary) hover:text-(--color-danger) transition-colors duration-(--duration-fast)"
            title="Dismiss this item"
          >
            <XCircle size={18} />
          </button>
        )}
      </div>
    </div>
  );
};

const DismissedItemCard: React.FC<{
  item: TodoItem;
  onRestore: (itemId: string) => void;
}> = ({ item, onRestore }) => {
  return (
    <div className="rounded-(--radius-xl) border border-(--color-border-subtle) bg-(--color-surface-raised)/20 p-4 opacity-50">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base text-(--color-text-secondary) line-through">
            {item.title}
          </h3>
          {item.dismissedAt && (
            <p className="mt-1 text-xs text-(--color-text-tertiary)">
              Dismissed {new Date(item.dismissedAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </p>
          )}
        </div>
        <button
          onClick={() => onRestore(item.id)}
          className="shrink-0 flex items-center gap-1.5 text-xs text-(--color-accent) hover:text-(--color-accent-hover) transition-colors duration-(--duration-fast)"
          title="Restore this item"
        >
          <RotateCcw size={14} />
          Restore
        </button>
      </div>
    </div>
  );
};

const TodoListView: React.FC<TodoListViewProps> = ({
  items,
  memories,
  pendingCount,
  onClose,
  onToggleComplete,
  onDismiss,
  onRestore,
  onViewAttachment,
  onDelete,
  onEdit,
  onTogglePin,
}) => {
  const [previewMemoryId, setPreviewMemoryId] = useState<string | null>(null);
  const [dismissedExpanded, setDismissedExpanded] = useState(false);

  const memoryMap = useMemo(
    () => new Map(memories.map(m => [m.id, m])),
    [memories]
  );

  const { groups: todoGroups, dismissed: dismissedItems } = useMemo(
    () => groupTodoItems(items),
    [items]
  );

  const previewMemory = previewMemoryId ? memoryMap.get(previewMemoryId) ?? null : null;

  // Dismiss preview modal on Android back button
  useBackButton(() => setPreviewMemoryId(null), previewMemoryId !== null);

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
            <CheckSquare size={20} className="text-(--color-success)" />
            <h2 className="text-lg font-bold text-(--color-text-primary)">To Do</h2>
          </div>
        </div>
        <span className="text-sm text-(--color-text-secondary)">
          {pendingCount} pending
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-8 text-center">
            <CheckSquare size={48} className="text-(--color-text-tertiary) mb-4" />
            <h3 className="text-lg font-semibold text-(--color-text-secondary) mb-2">
              No action items yet
            </h3>
            <p className="text-sm text-(--color-text-secondary) max-w-xs">
              Your to-do list builds itself. Save a note with tasks or
              follow-ups and they&apos;ll appear here.
            </p>
          </div>
        ) : (
          <div className="px-4 py-4 pb-20 max-w-2xl mx-auto w-full space-y-6">
            {todoGroups.map((group) => (
              <section key={group.label}>
                <h3
                  className={`text-xs font-bold uppercase tracking-wider mb-3 ${
                    groupLabelColors[group.label] || 'text-(--color-text-secondary)'
                  }`}
                >
                  {group.label}
                  <span className="ml-2 text-(--color-text-tertiary)">{group.items.length}</span>
                </h3>
                <div className="space-y-3">
                  {group.items.map((item) => (
                    <TodoItemCard
                      key={item.id}
                      item={item}
                      memory={memoryMap.get(item.memoryId)}
                      onToggle={onToggleComplete}
                      onDismiss={onDismiss}
                      onViewMemory={handleViewMemory}
                    />
                  ))}
                </div>
              </section>
            ))}

            {/* Dismissed section — collapsible */}
            {dismissedItems.length > 0 && (
              <section>
                <button
                  onClick={() => setDismissedExpanded(prev => !prev)}
                  className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary) hover:text-(--color-text-secondary) transition-colors duration-(--duration-fast) mb-3"
                >
                  {dismissedExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Dismissed
                  <span className="ml-1 text-(--color-text-tertiary)">{dismissedItems.length}</span>
                </button>
                {dismissedExpanded && (
                  <div className="space-y-3">
                    {dismissedItems.map((item) => (
                      <DismissedItemCard
                        key={item.id}
                        item={item}
                        onRestore={onRestore}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>

      {/* Memory Preview Modal */}
      {previewMemory && (
        <MemoryPreviewModal
          memory={previewMemory}
          onClose={() => setPreviewMemoryId(null)}
          onViewAttachment={onViewAttachment}
          onDelete={onDelete}
          onEdit={onEdit}
          onTogglePin={onTogglePin}
        />
      )}
    </div>
  );
};

export default TodoListView;
