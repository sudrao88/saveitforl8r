/**
 * SuggestedMomentBubble.tsx
 *
 * A moment the app suggests from a cluster of similar notes that share a
 * keyword. Dashed ring to set it apart from the user's own moments; tapping
 * it opens a preview where it can be added or dismissed.
 */

import React from 'react';
import { Sparkles } from 'lucide-react';
import { text } from '../styles/design-system';
import { MomentSuggestion } from '../utils/momentSuggestions';

interface SuggestedMomentBubbleProps {
  suggestion: MomentSuggestion;
  onTap: (suggestion: MomentSuggestion) => void;
}

const truncateLabel = (label: string, max: number = 10): string =>
  label.length > max ? label.slice(0, max - 1) + '…' : label;

const SuggestedMomentBubble: React.FC<SuggestedMomentBubbleProps> = ({ suggestion, onTap }) => {
  const count = suggestion.matches.length;
  return (
    <button
      onClick={() => onTap(suggestion)}
      className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
      aria-label={`Suggested moment: ${suggestion.label}, ${count} notes`}
    >
      <div className="w-16 h-16 rounded-full flex items-center justify-center bg-(--color-surface-raised)/50 border-2 border-dashed border-(--color-accent)/60 transition-all group-hover:border-(--color-accent-hover) group-active:scale-95">
        <Sparkles size={20} className="text-(--color-accent)" />
      </div>
      <span className="text-xs font-semibold text-(--color-text-secondary) leading-tight text-center max-w-18 truncate">
        {truncateLabel(suggestion.label)}
      </span>
      <span className={`${text.caption} text-(--color-accent) leading-tight`}>Suggested</span>
    </button>
  );
};

export default React.memo(SuggestedMomentBubble);
