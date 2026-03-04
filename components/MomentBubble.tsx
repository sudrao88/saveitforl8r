/**
 * MomentBubble.tsx
 *
 * Individual story bubble in the Moments strip.
 * Shows a circular avatar with icon, label, and note count.
 */

import React from 'react';
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
  const icon = getMomentIcon(moment.type, moment.objective);
  const label = truncateLabel(moment.title);
  const noteCount = moment.noteIds.length;

  // Determine ring state: blue if has new notes since last synthesis, grey if up-to-date
  const hasNewNotes = synthesis
    ? synthesis.inputHash !== moment.inputHash
    : true;

  const ringClass = hasNewNotes
    ? 'ring-2 ring-blue-500'
    : 'ring-2 ring-gray-600';

  return (
    <button
      onClick={() => onTap(moment)}
      className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
    >
      <div
        className={`w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-700 ${ringClass} transition-all group-active:scale-95`}
      >
        <span className="text-2xl" role="img" aria-label={moment.type}>
          {icon}
        </span>
      </div>
      <span className="text-[11px] font-semibold text-gray-300 leading-tight text-center max-w-[72px] truncate">
        {label}
      </span>
      <span className="text-[10px] text-gray-500 leading-tight">
        {noteCount} note{noteCount !== 1 ? 's' : ''}
      </span>
    </button>
  );
};

export default MomentBubble;
