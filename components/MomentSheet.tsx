/**
 * MomentSheet.tsx
 *
 * Full-screen synthesis detail sheet. Opens when user taps a Moment bubble.
 * Handles loading, caching, synthesis display, item completion, and
 * source note citations for each synthesis item.
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useBackButton } from '../hooks/useBackButton';
import {
  X,
  Loader2,
  Trash2,
  ExternalLink,
  Check,
  RefreshCw,
  FileText,
} from 'lucide-react';
import {
  Moment,
  SynthesisResponse,
  SynthesisSection,
  SynthesisItem,
  Memory,
  Attachment,
} from '../types';
import MemoryPreviewModal from './MemoryPreviewModal';
import MomentNoteDeletionSheet from './MomentNoteDeletionSheet';
import { overlay, btn } from '../styles/design-system';

// Shared loading indicator for pending creation and resynthesis states
const SynthesisLoadingState: React.FC = () => (
  <div className="text-center px-6">
    <Loader2 size={32} className="animate-spin text-(--color-accent) mx-auto mb-4" />
    <h3 className="text-lg font-bold text-(--color-text-primary) mb-2">Creating your moment…</h3>
    <p className="text-sm text-(--color-text-secondary) max-w-sm">
      Our AI is analyzing your notes and building a synthesis. This usually takes 15–30 seconds.
    </p>
  </div>
);

// Shared shell for all sheet states (pending, error, normal)
const SheetShell: React.FC<{
  title: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, subtitle, headerRight, onClose, children }) => (
  <div className={overlay.sheetBase}>
    <div className={overlay.sheetHeader}>
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          className={overlay.closeBtn}
        >
          <X size={24} />
        </button>
        <div>
          <h2 className="text-lg font-bold text-(--color-text-primary) truncate max-w-[200px] sm:max-w-md">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-(--color-text-secondary)">{subtitle}</p>
          )}
        </div>
      </div>
      {headerRight}
    </div>
    {children}
  </div>
);

type DeleteConfirmStep = 'choose' | 'confirm-notes';

interface MomentSheetProps {
  moment: Moment;
  memories: Memory[];
  onClose: () => void;
  loadSynthesis: (moment: Moment, memories: Memory[], signal?: AbortSignal) => Promise<SynthesisResponse | null>;
  onDelete: (momentId: string) => Promise<void>;
  onDeleteNotes?: (noteIds: string[]) => void;
  onViewAttachment?: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onMemoryDelete?: (id: string) => void;
  onMemoryEdit?: (memory: Memory) => void;
  onMemoryTogglePin?: (id: string, isPinned: boolean) => void;
}

const MomentSheet: React.FC<MomentSheetProps> = ({
  moment,
  memories,
  onClose,
  loadSynthesis,
  onDelete,
  onDeleteNotes,
  onViewAttachment,
  onMemoryDelete,
  onMemoryEdit,
  onMemoryTogglePin,
}) => {
  const [synthesis, setSynthesis] = useState<SynthesisResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [completedItems, setCompletedItems] = useState<Set<string>>(new Set());
  const [previewMemoryId, setPreviewMemoryId] = useState<string | null>(null);
  const [deleteConfirmStep, setDeleteConfirmStep] = useState<DeleteConfirmStep | null>(null);

  // Build a lookup map for source note citations
  const memoriesMap = useMemo(() => {
    const map = new Map<string, Memory>();
    for (const m of memories) {
      map.set(m.id, m);
    }
    return map;
  }, [memories]);

  const previewMemory = previewMemoryId ? memoriesMap.get(previewMemoryId) : undefined;

  // Resolved, in-order list of the moment's notes (skip missing or soft-deleted).
  // Drives every displayed note count so the header, confirmation prompt, and
  // deletion sheet stay in sync even when moment.noteIds contains dangling refs.
  const momentNotes = useMemo(() => {
    const result: Memory[] = [];
    for (const id of moment.noteIds) {
      const m = memoriesMap.get(id);
      if (m && !m.isDeleted) result.push(m);
    }
    return result;
  }, [moment.noteIds, memoriesMap]);

  const noteCount = momentNotes.length;
  const noteLabel = noteCount === 1 ? 'note' : 'notes';

  // Dismiss nested dialogs on Android back button
  useBackButton(() => setPreviewMemoryId(null), previewMemoryId !== null);
  useBackButton(() => setDeleteConfirmStep(null), deleteConfirmStep !== null);

  // Keep refs to latest props so the effect always uses current values
  const momentRef = useRef(moment);
  const memoriesRef = useRef(memories);
  momentRef.current = moment;
  memoriesRef.current = memories;

  // Track actual noteIds content (not just length) so the effect re-runs
  // when notes are added or removed — even if the count stays the same.
  const noteIdsKey = useMemo(() => moment.noteIds.slice().sort().join(','), [moment.noteIds]);

  useEffect(() => {
    // Don't load synthesis for pending moments
    if (moment.isPending) {
      setIsLoading(false);
      return;
    }

    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setError(false);
      try {
        const result = await loadSynthesis(momentRef.current, memoriesRef.current, abortController.signal);
        if (!abortController.signal.aborted) {
          setSynthesis(result);
          if (!result) setError(true);
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          // Ignore AbortError — it just means a newer loadSynthesis superseded this one
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setError(true);
        }
      } finally {
        if (!abortController.signal.aborted) setIsLoading(false);
      }
    };

    load();

    return () => {
      abortController.abort();
    };
  }, [moment.id, noteIdsKey, moment.isPending, loadSynthesis]);

  const handleRetry = useCallback(async () => {
    setIsLoading(true);
    setError(false);
    try {
      const result = await loadSynthesis(moment, memories);
      setSynthesis(result);
      if (!result) setError(true);
    } catch {
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }, [moment, memories, loadSynthesis]);

  const toggleItemComplete = useCallback((itemKey: string) => {
    setCompletedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemKey)) {
        next.delete(itemKey);
      } else {
        next.add(itemKey);
      }
      return next;
    });
  }, []);

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

  // Pending state — moment is still being created
  if (moment.isPending) {
    return (
      <SheetShell title={moment.objective} onClose={onClose}>
        <div className="flex-1 flex items-center justify-center">
          <SynthesisLoadingState />
        </div>
      </SheetShell>
    );
  }

  // Error state — moment creation failed
  if (moment.processingError && !synthesis) {
    return (
      <SheetShell title={moment.title} onClose={onClose}>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-6">
            <div className="w-16 h-16 bg-(--color-danger)/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <X size={32} className="text-(--color-danger)" />
            </div>
            <h3 className="text-lg font-bold text-(--color-text-primary) mb-2">
              Moment creation failed
            </h3>
            <p className="text-sm text-(--color-text-secondary) mb-4">
              Could not create this moment. Check your connection and try again.
            </p>
            <button
              onClick={handleDeleteClick}
              className="px-6 py-2.5 bg-(--color-danger)/20 text-(--color-danger) rounded-(--radius-xl) text-sm font-bold hover:bg-(--color-danger)/30 transition-colors active:scale-95"
            >
              Remove
            </button>
          </div>
        </div>
      </SheetShell>
    );
  }

  return (
    <SheetShell
      title={moment.title}
      subtitle={synthesis?.subtitle}
      headerRight={
        <div className="flex items-center gap-2 text-xs text-(--color-text-tertiary)">
          <span>{noteCount} {noteLabel}</span>
        </div>
      }
      onClose={onClose}
    >

      {/* Objective banner */}
      <div className="px-4 sm:px-8 py-2 bg-(--color-surface-overlay)/50 border-b border-(--color-border-subtle) max-w-2xl mx-auto w-full">
        <p className="text-xs text-(--color-text-secondary) italic truncate">
          {moment.objective}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 sm:p-8 pb-32">
          {isLoading && (
            <div className="flex items-center justify-center py-24">
              <SynthesisLoadingState />
            </div>
          )}

          {error && !isLoading && (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-(--color-danger)/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <X size={32} className="text-(--color-danger)" />
              </div>
              <h3 className="text-lg font-bold text-(--color-text-primary) mb-2">
                Synthesis failed
              </h3>
              <p className="text-sm text-(--color-text-secondary) mb-4">
                Could not generate the moment. Check your connection and try again.
              </p>
              <button
                onClick={handleRetry}
                className={`${btn.base} ${btn.primary} px-6`}
              >
                Retry
              </button>
            </div>
          )}

          {synthesis && !isLoading && (
            <>
              <div className="space-y-6">
                {synthesis.sections.map((section, sIdx) => (
                  <SectionView
                    key={sIdx}
                    section={section}
                    sectionIndex={sIdx}
                    completedItems={completedItems}
                    onToggleComplete={toggleItemComplete}
                    memoriesMap={memoriesMap}
                    onPreviewNote={setPreviewMemoryId}
                  />
                ))}
              </div>

              {/* Actions */}
              <div className="mt-8 pt-6 border-t border-(--color-border-default)">
                <div className="flex gap-2">
                  <button
                    onClick={handleRetry}
                    className={btn.outlinedSm}
                  >
                    <RefreshCw size={14} />
                    Re-synthesize
                  </button>
                  <button
                    onClick={handleDeleteClick}
                    className={btn.outlinedDangerSm}
                  >
                    <Trash2 size={14} />
                    Delete moment
                  </button>
                </div>
              </div>
            </>
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
                  This moment has {noteCount} associated {noteLabel}
                </p>
              </div>
            </div>
            <p className="text-sm text-(--color-text-secondary) mb-6">
              Would you also like to delete the associated notes, or only remove the moment?
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
          notes={momentNotes}
          onCancel={() => setDeleteConfirmStep(null)}
          onConfirm={handleDeleteWithNotes}
          onViewAttachment={onViewAttachment}
          onMemoryEdit={onMemoryEdit}
          onMemoryTogglePin={onMemoryTogglePin}
        />
      )}
    </SheetShell>
  );
};

