/**
 * MomentSheet.tsx
 *
 * Full-screen sheet for one moment: its terms, and every note that matches
 * them, best match first. Matches are computed locally (useMoments) and update
 * live as notes change. Larger moments are split into subsections on the
 * device (utils/momentSections), with chips to switch grouping or go back to
 * plain relevance order. Notes can be opened in a preview or hidden from this
 * moment; hidden notes can be listed and brought back. A moment can't be
 * edited — delete it and create a new one.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useBackButton } from '../hooks/useBackButton';
import { X, Trash2, Eye, EyeOff, CloudOff, Loader2, RefreshCw, Share2, Check, ChevronDown } from 'lucide-react';
import { Moment, Memory, Attachment } from '../types';
import MemoryPreviewModal from './MemoryPreviewModal';
import MomentNoteDeletionSheet from './MomentNoteDeletionSheet';
import { FALLBACK_MOMENT_EMOJI } from './MomentBubble';
import { overlay, btn, chip, card, text } from '../styles/design-system';
import { canMatchMoment, MomentMatch } from '../utils/momentMatching';
import { noteTitle, noteSnippet, formatNoteDate as formatDate } from '../utils/noteLabels';
import { formatMomentForShare, momentShareTitle } from '../utils/momentShare';
import { shareText } from '../services/platform';
import { sectionMoment, SectionLens } from '../utils/momentSections';

type SectionView = SectionLens | 'relevance';

const LENS_LABELS: Record<SectionLens, string> = {
  topic: 'Topics',
  kind: 'Kinds',
  place: 'Places',
  time: 'Timeline',
};

/** Per-device memory of how each moment was last grouped (not synced). */
export const SECTION_VIEW_KEY = 'moments:sectionLens';

const readSectionViews = (): Record<string, string> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SECTION_VIEW_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeSectionView = (momentId: string, view: SectionView) => {
  try {
    localStorage.setItem(SECTION_VIEW_KEY, JSON.stringify({ ...readSectionViews(), [momentId]: view }));
  } catch {
    // Storage unavailable: the choice just lasts for this session.
  }
};

type DeleteConfirmStep = 'choose' | 'confirm-notes';

interface MomentSheetProps {
  moment: Moment;
  memories: Memory[];
  matches: MomentMatch[];
  isEmbedding: boolean;
  onClose: () => void;
  onDelete: (momentId: string) => Promise<void>;
  onHideNote: (momentId: string, noteId: string) => Promise<void>;
  onUnhideNote?: (momentId: string, noteId: string) => Promise<void>;
  onRetryEmbedding: (momentId: string) => Promise<void>;
  onDeleteNotes?: (noteIds: string[]) => void;
  onViewAttachment?: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onMemoryDelete?: (id: string) => void;
  onMemoryEdit?: (memory: Memory) => void;
  onMemoryUpdate?: (id: string, content: string) => void;
  onMemoryTogglePin?: (id: string, isPinned: boolean) => void;
}

