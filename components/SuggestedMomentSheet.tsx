/**
 * SuggestedMomentSheet.tsx
 *
 * Preview of a suggested moment: the notes it would show (computed by the
 * same matcher as the user's moments), with actions to add it as a moment or
 * dismiss the suggestion.
 */

import React, { useMemo, useState } from 'react';
import { X, Sparkles, Plus, Loader2 } from 'lucide-react';
import { Memory, Attachment } from '../types';
import MemoryPreviewModal from './MemoryPreviewModal';
import { useBackButton } from '../hooks/useBackButton';
import { overlay, btn, card, text, chip } from '../styles/design-system';
import { MomentSuggestion } from '../utils/momentSuggestions';
import { noteTitle, noteSnippet, formatNoteDate } from '../utils/noteLabels';

interface SuggestedMomentSheetProps {
  suggestion: MomentSuggestion;
  memories: Memory[];
  isCreating: boolean;
  onClose: () => void;
  onAdd: (suggestion: MomentSuggestion) => void;
  onDismiss: (suggestion: MomentSuggestion) => void;
  onViewAttachment?: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onMemoryDelete?: (id: string) => void;
  onMemoryEdit?: (memory: Memory) => void;
  onMemoryUpdate?: (id: string, content: string) => void;
  onMemoryTogglePin?: (id: string, isPinned: boolean) => void;
}

const SuggestedMomentSheet: React.FC<SuggestedMomentSheetProps> = ({
  suggestion,
  memories,
  isCreating,
  onClose,
  onAdd,
  onDismiss,
  onViewAttachment,
  onMemoryDelete,
  onMemoryEdit,
  onMemoryUpdate,
  onMemoryTogglePin,
}) => {
  const [previewMemoryId, setPreviewMemoryId] = useState<string | null>(null);
  useBackButton(() => setPreviewMemoryId(null), previewMemoryId !== null);

  const memoriesMap = useMemo(() => new Map(memories.map(m => [m.id, m])), [memories]);
  const notes = useMemo(
    () => suggestion.matches
      .map(match => memoriesMap.get(match.id))
      .filter((m): m is Memory => !!m && !m.isDeleted),
    [suggestion.matches, memoriesMap],
  );
  const previewMemory = previewMemoryId ? memoriesMap.get(previewMemoryId) : undefined;
  const clusterSize = suggestion.clusterIds.length;

  return (
    <div className={overlay.sheetBase}>
      <div className={overlay.sheetHeader}>
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onClose} className={overlay.closeBtn} aria-label="Close">
            <X size={24} />
          </button>
          <Sparkles size={22} className="text-(--color-accent) shrink-0" />
          <h2 className="text-lg font-bold text-(--color-text-primary) truncate min-w-0">
            {suggestion.label}
          </h2>
        </div>
        <span className="text-xs text-(--color-text-tertiary) shrink-0">
          {notes.length} {notes.length === 1 ? 'note' : 'notes'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 sm:p-8 pb-32">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`${chip.base} ${chip.inactive} max-w-full`}>
              <span className="truncate">{suggestion.label}</span>
            </span>
          </div>
          <p className={`${text.body} mb-6`}>
            Suggested from {clusterSize} similar notes that all mention “{suggestion.label}”. Add it as a moment to
            keep these together.
          </p>

          <div className="flex flex-wrap gap-3 mb-6">
            <button
              onClick={() => onAdd(suggestion)}
              disabled={isCreating}
              className={`${btn.base} ${btn.primary} gap-2 text-sm`}
            >
              {isCreating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Add moment
            </button>
            <button
              onClick={() => onDismiss(suggestion)}
              disabled={isCreating}
              className={`${btn.base} ${btn.secondary} text-sm`}
            >
              Dismiss
            </button>
          </div>

          <ul className="space-y-2">
            {notes.map(memory => {
              const snippet = noteSnippet(memory);
              return (
                <li key={memory.id} className={`${card.base} p-3`}>
                  <button onClick={() => setPreviewMemoryId(memory.id)} className="w-full min-w-0 text-left">
                    <p className="text-sm font-medium text-(--color-text-primary) line-clamp-2">
                      {noteTitle(memory)}
                    </p>
                    {snippet && (
                      <p className="text-xs text-(--color-text-secondary) mt-0.5 line-clamp-2">{snippet}</p>
                    )}
                    <p className={`${text.caption} mt-1`}>{formatNoteDate(memory.timestamp)}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

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
    </div>
  );
};

export default SuggestedMomentSheet;
