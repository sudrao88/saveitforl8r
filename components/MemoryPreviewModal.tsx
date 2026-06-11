/**
 * MemoryPreviewModal.tsx
 *
 * Shared modal for previewing a memory card in dialog mode.
 * Used by MomentSheet, ChatInterface, CalendarAgendaView, and TodoListView.
 */

import React, { useEffect, useRef } from 'react';
import { Memory, Attachment, CalendarEvent, TodoItem } from '../types';
import MemoryCard from './MemoryCard';
import { overlay } from '../styles/design-system';

interface MemoryPreviewModalProps {
  memory: Memory;
  onClose: () => void;
  onViewAttachment?: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onDelete?: (id: string) => void;
  onEdit?: (memory: Memory) => void;
  onTogglePin?: (id: string, isPinned: boolean) => void;
  calendarEvents?: CalendarEvent[];
  todoItems?: TodoItem[];
  onOpenCalendarEvent?: (eventId: string) => void;
  onOpenTodoItem?: (itemId: string) => void;
}

const MemoryPreviewModal: React.FC<MemoryPreviewModalProps> = ({
  memory,
  onClose,
  onViewAttachment,
  onDelete,
  onEdit,
  onTogglePin,
  calendarEvents,
  todoItems,
  onOpenCalendarEvent,
  onOpenTodoItem,
}) => {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div
      className={overlay.previewBackdrop}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg max-h-[80vh] flex flex-col animate-in zoom-in-95"
        onClick={e => e.stopPropagation()}
      >
        <div className="overflow-y-auto flex-1 min-h-0">
          <MemoryCard
            memory={memory}
            isDialog={true}
            onViewAttachment={onViewAttachment}
            onDelete={onDelete}
            onEdit={onEdit}
            onTogglePin={onTogglePin}
            calendarEvents={calendarEvents}
            todoItems={todoItems}
            onOpenCalendarEvent={onOpenCalendarEvent}
            onOpenTodoItem={onOpenTodoItem}
          />
        </div>
        <button
          onClick={onClose}
          className={overlay.previewCloseBtn}
        >
          Close Preview
        </button>
      </div>
    </div>
  );
};

export default MemoryPreviewModal;