// --- Section Component ---

const SectionView: React.FC<{
  section: SynthesisSection;
  sectionIndex: number;
  completedItems: Set<string>;
  onToggleComplete: (key: string) => void;
  memoriesMap: Map<string, Memory>;
  onPreviewNote: (id: string) => void;
}> = ({ section, sectionIndex, completedItems, onToggleComplete, memoriesMap, onPreviewNote }) => (
  <div>
    <h3 className="text-base font-bold text-(--color-text-primary) mb-3 flex items-center gap-2">
      <div className="w-1.5 h-1.5 bg-(--color-accent) rounded-full" />
      {section.heading}
    </h3>
    <div className="space-y-2">
      {section.items.map((item, iIdx) => {
        const key = `${sectionIndex}-${iIdx}`;
        const isCompleted = item.completed
          ? !completedItems.has(key)
          : completedItems.has(key);
        return (
          <ItemView
            key={key}
            item={item}
            isCompleted={isCompleted}
            completable={item.completable !== false}
            onToggle={() => onToggleComplete(key)}
            sourceMemory={item.sourceNoteId ? memoriesMap.get(item.sourceNoteId) : undefined}
            onPreviewNote={item.sourceNoteId ? () => onPreviewNote(item.sourceNoteId!) : undefined}
          />
        );
      })}
    </div>
  </div>
);

