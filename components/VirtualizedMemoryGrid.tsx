import React, { useMemo, useEffect, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
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

function getColumnCount() {
  const w = window.innerWidth;
  if (w >= 1280) return 4;
  if (w >= 1024) return 3;
  if (w >= 640) return 2;
  return 1;
}

function useColumnCount() {
  const [cols, setCols] = useState(getColumnCount);
  useEffect(() => {
    const onResize = () => setCols(getColumnCount());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return cols;
}

const GAP = 24;
const ESTIMATED_ROW_HEIGHT = 380;

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
  const columnCount = useColumnCount();

  const rows = useMemo(() => {
    const result: Memory[][] = [];
    for (let i = 0; i < memories.length; i += columnCount) {
      result.push(memories.slice(i, i + columnCount));
    }
    return result;
  }, [memories, columnCount]);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ESTIMATED_ROW_HEIGHT + GAP,
    overscan: 3,
  });

  const items = virtualizer.getVirtualItems();

  return (
    <div
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        width: '100%',
        position: 'relative',
      }}
    >
      {items.map((virtualRow) => {
        const row = rows[virtualRow.index];
        return (
          <div
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <div
              className="grid gap-6"
              style={{
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                paddingBottom: `${GAP}px`,
              }}
            >
              {row.map((mem, colIdx) => (
                <MemoryCard
                  key={mem.id}
                  memory={mem}
                  index={virtualRow.index * columnCount + colIdx}
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
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(VirtualizedMemoryGrid);
