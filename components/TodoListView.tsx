/**
 * TodoListView.tsx
 *
 * Full-screen view showing action items extracted from notes.
 * Items are grouped by urgency: Overdue, Today, This Week, Later, No Deadline, Done.
 * Users can tap to toggle completion and view the source note.
 */

import React, { useMemo, useCallback, useState } from 'react';
import {
  X,
  CheckSquare,
  Square,
  CalendarDays,
  FileText,
  Circle,
} from 'lucide-react';
import { TodoItem, Memory, Attachment } from '../types';
import MemoryCard from './MemoryCard';
import { overlay } from '../styles/design-system';

interface TodoListViewProps {
  items: TodoItem[];
  memories: Memory[];
  onClose: () => void;
  onToggleComplete: (itemId: string) => void;
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

const groupTodoItems = (items: TodoItem[]): TodoGroup[] => {
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

  for (const item of items) {
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

  return result;
};

const groupLabelColors: Record<string, string> = {
  Overdue: 'text-red-400',
  Today: 'text-blue-400',
  'This Week': 'text-gray-400',
  Later: 'text-gray-400',
  'No Deadline': 'text-gray-500',
  Done: 'text-gray-600',
};

const priorityColors: Record<string, string> = {
  high: 'text-red-400',
  medium: 'text-amber-400',
  low: 'text-gray-500',
};

const deadlineColor = (deadline: string): string => {
  const today = new Date().toISOString().split('T')[0];
  const dateStr = getDateOnly(deadline);
  if (dateStr < today) return 'text-red-400';
  if (dateStr === today) return 'text-amber-400';
  return 'text-gray-500';
};

const TodoItemCard: React.FC<{
  item: TodoItem;
  memory?: Memory;
  onToggle: (itemId: string) => void;
  onViewMemory: (memory: Memory) => void;
}> = ({ item, memory, onToggle, onViewMemory }) => {
  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        item.isCompleted
          ? 'border-gray-800/50 bg-gray-900/30 opacity-60'
          : 'border-gray-700/50 bg-gray-800/30 hover:bg-gray-800/50'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          onClick={() => onToggle(item.id)}
          className="mt-0.5 shrink-0 text-gray-400 hover:text-green-400 transition-colors"
        >
          {item.isCompleted ? (
            <CheckSquare size={20} className="text-green-400" />
          ) : (
            <Square size={20} />
          )}
        </button>

        <div className="flex-1 min-w-0">
          {/* Title */}
          <h3
            className={`font-semibold text-base ${
              item.isCompleted
                ? 'text-gray-500 line-through'
                : 'text-gray-100'
            }`}
          >
            {item.title}
          </h3>

          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {/* Deadline */}
            {item.deadline && (
              <div className={`flex items-center gap-1 text-sm ${item.isCompleted ? 'text-gray-600' : deadlineColor(item.deadline)}`}>
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
            <p className="mt-1.5 text-xs text-gray-500 line-clamp-2">{item.description}</p>
          )}

          {/* View source note */}
          {memory && (
            <button
              onClick={() => onViewMemory(memory)}
              className="mt-2 flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <FileText size={12} />
              View source note
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const TodoListView: React.FC<TodoListViewProps> = ({
  items,
  memories,
  onClose,
  onToggleComplete,
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

  const todoGroups = useMemo(() => groupTodoItems(items), [items]);

  const pendingCount = useMemo(
    () => items.filter(item => !item.isCompleted).length,
    [items]
  );

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
            <CheckSquare size={20} className="text-green-400" />
            <h2 className="text-lg font-bold text-gray-100">To Do</h2>
          </div>
        </div>
        <span className="text-sm text-gray-500">
          {pendingCount} pending
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-8 text-center">
            <CheckSquare size={48} className="text-gray-700 mb-4" />
            <h3 className="text-lg font-semibold text-gray-400 mb-2">
              No action items yet
            </h3>
            <p className="text-sm text-gray-500 max-w-xs">
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
                    groupLabelColors[group.label] || 'text-gray-400'
                  }`}
                >
                  {group.label}
                  <span className="ml-2 text-gray-600">{group.items.length}</span>
                </h3>
                <div className="space-y-3">
                  {group.items.map((item) => (
                    <TodoItemCard
                      key={item.id}
                      item={item}
                      memory={memoryMap.get(item.memoryId)}
                      onToggle={onToggleComplete}
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

export default TodoListView;
