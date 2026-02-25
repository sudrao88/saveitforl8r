/**
 * MomentBubble.tsx
 *
 * Individual story bubble in the Moments strip.
 * Shows a circular avatar with icon, label, and state ring.
 */

import React from 'react';
import { MomentCluster, MomentMeta, MomentSynthesis } from '../types';
import { daysUntilWindowStart } from '../services/cadenceEngine';

interface MomentBubbleProps {
  cluster: MomentCluster;
  meta?: MomentMeta;
  synthesis?: MomentSynthesis;
  onTap: (cluster: MomentCluster) => void;
}

// Map MomentType → emoji icon
function getMomentIcon(type: string, tags: string[]): string {
  switch (type) {
    case 'itinerary':
      return '✈️';
    case 'brief':
      return '📋';
    case 'list': {
      // Contextual icon based on entity type or tags
      const joined = tags.join(' ').toLowerCase();
      if (joined.includes('restaurant') || joined.includes('food') || joined.includes('dining'))
        return '🍜';
      if (joined.includes('movie') || joined.includes('tv') || joined.includes('show'))
        return '🎬';
      if (joined.includes('book') || joined.includes('read'))
        return '📚';
      if (joined.includes('music') || joined.includes('song'))
        return '🎵';
      if (joined.includes('product') || joined.includes('shop'))
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

// Truncate to max chars
function truncateLabel(text: string, max: number = 10): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

const MomentBubble: React.FC<MomentBubbleProps> = ({
  cluster,
  meta,
  synthesis,
  onTap,
}) => {
  const icon = getMomentIcon(cluster.type, cluster.aggregatedTags);
  const label = truncateLabel(cluster.title);
  const noteCount = cluster.noteIds.length;

  // Determine ring state
  const isViewed =
    meta?.lastViewedAt != null &&
    synthesis != null &&
    synthesis.inputHash === cluster.inputHash;

  const isApproaching =
    cluster.clusterCriteria.temporalWindow != null &&
    daysUntilWindowStart(cluster.clusterCriteria.temporalWindow, new Date()) <= 7 &&
    daysUntilWindowStart(cluster.clusterCriteria.temporalWindow, new Date()) >= 0;

  // Sub-label
  let subLabel: string;
  if (cluster.clusterCriteria.temporalWindow) {
    const days = daysUntilWindowStart(
      cluster.clusterCriteria.temporalWindow,
      new Date()
    );
    if (days <= 0) subLabel = 'Now';
    else if (days === 1) subLabel = 'Tomorrow';
    else subLabel = `${days} days`;
  } else {
    subLabel = `${noteCount} note${noteCount !== 1 ? 's' : ''}`;
  }

  // Ring classes
  let ringClass: string;
  if (isApproaching) {
    ringClass = 'ring-2 ring-amber-400 animate-pulse';
  } else if (isViewed) {
    ringClass = 'ring-2 ring-gray-600';
  } else {
    ringClass = 'ring-2 ring-blue-500';
  }

  // Gradient background based on type
  const bgGradient = isApproaching
    ? 'bg-gradient-to-br from-amber-900/60 to-amber-800/40'
    : 'bg-gradient-to-br from-gray-800 to-gray-700';

  return (
    <button
      onClick={() => onTap(cluster)}
      className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
    >
      <div
        className={`w-16 h-16 rounded-full flex items-center justify-center ${bgGradient} ${ringClass} transition-all group-active:scale-95`}
      >
        <span className="text-2xl" role="img" aria-label={cluster.type}>
          {icon}
        </span>
      </div>
      <span className="text-[11px] font-semibold text-gray-300 leading-tight text-center max-w-[72px] truncate">
        {label}
      </span>
      <span className="text-[10px] text-gray-500 leading-tight">
        {subLabel}
      </span>
    </button>
  );
};

export default MomentBubble;
