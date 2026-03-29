/**
 * MomentCreationDialog.tsx
 *
 * Modal dialog for creating a new moment.
 * User enters an objective/intention and the system creates a synthesis.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { X, Loader2, Sparkles } from 'lucide-react';
import { btn, overlay } from '../styles/design-system';

interface MomentCreationDialogProps {
  isOpen: boolean;
  isCreating: boolean;
  onClose: () => void;
  onCreate: (objective: string) => Promise<void>;
}

const PLACEHOLDER_EXAMPLES = [
  'Build an itinerary for my Singapore trip',
  'Cafés in Bangalore',
  'Make notes on agentic coding',
  'Plan my weekend meal prep',
  'Gift ideas for Mom\'s birthday',
];

const MomentCreationDialog: React.FC<MomentCreationDialogProps> = ({
  isOpen,
  isCreating,
  onClose,
  onCreate,
}) => {
  const [objective, setObjective] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [placeholderIdx] = useState(() => Math.floor(Math.random() * PLACEHOLDER_EXAMPLES.length));

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setObjective('');
    }
  }, [isOpen]);

  const handleSubmit = useCallback(async () => {
    const trimmed = objective.trim();
    if (!trimmed || isCreating) return;
    await onCreate(trimmed);
  }, [objective, isCreating, onCreate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-(--z-toast) flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={isCreating ? undefined : onClose}
      />

      {/* Dialog */}
      <div className={`relative w-full max-w-lg mx-4 mb-4 sm:mb-0 ${overlay.modal} animate-in slide-in-from-bottom duration-(--duration-normal)`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-(--color-border-default)">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-(--color-accent)" />
            <h3 className="text-base font-bold text-(--color-text-primary)">New Moment</h3>
          </div>
          <button
            onClick={onClose}
            disabled={isCreating}
            className="p-2 rounded-full hover:bg-(--color-surface-raised) text-(--color-text-secondary) hover:text-(--color-text-primary) transition-colors disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          <label className="block text-sm text-(--color-text-secondary) mb-2">
            What would you like to synthesize from your notes?
          </label>
          <input
            ref={inputRef}
            type="text"
            value={objective}
            onChange={e => setObjective(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={PLACEHOLDER_EXAMPLES[placeholderIdx]}
            disabled={isCreating}
            className="w-full px-4 py-3 bg-(--color-surface-raised) border border-(--color-border-default) rounded-xl text-(--color-text-primary) placeholder-(--color-text-tertiary) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/50 focus:border-(--color-accent)/50 text-sm disabled:opacity-50"
            maxLength={1000}
          />
          <p className="text-xs text-(--color-text-tertiary) mt-2">
            We'll search through all your notes and build a synthesis matching this objective.
          </p>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-(--color-border-default) flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isCreating}
            className="px-4 py-2 text-sm text-(--color-text-secondary) hover:text-(--color-text-primary) transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!objective.trim() || isCreating}
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
