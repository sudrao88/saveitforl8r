/**
 * MomentCreationDialog.tsx
 *
 * Modal dialog for creating a new moment. The user enters a few terms as
 * chips (Enter or comma adds one); the moment then shows every note whose
 * meaning is close to any of the terms.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { X, Loader2, Sparkles } from 'lucide-react';
import { btn, chip, input, overlay, text } from '../styles/design-system';
import { useAnimatedUnmount } from '../hooks/useAnimatedUnmount';
import { parseMomentTerms, MAX_MOMENT_TERMS, MAX_MOMENT_TERM_LENGTH } from '../utils/momentMatching';

interface MomentCreationDialogProps {
  isOpen: boolean;
  isCreating: boolean;
  onClose: () => void;
  onCreate: (terms: string[]) => Promise<void>;
}

const PLACEHOLDER_EXAMPLES = [
  'Singapore, hawker food, Marina Bay',
  'Cafés in Bangalore',
  'Agentic coding, AI tools',
  'Meal prep, healthy recipes',
  'Gift ideas for Mom',
];

const MomentCreationDialog: React.FC<MomentCreationDialogProps> = ({
  isOpen,
  isCreating,
  onClose,
  onCreate,
}) => {
  const [terms, setTerms] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [placeholderIdx] = useState(() => Math.floor(Math.random() * PLACEHOLDER_EXAMPLES.length));

  // Reset when the dialog closes (React-approved setState-during-render pattern)
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) {
      setTerms([]);
      setDraft('');
    }
  }

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Terms already added plus whatever is still typed in the box.
  const allTerms = useCallback(
    (extra: string) => parseMomentTerms([...terms, extra].join(',')),
    [terms],
  );

  const commitDraft = useCallback(() => {
    if (!draft.trim()) return;
    setTerms(allTerms(draft));
    setDraft('');
  }, [draft, allTerms]);

  const removeTerm = useCallback((idx: number) => {
    setTerms(prev => prev.filter((_, i) => i !== idx));
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    const finalTerms = allTerms(draft);
    if (finalTerms.length === 0 || isCreating) return;
    await onCreate(finalTerms);
  }, [allTerms, draft, isCreating, onCreate]);

  const handleChange = useCallback((value: string) => {
    // Typing or pasting a comma commits everything before it as chips.
    if (value.includes(',')) {
      const lastComma = value.lastIndexOf(',');
      setTerms(allTerms(value.slice(0, lastComma)));
      setDraft(value.slice(lastComma + 1).trimStart());
    } else {
      setDraft(value);
    }
  }, [allTerms]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Enter on an empty box creates the moment; otherwise it adds a chip.
      if (draft.trim()) commitDraft();
      else handleSubmit();
    } else if (e.key === 'Backspace' && !draft && terms.length > 0) {
      e.preventDefault();
      setTerms(prev => prev.slice(0, -1));
    }
  }, [draft, terms.length, commitDraft, handleSubmit]);

  const { mounted, phase } = useAnimatedUnmount(isOpen);

  if (!mounted) return null;

  const animClass = phase === 'exit' ? overlay.modalExit : overlay.modalEnter;
  const atLimit = terms.length >= MAX_MOMENT_TERMS;
  const canCreate = allTerms(draft).length > 0 && !isCreating;

  return (
    <div className={`${overlay.dialogBackdrop}`}>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-(--color-surface-base)/60 backdrop-blur-sm ${phase === 'exit' ? overlay.backdropExit : overlay.backdropEnter}`}
        onClick={isCreating ? undefined : onClose}
      />

      {/* Dialog */}
      <div className={`relative w-full max-w-lg mx-4 mb-4 sm:mb-0 ${overlay.modal} ${animClass}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-(--color-border-default)">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-(--color-accent)" />
            <h3 className="text-base font-bold text-(--color-text-primary)">New Moment</h3>
          </div>
          <button
            onClick={onClose}
            disabled={isCreating}
            className={`${overlay.closeBtnRight} disabled:opacity-50`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          <label htmlFor="moment-terms" className="block text-sm text-(--color-text-secondary) mb-2">
            What should this moment collect?
          </label>

          {terms.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {terms.map((t, i) => (
                <button
                  key={`${t}-${i}`}
                  type="button"
                  onClick={() => removeTerm(i)}
                  disabled={isCreating}
                  aria-label={`Remove ${t}`}
                  className={`${chip.base} ${chip.inactive} max-w-full disabled:opacity-50`}
                >
                  <span className="truncate">{t}</span>
                  <X size={12} className="shrink-0" />
                </button>
              ))}
            </div>
          )}

          <input
            id="moment-terms"
            ref={inputRef}
            type="text"
            value={draft}
            onChange={e => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commitDraft}
            placeholder={terms.length > 0 ? 'Add another term…' : PLACEHOLDER_EXAMPLES[placeholderIdx]}
            disabled={isCreating || atLimit}
            className={`${input.base} disabled:opacity-50`}
            maxLength={MAX_MOMENT_TERM_LENGTH}
            enterKeyHint={draft.trim() ? 'enter' : 'done'}
          />
          <p className={`${text.caption} mt-2`}>
            {atLimit
              ? `Up to ${MAX_MOMENT_TERMS} terms per moment.`
              : 'Add a few terms, separated by Enter or commas. The moment shows every note related to any of them, and keeps updating as you save more notes.'}
          </p>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-(--color-border-default) flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isCreating}
            className={`${btn.base} ${btn.ghost} text-sm`}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canCreate}
            className={`${btn.base} ${btn.primary} px-5 py-2 text-sm flex items-center gap-2 disabled:cursor-not-allowed`}
          >
            {isCreating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Creating...
              </>
            ) : (
              'Create'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MomentCreationDialog;
