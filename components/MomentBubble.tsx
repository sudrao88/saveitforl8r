/**
 * MomentBubble.tsx
 *
 * Individual story bubble in the Moments strip.
 * Shows a circular avatar with icon, label, and note count.
 * Displays a pulsing "Creating..." state for pending moments.
 */

import React, { useRef, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Moment, MomentSynthesis } from '../types';

interface MomentBubbleProps {
  moment: Moment;
  synthesis?: MomentSynthesis;
  onTap: (moment: Moment) => void;
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
  synthesis,
  onTap,
}) => {
  const isPending = moment.isPending;
  const hasError = moment.processingError;
  const wasPendingRef = useRef(isPending);
  const [showGlow, setShowGlow] = useState(false);

  useEffect(() => {
    if (wasPendingRef.current && !isPending && !hasError) {
      setShowGlow(true);
      const timer = setTimeout(() => setShowGlow(false), 800);
      return () => clearTimeout(timer);
    }
    wasPendingRef.current = isPending;
  }, [isPending, hasError]);

  const icon = moment.emoji || getMomentIcon(moment.type, moment.objective);
  const label = isPending
    ? truncateLabel(moment.objective, 10)
    : truncateLabel(moment.title);
  const noteCount = moment.noteIds.length;

  // Ring states
  let ringClass: string;
  if (isPending) {
    ringClass = 'ring-2 ring-blue-500 animate-pulse';
  } else if (hasError) {
    ringClass = 'ring-2 ring-red-500';
  } else {
    const hasNewNotes = synthesis
      ? synthesis.inputHash !== moment.inputHash
      : true;
    ringClass = hasNewNotes
      ? 'ring-2 ring-blue-500'
      : 'ring-2 ring-gray-600';
  }

  return (
    <button
      onClick={() => onTap(moment)}
      className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
    >
      <div
        className={`w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-700 ${ringClass} transition-all group-active:scale-95 ${showGlow ? 'animate-glow-settle' : ''}`}
      >
        {isPending ? (
          <Loader2 size={24} className="text-blue-400 animate-spin" />
        ) : (
          <span className="text-2xl" role="img" aria-label={moment.type}>
            {icon}
          </span>
        )}
      </div>
      <span className="text-[11px] font-semibold text-gray-300 leading-tight text-center max-w-[72px] truncate">
        {label}
      </span>
      {isPending ? (
        <span className="text-[10px] text-blue-400 leading-tight">Creating…</span>
      ) : hasError ? (
        <span className="text-[10px] text-red-400 leading-tight">Failed</span>
      ) : (
        <span className="text-[10px] text-gray-500 leading-tight">
          {noteCount} note{noteCount !== 1 ? 's' : ''}
        </span>
      )}
    </button>
  );
};

export default MomentBubble;