// --- Item Component ---

function stripHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function truncateCitation(text: string, max: number = 60): string {
  if (!text) return '';
  const cleaned = stripHtml(text);
  return cleaned.length > max ? cleaned.slice(0, max - 1) + '…' : cleaned;
}

const ItemView: React.FC<{
  item: SynthesisItem;
  isCompleted: boolean;
  completable: boolean;
  onToggle: () => void;
  sourceMemory?: Memory;
  onPreviewNote?: () => void;
}> = ({ item, isCompleted, completable, onToggle, sourceMemory, onPreviewNote }) => (
  <div
    className={`flex items-start gap-3 p-3 rounded-(--radius-xl) border transition-all ${
      isCompleted
        ? 'bg-(--color-surface-raised)/30 border-(--color-border-default) opacity-60'
        : 'bg-(--color-surface-raised)/50 border-(--color-border-subtle) hover:border-(--color-border-default)/50'
    }`}
  >
    {completable && (
      <button
        onClick={onToggle}
        className="shrink-0 mt-0.5"
      >
        <div
          className={`w-5 h-5 rounded-(--radius-md) border-2 flex items-center justify-center transition-colors ${
            isCompleted
              ? 'border-(--color-accent) bg-(--color-accent)/20'
              : 'border-(--color-border-default) hover:border-(--color-border-default)'
          }`}
        >
          {isCompleted && <Check size={12} className="text-(--color-accent)" />}
        </div>
      </button>
    )}
    <div className="flex-1 min-w-0">
      <p
        className={`text-sm font-medium ${
          isCompleted ? 'line-through text-(--color-text-tertiary)' : 'text-(--color-text-primary)'
        }`}
      >
        {item.label}
      </p>
      {item.detail && (
        <p className="text-xs text-(--color-text-secondary) mt-0.5 break-all">{item.detail}</p>
      )}
      {/* Source note citation */}
      {sourceMemory && (
        <button
          onClick={(e) => { e.stopPropagation(); onPreviewNote?.(); }}
          className="flex items-center gap-1.5 mt-1.5 max-w-full overflow-hidden group/cite hover:opacity-80 transition-opacity text-left"
        >
          <FileText size={10} className="text-(--color-text-tertiary) shrink-0 group-hover/cite:text-(--color-accent)" />
          <span className="text-xs text-(--color-text-tertiary) truncate group-hover/cite:text-(--color-accent)">
            {truncateCitation(sourceMemory.content)}
          </span>
        </button>
      )}
    </div>
    {item.link && (
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 p-1.5 text-(--color-text-tertiary) hover:text-(--color-accent) transition-colors"
        onClick={e => e.stopPropagation()}
      >
        <ExternalLink size={14} />
      </a>
    )}
  </div>
);

export default MomentSheet;