const MomentSheet: React.FC<MomentSheetProps> = ({
  moment,
  memories,
  matches,
  isEmbedding,
  onClose,
  onDelete,
  onHideNote,
  onUnhideNote,
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
  const [shareStatus, setShareStatus] = useState<'copied' | 'failed' | null>(null);
  const [showHidden, setShowHidden] = useState(false);

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

  // Ways to split the notes into subsections, best first (empty: stay flat).
  const sectionings = useMemo(
    () => sectionMoment(moment, matches, memoriesMap),
    [moment, matches, memoriesMap],
  );
  const [chosenView, setChosenView] = useState<SectionView | null>(
    () => (readSectionViews()[moment.id] as SectionView | undefined) ?? null,
  );
  // The remembered grouping if it still applies, else the best one.
  const activeSectioning =
    chosenView === 'relevance'
      ? undefined
      : sectionings.find(s => s.lens === chosenView) ?? sectionings[0];
  const activeView: SectionView = activeSectioning?.lens ?? 'relevance';

  const handleSelectView = useCallback((view: SectionView) => {
    setChosenView(view);
    writeSectionView(moment.id, view);
  }, [moment.id]);

  const previewMemory = previewMemoryId ? memoriesMap.get(previewMemoryId) : undefined;
  const embedded = canMatchMoment(moment);
  const noteCount = notes.length;
  const noteLabel = noteCount === 1 ? 'note' : 'notes';
  // Hidden notes that still exist, most recently hidden first. Ids of notes
  // deleted since they were hidden are skipped.
  const hiddenNotes = useMemo(() => {
    const out: Memory[] = [];
    for (const id of [...(moment.excludedNoteIds ?? [])].reverse()) {
      const m = memoriesMap.get(id);
      if (m && !m.isDeleted) out.push(m);
    }
    return out;
  }, [moment.excludedNoteIds, memoriesMap]);
  const hiddenCount = hiddenNotes.length;

  // Dismiss nested dialogs on Android back button
  useBackButton(() => setPreviewMemoryId(null), previewMemoryId !== null);
  useBackButton(() => setDeleteConfirmStep(null), deleteConfirmStep !== null);

  // Share the moment as a formatted text note (system share sheet, or copy).
  const handleShare = useCallback(async () => {
    const result = await shareText(momentShareTitle(moment), formatMomentForShare(moment, notes, activeSectioning?.sections));
    if (result === 'copied' || result === 'failed') setShareStatus(result);
  }, [moment, notes, activeSectioning]);

  useEffect(() => {
    if (!shareStatus) return;
    const t = setTimeout(() => setShareStatus(null), 2500);
    return () => clearTimeout(t);
  }, [shareStatus]);

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

  const renderNote = (memory: Memory, hidden = false) => {
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
            {!hidden && matchedById.has(memory.id) && (
              <span> · matched {matchedById.get(memory.id)!.join(', ')}</span>
            )}
          </p>
        </button>
        {hidden ? (
          onUnhideNote && (
            <button
              onClick={() => onUnhideNote(moment.id, memory.id)}
              className={`${btn.icon} shrink-0`}
              aria-label="Show in this moment"
              title="Show in this moment"
            >
              <Eye size={16} />
            </button>
          )
        ) : (
          <button
            onClick={() => onHideNote(moment.id, memory.id)}
            className={`${btn.icon} shrink-0`}
            aria-label="Hide from this moment"
            title="Hide from this moment"
          >
            <EyeOff size={16} />
          </button>
        )}
      </li>
    );
  };

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
        <div className="flex items-center gap-2 shrink-0">
          {embedded && (
            <span className="text-xs text-(--color-text-tertiary)">
              {noteCount} {noteLabel}
            </span>
          )}
          <button
            onClick={handleShare}
            className={btn.icon}
            aria-label="Share moment"
            title="Share moment"
          >
            {shareStatus === 'copied' ? <Check size={20} className="text-(--color-success)" /> : <Share2 size={20} />}
          </button>
        </div>
      </div>
      {shareStatus && (
        <p role="status" className={`${text.caption} text-center py-1`}>
          {shareStatus === 'copied' ? 'Copied to clipboard' : 'Couldn’t share this moment'}
        </p>
      )}

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
            <>
              {sectionings.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Group notes by">
                  {(['relevance', ...sectionings.map(s => s.lens)] as SectionView[]).map(view => (
                    <button
                      key={view}
                      onClick={() => handleSelectView(view)}
                      aria-pressed={activeView === view}
                      className={`${chip.base} ${activeView === view ? chip.active : chip.inactive}`}
                    >
                      {view === 'relevance' ? 'Relevance' : LENS_LABELS[view]}
                    </button>
                  ))}
                </div>
              )}
              {activeSectioning ? (
                <div className="space-y-6">
                  {activeSectioning.sections.map(section => (
                    <section key={section.key} aria-label={section.label}>
                      <div className="flex items-baseline justify-between gap-2 mb-2 px-1">
                        <h3 className={`${text.label} truncate min-w-0`}>{section.label}</h3>
                        <span className={`${text.caption} shrink-0`}>{section.noteIds.length}</span>
                      </div>
                      <ul className="space-y-2">
                        {section.noteIds.map(id => {
                          const memory = memoriesMap.get(id);
                          return memory ? renderNote(memory) : null;
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : (
                <ul className="space-y-2">{notes.map(m => renderNote(m))}</ul>
              )}
            </>
          )}

          {/* Actions */}
          <div className="mt-8 pt-6 border-t border-(--color-border-default) flex flex-wrap items-center gap-3">
            <button onClick={handleDeleteClick} className={btn.outlinedDangerSm}>
              <Trash2 size={14} />
              Delete moment
            </button>
            {hiddenCount > 0 && (onUnhideNote ? (
              <button
                onClick={() => setShowHidden(v => !v)}
                aria-expanded={showHidden}
                aria-controls="moment-hidden-notes"
                className={`${btn.base} ${btn.ghost} text-xs gap-1`}
              >
                {hiddenCount} {hiddenCount === 1 ? 'note' : 'notes'} hidden
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-(--duration-fast) ${showHidden ? 'rotate-180' : ''}`}
                />
              </button>
            ) : (
              <span className={text.caption}>
                {hiddenCount} {hiddenCount === 1 ? 'note' : 'notes'} hidden
              </span>
            ))}
          </div>

          {showHidden && hiddenCount > 0 && onUnhideNote && (
            <section id="moment-hidden-notes" aria-label="Hidden notes" className="mt-4">
              <p className={`${text.caption} mb-2 px-1`}>
                Hidden notes don’t appear in this moment. Tap the eye to bring one back.
              </p>
              <ul className="space-y-2 opacity-70">{hiddenNotes.map(m => renderNote(m, true))}</ul>
            </section>
          )}
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
