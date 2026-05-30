/**
 * MomentBubble.tsx
 *
 * Individual story bubble in the Moments strip.
 * Shows a circular avatar with icon, label, and note count.
 * Displays a pulsing "Creating..." state for pending moments.
 */

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Moment } from '../types';
import { text } from '../styles/design-system';

interface MomentBubbleProps {
  moment: Moment;
  onTap: (moment: Moment) => void;
  isResynthesizing?: boolean;
}

export function getMomentIcon(type: string, objective: string): string {
  switch (type) {
    case 'itinerary':
      return '✈️';
    case 'brief':
      return '📋';
    case 'list': {
      const lower = objective.toLowerCase();
      if (lower.includes('restaurant') || lower.includes('food') || lower.includes('café') || lower.includes('cafe') || lower.includes('dining'))
        return '🍜';
      if (lower.includes('movie') || lower.includes('tv') || lower.includes('show'))
        return '🎬';
      if (lower.includes('book') || lower.includes('read'))
        return '📚';
      if (lower.includes('music') || lower.includes('song'))
        return '🎵';
      if (lower.includes('product') || lower.includes('shop'))
        return '🛍️';
      return '📝';
    }
    case 'dashboard':
      return '📊';
    case 'curriculum':
      return '🎓';
    case 'gift-guide':
      return '🎁';
    case 'meal-plan':
      return '🍳';
    case 'general':
    default:
      return '💡';
  }
}

function truncateLabel(text: string, max: number = 10): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

const MomentBubble: React.FC<MomentBubbleProps> = ({
  moment,
  onTap,
  isResynthesizing = false,
}) => {
  const isPending = moment.isPending || isResynthesizing;
  const hasError = moment.processingError;
  const [wasPending, setWasPending] = useState(moment.isPending ?? false);
  const [showGlow, setShowGlow] = useState(false);

  // Detect pending→complete transition during render (React-approved pattern)
  if (wasPending !== (moment.isPending ?? false)) {
    setWasPending(moment.isPending ?? false);
    if (wasPending && !moment.isPending && !hasError) {
      setShowGlow(true);
    }
  }

  // Auto-clear glow after animation
  useEffect(() => {
    if (!showGlow) return;
    const timer = setTimeout(() => setShowGlow(false), 800);
    return () => clearTimeout(timer);
  }, [showGlow]);

  const icon = moment.emoji || getMomentIcon(moment.type, moment.objective);
  const label = isPending
    ? truncateLabel(moment.objective, 10)
    : truncateLabel(moment.title);
  const noteCount = moment.noteIds.length;

  // Ring states
  let ringClass: string;
  if (isPending) {
    ringClass = 'ring-2 ring-(--color-accent) animate-pulse';
  } else if (hasError) {
    ringClass = 'ring-2 ring-(--color-danger)';
  } else {
    const hasUnseen = moment.inputHash !== moment.lastSeenInputHash;
    ringClass = hasUnseen
      ? 'ring-2 ring-(--color-accent)'
      : 'ring-2 ring-(--color-border-default)';
  }

  return (
    <button
      onClick={() => onTap(moment)}
      className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
    >
      <div
        className={`w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-br from-(--color-surface-raised) to-(--color-surface-raised) ${ringClass} transition-all group-active:scale-95 ${showGlow ? 'animate-glow-settle' : ''}`}
      >
        {isPending ? (
          <Loader2 size={24} className="text-(--color-accent) animate-spin" />
        ) : (
          <span className="text-2xl" role="img" aria-label={moment.type}>
            {icon}
          </span>
        )}
      </div>
      <span className="text-xs font-semibold text-(--color-text-secondary) leading-tight text-center max-w-[72px] truncate">
        {label}
      </span>
      {isPending ? (
        <span className={`${text.caption} text-(--color-accent) leading-tight`}>Creating…</span>
      ) : hasError ? (
        <span className={`${text.caption} text-(--color-danger) leading-tight`}>Failed</span>
      ) : (
        <span className={`${text.caption} leading-tight`}>
          {noteCount} note{noteCount !== 1 ? 's' : ''}
        </span>
      )}
    </button>
  );
};

export default React.memo(MomentBubble);
