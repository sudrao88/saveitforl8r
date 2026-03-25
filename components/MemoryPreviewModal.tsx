/**
 * MemoryPreviewModal.tsx
 *
 * Shared modal for previewing a memory card in dialog mode.
 * Used by MomentSheet, ChatInterface, CalendarAgendaView, and TodoListView.
 */

import React, { useEffect } from 'react';
import { Memory, Attachment } from '../types';
import MemoryCard from './MemoryCard';
import { overlay } from '../styles/design-system';

interface MemoryPreviewModalProps {
  memory: Memory;
  onClose: () => void;
  onViewAttachment?: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onDelete?: (id: string) => void;
  onEdit?: (memory: Memory) => void;
  onTogglePin?: (id: string, isPinned: boolean) => void;
}

const MemoryPreviewModal: React.FC<MemoryPreviewModalProps> = ({
  memory,
  onClose,
  onViewAttachment,
  onDelete,
  onEdit,
  onTogglePin,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
