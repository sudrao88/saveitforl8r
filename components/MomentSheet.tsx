/**
 * MomentSheet.tsx
 *
 * Full-screen sheet for one moment: its terms, and every note that matches
 * them, best match first. Matches are computed locally (useMoments) and update
 * live as notes change. Notes can be opened in a preview or hidden from this
 * moment. A moment can't be edited — delete it and create a new one.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useBackButton } from '../hooks/useBackButton';
import { X, Trash2, EyeOff, CloudOff, Loader2, RefreshCw } from 'lucide-react';
import { Moment, Memory, Attachment } from '../types';
import MemoryPreviewModal from './MemoryPreviewModal';
import MomentNoteDeletionSheet from './MomentNoteDeletionSheet';
import { FALLBACK_MOMENT_EMOJI } from './MomentBubble';
import { overlay, btn, chip, card, text } from '../styles/design-system';
import { canMatchMoment, MomentMatch } from '../utils/momentMatching';

type DeleteConfirmStep = 'choose' | 'confirm-notes';

interface MomentSheetProps {
  moment: Moment;
  memories: Memory[];
  matches: MomentMatch[];
  isEmbedding: boolean;
  onClose: () => void;
  onDelete: (momentId: string) => Promise<void>;
  onHideNote: (momentId: string, noteId: string) => Promise<void>;
  onRetryEmbedding: (momentId: string) => Promise<void>;
  onDeleteNotes?: (noteIds: string[]) => void;
  onViewAttachment?: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onMemoryDelete?: (id: string) => void;
  onMemoryEdit?: (memory: Memory) => void;
  onMemoryUpdate?: (id: string, content: string) => void;
  onMemoryTogglePin?: (id: string, isPinned: boolean) => void;
}

const plainText = (html: string): string =>
  (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// Best human-readable label for a note: AI entity title, then summary, then
// the note content itself.
const noteTitle = (m: Memory): string =>
  m.enrichment?.entityContext?.title || m.enrichment?.summary || plainText(m.content) || 'Untitled note';

// Secondary line: the summary when the title came from the entity, otherwise
// the note content.
const noteSnippet = (m: Memory): string => {
  if (m.enrichment?.entityContext?.title && m.enrichment.summary) return m.enrichment.summary;
  const content = plainText(m.content);
  return content === noteTitle(m) ? '' : content;
};

const formatDate = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const MomentSheet: React.FC<MomentSheetProps> = ({
  moment,
  memories,
  matches,
  isEmbedding,
  onClose,
  onDelete,
  onHideNote,
  onRetryEmbedding,
  onDeleteNotes,
  onViewAttachment,
  onMemoryDelete,
  onMemoryEdit,
  onMemoryUpdate,
  onMemoryTogglePin,
}) => {
  const [previewMemoryId, setPreviewMemoryId] = useState<string | null>(null);
  const [deleteConfirmStep, setDeleteConfirmStep] = useState<DeleteConfirmStep | null>(null);

  const memoriesMap = useMemo(() => new Map(memories.map(m => [m.id, m])), [memories]);

  // Matched notes in rank order (matches only ever reference live notes, but
  // guard against a stale id between renders).
  const notes = useMemo(() => {
    const out: Memory[] = [];
    for (const match of matches) {
      const m = memoriesMap.get(match.id);
      if (m && !m.isDeleted) out.push(m);
    }
    return out;
  }, [matches, memoriesMap]);

  // Words each note matched on (hybrid moments), shown under its date.
  const matchedById = useMemo(
    () => new Map(matches.filter(m => m.matched?.length).map(m => [m.id, m.matched!])),
    [matches],
  );

  const previewMemory = previewMemoryId ? memoriesMap.get(previewMemoryId) : undefined;
  const embedded = canMatchMoment(moment);
  const noteCount = notes.length;
  const noteLabel = noteCount === 1 ? 'note' : 'notes';
  const hiddenCount = moment.excludedNoteIds?.length ?? 0;

  // Dismiss nested dialogs on Android back button
  useBackButton(() => setPreviewMemoryId(null), previewMemoryId !== null);
  useBackButton(() => setDeleteConfirmStep(null), deleteConfirmStep !== null);

  const handleDeleteClick = useCallback(() => {
    if (noteCount > 0 && onDeleteNotes) {
      setDeleteConfirmStep('choose');
    } else {
      onDelete(moment.id);
      onClose();
    }
  }, [moment.id, noteCount, onDelete, onDeleteNotes, onClose]);

  const handleDeleteMomentOnly = useCallback(() => {
    onDelete(moment.id);
    setDeleteConfirmStep(null);
    onClose();
  }, [moment.id, onDelete, onClose]);

  const handleDeleteWithNotes = useCallback((noteIdsToDelete: string[]) => {
    onDelete(moment.id);
    if (noteIdsToDelete.length > 0) {
      onDeleteNotes?.(noteIdsToDelete);
    }
    setDeleteConfirmStep(null);
    onClose();
  }, [moment.id, onDelete, onDeleteNotes, onClose]);

  return (
    <div className={overlay.sheetBase}>
      <div className={overlay.sheetHeader}>
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onClose} className={overlay.closeBtn}>
            <X size={24} />
          </button>
          <span className="text-2xl shrink-0" role="img" aria-hidden="true">
            {moment.emoji || FALLBACK_MOMENT_EMOJI}
          </span>
          <h2 className="text-lg font-bold text-(--color-text-primary) truncate min-w-0">
            {moment.title}
          </h2>
        </div>
        {embedded && (
          <span className="text-xs text-(--color-text-tertiary) shrink-0">
            {noteCount} {noteLabel}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 sm:p-8 pb-32">
          {/* Terms */}
          <div className="flex flex-wrap gap-2 mb-6">
            {moment.terms.map(term => (
              <span key={term} className={`${chip.base} ${chip.inactive} max-w-full`}>
                <span className="truncate">{term}</span>
              </span>
            ))}
          </div>

          {!embedded ? (
            <div className="text-center py-16 px-6">
              {isEmbedding ? (
                <Loader2 size={32} className="animate-spin text-(--color-accent) mx-auto mb-4" />
              ) : (
                <CloudOff size={32} className="text-(--color-warning) mx-auto mb-4" />
              )}
              <h3 className="text-lg font-bold text-(--color-text-primary) mb-2">
                {isEmbedding ? 'Setting up this moment…' : 'Waiting for a connection'}
              </h3>
              <p className={`${text.body} mb-4`}>
                {isEmbedding
                  ? 'Matching notes will appear in a moment.'
                  : 'This moment will fill in with matching notes as soon as you’re back online.'}
              </p>
              {!isEmbedding && (
                <button
                  onClick={() => onRetryEmbedding(moment.id)}
                  className={`${btn.outlinedSm} mx-auto`}
                >
                  <RefreshCw size={14} />
                  Try again
                </button>
              )}
            </div>
          ) : noteCount === 0 ? (
            <div className="text-center py-16 px-6">
              <h3 className="text-lg font-bold text-(--color-text-primary) mb-2">No matching notes yet</h3>
              <p className={text.body}>
                Notes you save that relate to these terms will show up here automatically.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {notes.map(memory => {
                const snippet = noteSnippet(memory);
                return (
                  <li key={memory.id} className={`${card.base} flex items-start gap-2 p-3`}>
                    <button
                      onClick={() => setPreviewMemoryId(memory.id)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <p className="text-sm font-medium text-(--color-text-primary) line-clamp-2">
                        {noteTitle(memory)}
                      </p>
                      {snippet && (
                        <p className="text-xs text-(--color-text-secondary) mt-0.5 line-clamp-2">
                          {snippet}
                        </p>
                      )}
                      <p className={`${text.caption} mt-1`}>
                        {formatDate(memory.timestamp)}
                        {matchedById.has(memory.id) && (
                          <span> · matched {matchedById.get(memory.id)!.join(', ')}</span>
                        )}
                      </p>
                    </button>
                    <button
                      onClick={() => onHideNote(moment.id, memory.id)}
                      className={`${btn.icon} shrink-0`}
                      aria-label="Hide from this moment"
                      title="Hide from this moment"
                    >
                      <EyeOff size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Actions */}
          <div className="mt-8 pt-6 border-t border-(--color-border-default) flex flex-wrap items-center gap-3">
            <button onClick={handleDeleteClick} className={btn.outlinedDangerSm}>
              <Trash2 size={14} />
              Delete moment
            </button>
            {hiddenCount > 0 && (
              <span className={text.caption}>
                {hiddenCount} {hiddenCount === 1 ? 'note' : 'notes'} hidden
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Memory Preview Modal */}
      {previewMemory && (
        <MemoryPreviewModal
          memory={previewMemory}
          onClose={() => setPreviewMemoryId(null)}
          onViewAttachment={onViewAttachment}
          onDelete={onMemoryDelete}
          onEdit={onMemoryEdit}
          onUpdate={onMemoryUpdate}
          onTogglePin={onMemoryTogglePin}
        />
      )}

      {/* Delete Confirmation Dialog — Step 1: Choose scope */}
      {deleteConfirmStep === 'choose' && (
        <div className={overlay.dialogBackdrop} onClick={() => setDeleteConfirmStep(null)}>
          <div
            className={`${overlay.modal} p-6 mx-4 w-full max-w-sm animate-in zoom-in-95 fade-in duration-(--duration-normal)`}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-(--color-danger)/10 rounded-full flex items-center justify-center shrink-0">
                <Trash2 size={20} className="text-(--color-danger)" />
              </div>
              <div>
                <h3 className="text-base font-bold text-(--color-text-primary)">Delete moment</h3>
                <p className="text-xs text-(--color-text-tertiary) mt-0.5">
                  This moment matches {noteCount} {noteLabel}
                </p>
              </div>
            </div>
            <p className="text-sm text-(--color-text-secondary) mb-6">
              Would you also like to delete the matching notes, or only remove the moment?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleDeleteMomentOnly}
                className={`${btn.base} ${btn.secondary} w-full text-sm`}
              >
                Delete moment only
              </button>
              <button
                onClick={() => setDeleteConfirmStep('confirm-notes')}
                className={`${btn.base} ${btn.danger} w-full text-sm`}
              >
                Delete moment and notes
              </button>
              <button
                onClick={() => setDeleteConfirmStep(null)}
                className={`${btn.base} ${btn.ghost} w-full text-sm mt-1`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation — Step 2: Select notes to delete */}
      {deleteConfirmStep === 'confirm-notes' && (
        <MomentNoteDeletionSheet
          moment={moment}
          notes={notes}
          onCancel={() => setDeleteConfirmStep(null)}
          onConfirm={handleDeleteWithNotes}
          onViewAttachment={onViewAttachment}
          onMemoryEdit={onMemoryEdit}
          onMemoryTogglePin={onMemoryTogglePin}
        />
      )}
    </div>
  );
};

export default MomentSheet;
