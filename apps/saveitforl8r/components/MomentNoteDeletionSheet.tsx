/**
 * MomentNoteDeletionSheet.tsx
 *
 * Full-screen sheet shown after the user picks "Delete moment and notes" in
 * the moment delete flow. Lists every note attached to the moment with all
 * notes pre-selected; the user deselects any they want to keep before
 * confirming. The moment is always deleted; only the selected notes are.
 *
 * Visual parity with DeletionCandidatesSheet (the cleanup screen).
 */

import React, { useState, useCallback } from 'react';
import { useBackButton } from '../hooks/useBackButton';
import {
  X,
  Trash2,
  AlertTriangle,
  CheckSquare,
  Square,
} from 'lucide-react';
import { Moment, Memory, Attachment } from '../types';
import MemoryCard from './MemoryCard';
import { overlay, btn } from '@l8r/shared/design-system';

interface MomentNoteDeletionSheetProps {
  moment: Moment;
  notes: Memory[];
  onCancel: () => void;
  onConfirm: (noteIdsToDelete: string[]) => void;
  onViewAttachment?: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onMemoryEdit?: (memory: Memory) => void;
  onMemoryTogglePin?: (id: string, isPinned: boolean) => void;
}

const getMemorySummary = (memory: Memory): string => {
  if (memory.enrichment?.summary) return memory.enrichment.summary;
  const text = memory.content.replace(/<[^>]*>/g, '').trim();
  return text.length > 100 ? text.slice(0, 100) + '…' : text;
};

const MomentNoteDeletionSheet: React.FC<MomentNoteDeletionSheetProps> = ({
  moment,
  notes,
  onCancel,
  onConfirm,
  onViewAttachment,
  onMemoryEdit,
  onMemoryTogglePin,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(notes.map(n => n.id)));
  const [showConfirm, setShowConfirm] = useState(false);
  const [previewMemoryId, setPreviewMemoryId] = useState<string | null>(null);

  const allSelected = selectedIds.size === notes.length && notes.length > 0;
  const noneSelected = selectedIds.size === 0;
  const noteCount = selectedIds.size;
  const noteLabel = noteCount === 1 ? 'note' : 'notes';

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
      setSelectedIds(new Set(notes.map(n => n.id)));
    }
  }, [allSelected, notes]);

  const handleConfirm = useCallback(() => {
    onConfirm(Array.from(selectedIds));
    setShowConfirm(false);
  }, [selectedIds, onConfirm]);

  useBackButton(() => setPreviewMemoryId(null), previewMemoryId !== null);
  useBackButton(() => setShowConfirm(false), showConfirm);

  const previewMemory = previewMemoryId ? notes.find(n => n.id === previewMemoryId) ?? null : null;

  const deleteButtonLabel = noneSelected
    ? 'Delete moment only'
    : `Delete moment & ${noteCount} ${noteLabel}`;

  return (
    <div className={overlay.sheetBase}>
      {/* Header */}
      <div className={overlay.sheetHeader}>
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onCancel} className={overlay.closeBtn}>
            <X size={24} />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <Trash2 size={20} className="text-(--color-danger) shrink-0" />
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-(--color-text-primary) truncate max-w-[200px] sm:max-w-md">
                Delete moment & notes
              </h2>
              <p className="text-xs text-(--color-text-secondary) truncate max-w-[200px] sm:max-w-md">
                {moment.title}
              </p>
            </div>
          </div>
        </div>
        <span className="text-sm text-(--color-text-secondary) shrink-0">
          {notes.length} {notes.length === 1 ? 'note' : 'notes'}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 pb-40 max-w-2xl mx-auto w-full space-y-3">
          {/* Intro hint */}
          <p className="text-sm text-(--color-text-secondary) mb-2">
            All notes are selected by default. Uncheck any you want to keep — only the
            selected notes will be deleted along with the moment.
          </p>

          {notes.length > 0 && (
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
          )}

          {notes.map(memory => {
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
                  <div className="mt-0.5 shrink-0">
                    {selected ? (
                      <CheckSquare size={20} className="text-(--color-accent)" />
                    ) : (
                      <Square size={20} className="text-(--color-text-tertiary)" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-(--color-text-primary) line-clamp-2">
                      {getMemorySummary(memory)}
                    </p>

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
      </div>

      {/* Footer action bar */}
      <div className="sticky bottom-0 px-4 py-4 border-t border-(--color-border-default) bg-(--color-surface-overlay)/95 backdrop-blur-xl pb-[max(1rem,var(--sab))]">
        <div className="max-w-2xl mx-auto flex gap-3 items-stretch">
          <button
            onClick={onCancel}
            className={`${btn.base} ${btn.ghost}`}
          >
            Cancel
          </button>
          <button
            onClick={() => setShowConfirm(true)}
            className={`${btn.base} ${btn.danger} flex-1 gap-2 whitespace-nowrap min-w-0`}
          >
            <Trash2 size={18} className="shrink-0" />
            <span className="truncate">{deleteButtonLabel}</span>
          </button>
        </div>
      </div>

      {/* Confirmation dialog */}
      {showConfirm && (
        <div
          className={overlay.dialogBackdrop}
          onClick={() => setShowConfirm(false)}
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
                {noneSelected
                  ? 'Delete moment?'
                  : `Delete moment & ${noteCount} ${noteLabel}?`}
              </h3>
              <p className="text-sm text-(--color-text-secondary)">
                {noneSelected
                  ? 'The moment will be removed. All notes will be kept. This action cannot be undone.'
                  : 'This action cannot be undone. The selected notes and their associated events and tasks will be permanently removed.'}
              </p>
              <div className="flex gap-3 w-full mt-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  className={`${btn.base} ${btn.secondary} flex-1`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  className={`${btn.base} ${btn.danger} flex-1`}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Memory preview modal */}
      {previewMemory && (
        <div
          className={overlay.previewBackdrop}
          onClick={() => setPreviewMemoryId(null)}
        >
          <div
            className="relative w-full max-w-lg max-h-[80vh] flex flex-col animate-in zoom-in-95"
            onClick={e => e.stopPropagation()}
          >
            <div className="overflow-y-auto flex-1 min-h-0">
              <MemoryCard
                memory={previewMemory}
                isDialog={true}
                onViewAttachment={onViewAttachment}
                onEdit={onMemoryEdit}
                onTogglePin={onMemoryTogglePin}
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

export default MomentNoteDeletionSheet;
