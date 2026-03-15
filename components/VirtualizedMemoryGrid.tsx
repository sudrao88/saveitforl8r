import React from 'react';
import MemoryCard from './MemoryCard';
import { Memory, Attachment } from '../types';

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
}) => {
  return (
    <div
      className="grid gap-6"
      style={{
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))',
      }}
    >
      {memories.map((mem, index) => (
        <div
          key={mem.id}
          className="[content-visibility:auto] [contain-intrinsic-size:auto_400px]"
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
          />
        </div>
      ))}
    </div>
  );
};

export default React.memo(VirtualizedMemoryGrid);
