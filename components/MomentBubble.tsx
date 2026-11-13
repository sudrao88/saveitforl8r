/**
 * MomentBubble.tsx
 *
 * Individual story bubble in the Moments strip: the moment's emoji, title and
 * how many notes currently match it. A moment still waiting for its term
 * vectors (created offline, or the request failed) shows a waiting state.
 */

import React from 'react';
import { Loader2, CloudOff } from 'lucide-react';
import { Moment } from '../types';
import { text } from '../styles/design-system';
import { canMatchMoment } from '../utils/momentMatching';

interface MomentBubbleProps {
  moment: Moment;
  noteCount: number;
  onTap: (moment: Moment) => void;
  isEmbedding?: boolean;
}

/** Shown before a moment has an emoji (not yet embedded). */
export const FALLBACK_MOMENT_EMOJI = '✨';

function truncateLabel(label: string, max: number = 10): string {
  return label.length > max ? label.slice(0, max - 1) + '…' : label;
}

const MomentBubble: React.FC<MomentBubbleProps> = ({
  moment,
  noteCount,
  onTap,
  isEmbedding = false,
}) => {
  const isWaiting = !canMatchMoment(moment);

  const ringClass = isEmbedding
    ? 'ring-2 ring-(--color-accent) animate-pulse'
    : isWaiting
      ? 'ring-2 ring-(--color-warning)'
      : 'ring-2 ring-(--color-border-default)';

  return (
    <button
      onClick={() => onTap(moment)}
      className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
    >
      <div
        className={`w-16 h-16 rounded-full flex items-center justify-center bg-(--color-surface-raised) ${ringClass} transition-all group-active:scale-95`}
      >
        {isEmbedding ? (
          <Loader2 size={24} className="text-(--color-accent) animate-spin" />
        ) : isWaiting ? (
          <CloudOff size={22} className="text-(--color-warning)" />
        ) : (
          <span className="text-2xl" role="img" aria-hidden="true">
            {moment.emoji || FALLBACK_MOMENT_EMOJI}
          </span>
        )}
      </div>
      <span className="text-xs font-semibold text-(--color-text-secondary) leading-tight text-center max-w-18 truncate">
        {truncateLabel(moment.title)}
      </span>
      {isEmbedding ? (
        <span className={`${text.caption} text-(--color-accent) leading-tight`}>Creating…</span>
      ) : isWaiting ? (
        <span className={`${text.caption} text-(--color-warning) leading-tight`}>Waiting</span>
      ) : (
        <span className={`${text.caption} leading-tight`}>
          {noteCount} note{noteCount !== 1 ? 's' : ''}
        </span>
      )}
    </button>
  );
};

export default React.memo(MomentBubble);
