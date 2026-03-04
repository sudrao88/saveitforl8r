/**
 * MomentCreationDialog.tsx
 *
 * Modal dialog for creating a new moment.
 * User enters an objective/intention and the system creates a synthesis.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { X, Loader2, Sparkles } from 'lucide-react';

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
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={isCreating ? undefined : onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-lg mx-4 mb-4 sm:mb-0 bg-gray-900 border border-gray-700/50 rounded-2xl shadow-2xl animate-in slide-in-from-bottom duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-blue-400" />
            <h3 className="text-base font-bold text-gray-100">New Moment</h3>
          </div>
          <button
            onClick={onClose}
            disabled={isCreating}
            className="p-2 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          <label className="block text-sm text-gray-300 mb-2">
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
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 text-sm disabled:opacity-50"
            maxLength={1000}
          />
          <p className="text-xs text-gray-500 mt-2">
            We'll search through all your notes and build a synthesis matching this objective.
          </p>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isCreating}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!objective.trim() || isCreating}
            className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
