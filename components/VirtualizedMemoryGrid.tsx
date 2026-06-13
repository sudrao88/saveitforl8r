import React from 'react';
import MemoryCard from './MemoryCard';
import { Memory, Attachment, UploadProgress, CalendarEvent, TodoItem } from '../types';
import type { RelatedMemoryDisplayItem } from '../hooks/useRelatedMemories';

interface VirtualizedMemoryGridProps {
  memories: Memory[];
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onUpdate: (id: string, content: string) => void;
  onExpand: (memory: Memory) => void;
  onViewAttachment: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onTogglePin: (id: string, isPinned: boolean) => void;
  onEdit: (memory: Memory) => void;
  isAuthenticated: boolean;
  onSignIn: () => void;
  syncStatusMap?: Map<string, 'syncing' | 'synced' | 'error'>;
  onSyncRetry?: (id: string) => void;
  uploadProgressMap?: Map<string, UploadProgress>;
  highlightedMemoryId?: string | null;
  eventsByMemory?: Map<string, CalendarEvent[]>;
  todosByMemory?: Map<string, TodoItem[]>;
  onOpenCalendarEvent?: (eventId: string) => void;
  onOpenTodoItem?: (itemId: string) => void;
  relatedByMemory?: Map<string, RelatedMemoryDisplayItem[]>;
  onOpenRelatedMemory?: (memoryId: string) => void;
}

const VirtualizedMemoryGrid: React.FC<VirtualizedMemoryGridProps> = ({
  memories,
  onDelete,
  onRetry,
  onUpdate,
  onExpand,
  onViewAttachment,
  onTogglePin,
  onEdit,
  isAuthenticated,
  onSignIn,
  syncStatusMap,
  onSyncRetry,
  uploadProgressMap,
  highlightedMemoryId,
  eventsByMemory,
  todosByMemory,
  onOpenCalendarEvent,
  onOpenTodoItem,
  relatedByMemory,
  onOpenRelatedMemory,
}) => {
  return (
    <div
      className="grid gap-6"
      style={{
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))',
      }}
    >
      {memories.map((mem, index) => {
        const isHighlighted = highlightedMemoryId === mem.id;
        return (
        <div
          key={mem.id}
          data-memory-id={mem.id}
          className={`[content-visibility:auto] [contain-intrinsic-size:auto_400px] grid scroll-mt-32 rounded-(--radius-xl) transition-shadow duration-(--duration-slow) ${isHighlighted ? 'ring-2 ring-(--color-accent) ring-offset-2 ring-offset-(--color-surface-base)' : ''}`}
        >
          <MemoryCard
            memory={mem}
            index={index}
            onDelete={onDelete}
            onRetry={onRetry}
            onUpdate={onUpdate}
            onExpand={onExpand}
            onViewAttachment={onViewAttachment}
            onTogglePin={onTogglePin}
            onEdit={onEdit}
            isAuthenticated={isAuthenticated}
            onSignIn={onSignIn}
            syncStatus={syncStatusMap?.get(mem.id)}
            onSyncRetry={onSyncRetry}
            uploadProgress={uploadProgressMap?.get(mem.id)}
            calendarEvents={eventsByMemory?.get(mem.id)}
            todoItems={todosByMemory?.get(mem.id)}
            onOpenCalendarEvent={onOpenCalendarEvent}
            onOpenTodoItem={onOpenTodoItem}
            relatedMemories={relatedByMemory?.get(mem.id)}
            onOpenRelatedMemory={onOpenRelatedMemory}
          />
        </div>
        );
      })}
    </div>
  );
};

export default React.memo(VirtualizedMemoryGrid);
