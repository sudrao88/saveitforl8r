/**
 * MomentSheet.tsx
 *
 * Full-screen synthesis detail sheet. Opens when user taps a Moment bubble.
 * Handles loading, caching, synthesis display, item completion, and
 * source note citations for each synthesis item.
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  X,
  Loader2,
  Trash2,
  ExternalLink,
  Check,
  RefreshCw,
  FileText,
  AlertTriangle,
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
import { overlay, btn } from '../styles/design-system';

// Shared loading indicator for pending creation and resynthesis states
const SynthesisLoadingState: React.FC = () => (
  <div className="text-center px-6">
    <Loader2 size={32} className="animate-spin text-blue-400 mx-auto mb-4" />
    <h3 className="text-lg font-bold text-gray-200 mb-2">Creating your moment…</h3>
    <p className="text-sm text-gray-400 max-w-sm">
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
  <div className={`${overlay.sheet}`}>
    <div className={overlay.sheetHeader}>
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          className={overlay.closeBtn}
        >
          <X size={24} />
        </button>
        <div>
          <h2 className="text-lg font-bold text-gray-100 truncate max-w-[200px] sm:max-w-md">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-gray-400">{subtitle}</p>
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

  const noteCount = moment.noteIds.length;
  const noteLabel = noteCount === 1 ? 'note' : 'notes';

  // Build a lookup map for source note citations
  const memoriesMap = useMemo(() => {
    const map = new Map<string, Memory>();
    for (const m of memories) {
      map.set(m.id, m);
    }
    return map;
  }, [memories]);

  const previewMemory = previewMemoryId ? memoriesMap.get(previewMemoryId) : undefined;

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
    if (moment.noteIds.length > 0 && onDeleteNotes) {
      setDeleteConfirmStep('choose');
    } else {
      onDelete(moment.id);
      onClose();
    }
  }, [moment.id, moment.noteIds.length, onDelete, onDeleteNotes, onClose]);

  const handleDeleteMomentOnly = useCallback(() => {
    onDelete(moment.id);
    setDeleteConfirmStep(null);
    onClose();
  }, [moment.id, onDelete, onClose]);

  const handleDeleteWithNotes = useCallback(() => {
    onDelete(moment.id);
    onDeleteNotes?.(moment.noteIds);
    setDeleteConfirmStep(null);
    onClose();
  }, [moment.id, moment.noteIds, onDelete, onDeleteNotes, onClose]);

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
            <div className="w-16 h-16 bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <X size={32} className="text-red-400" />
            </div>
            <h3 className="text-lg font-bold text-gray-200 mb-2">
              Moment creation failed
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Could not create this moment. Check your connection and try again.
            </p>
            <button
              onClick={handleDeleteClick}
              className="px-6 py-2.5 bg-red-600/20 text-red-400 rounded-xl text-sm font-bold hover:bg-red-600/30 transition-colors active:scale-95"
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
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>{moment.noteIds.length} notes</span>
        </div>
      }
      onClose={onClose}
    >

      {/* Objective banner */}
      <div className="px-4 sm:px-8 py-2 bg-gray-900/50 border-b border-gray-800/50 max-w-2xl mx-auto w-full">
        <p className="text-xs text-gray-400 italic truncate">
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
              <div className="w-16 h-16 bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <X size={32} className="text-red-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-200 mb-2">
                Synthesis failed
              </h3>
              <p className="text-sm text-gray-400 mb-4">
                Could not generate the moment. Check your connection and try again.
              </p>
              <button
                onClick={handleRetry}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors active:scale-95"
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
              <div className="mt-8 pt-6 border-t border-gray-800">
                <div className="flex gap-2">
                  <button
                    onClick={handleRetry}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-gray-200 transition-all active:scale-95"
                  >
                    <RefreshCw size={14} />
                    Re-synthesize
                  </button>
                  <button
                    onClick={handleDeleteClick}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-red-900/20 text-red-400 border border-red-800/30 hover:border-red-600/50 hover:text-red-300 transition-all active:scale-95"
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

      {/* Delete Confirmation Dialog — Step 2: Confirm note deletion */}
      {deleteConfirmStep === 'confirm-notes' && (
        <div className={overlay.dialogBackdrop} onClick={() => setDeleteConfirmStep(null)}>
          <div
            className={`${overlay.modal} p-6 mx-4 w-full max-w-sm animate-in zoom-in-95 fade-in duration-(--duration-normal)`}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-12 h-12 bg-(--color-danger)/10 rounded-full flex items-center justify-center mb-3">
                <AlertTriangle size={24} className="text-(--color-warning)" />
              </div>
              <h3 className="text-base font-bold text-(--color-text-primary) mb-1">Are you sure?</h3>
              <p className="text-sm text-(--color-text-secondary)">
                This will permanently delete {noteCount} {noteLabel} along with the moment. This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmStep('choose')}
                className={`${btn.base} ${btn.secondary} flex-1 text-sm`}
              >
                Go back
              </button>
              <button
                onClick={handleDeleteWithNotes}
                className={`${btn.base} ${btn.danger} flex-1 text-sm`}
              >
                Delete all
              </button>
            </div>
          </div>
        </div>
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
    <h3 className="text-base font-bold text-gray-200 mb-3 flex items-center gap-2">
      <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
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
    className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
      isCompleted
        ? 'bg-gray-800/30 border-gray-800 opacity-60'
        : 'bg-gray-800/50 border-gray-700/50 hover:border-gray-600/50'
    }`}
  >
    {completable && (
      <button
        onClick={onToggle}
        className="shrink-0 mt-0.5"
      >
        <div
          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
            isCompleted
              ? 'border-blue-500 bg-blue-500/20'
              : 'border-gray-600 hover:border-gray-400'
          }`}
        >
          {isCompleted && <Check size={12} className="text-blue-400" />}
        </div>
      </button>
    )}
    <div className="flex-1 min-w-0">
      <p
        className={`text-sm font-medium ${
          isCompleted ? 'line-through text-gray-500' : 'text-gray-200'
        }`}
      >
        {item.label}
      </p>
      {item.detail && (
        <p className="text-xs text-gray-400 mt-0.5">{item.detail}</p>
      )}
      {/* Source note citation */}
      {sourceMemory && (
        <button
          onClick={(e) => { e.stopPropagation(); onPreviewNote?.(); }}
          className="flex items-center gap-1.5 mt-1.5 group/cite hover:opacity-80 transition-opacity text-left"
        >
          <FileText size={10} className="text-gray-500 shrink-0 group-hover/cite:text-blue-400" />
          <span className="text-xs text-gray-500 truncate group-hover/cite:text-blue-400">
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
        className="shrink-0 p-1.5 text-gray-500 hover:text-blue-400 transition-colors"
        onClick={e => e.stopPropagation()}
      >
        <ExternalLink size={14} />
      </a>
    )}
  </div>
);

export default MomentSheet;
