/**
 * MomentsStrip.tsx
 *
 * Horizontal strip of user-created Moment bubbles.
 * Includes a "New" button to create moments and an overflow "All" button.
 */

import React from 'react';
import { Sparkles, ChevronRight, Calendar } from 'lucide-react';
import MomentBubble from './MomentBubble';
import { Moment } from '../types';
import { text, layout } from '../styles/design-system';

interface MomentsStripProps {
  moments: Moment[];
  onMomentTap: (moment: Moment) => void;
  onNewMoment: () => void;
  onShowAll: () => void;
  onCalendarTap: () => void;
  calendarEventCount: number;
  synthesisLoading?: string | null;
}

const MomentsStrip: React.FC<MomentsStripProps> = ({
  moments,
  onMomentTap,
  onNewMoment,
  onShowAll,
  onCalendarTap,
  calendarEventCount,
  synthesisLoading,
}) => {
  return (
    <div className={`${layout.pageContainer} ${layout.section} py-3`}>
      <div className="flex items-start gap-4 overflow-x-auto no-scrollbar touch-pan-x p-1">
        {/* New Moment button — first in strip */}
        <button
          onClick={onNewMoment}
          className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
        >
          <div className="w-16 h-16 rounded-full flex items-center justify-center bg-blue-600/20 border-2 border-dashed border-blue-500/50 transition-all group-hover:border-blue-400 group-hover:bg-blue-600/30 group-active:scale-95">
            <Sparkles size={22} className="text-blue-400" />
          </div>
          <span className="text-xs font-semibold text-blue-400 leading-tight text-center">
            Synthesize
          </span>
        </button>

        {/* Calendar bubble — second in strip */}
        <button
          onClick={onCalendarTap}
          className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
        >
          <div className="w-16 h-16 rounded-full flex items-center justify-center bg-purple-600/20 border-2 border-purple-500/40 ring-2 ring-purple-500/30 transition-all group-hover:ring-purple-400 group-hover:bg-purple-600/30 group-active:scale-95">
            <Calendar size={22} className="text-purple-400" />
          </div>
          <span className="text-xs font-semibold text-purple-400 leading-tight text-center">
            Calendar
          </span>
          <span className="text-xs text-gray-500 leading-tight">
            {calendarEventCount} event{calendarEventCount !== 1 ? 's' : ''}
          </span>
        </button>

        {moments.map(moment => (
          <MomentBubble
            key={moment.id}
            moment={moment}
            onTap={onMomentTap}
            isResynthesizing={synthesisLoading === moment.id}
          />
        ))}

        {/* "All Moments" overflow button */}
        {moments.length > 0 && (
          <button
            onClick={onShowAll}
            className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
          >
            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-gray-800/50 border border-gray-700/50 ring-2 ring-gray-700 transition-all group-hover:ring-gray-500 group-active:scale-95">
              <ChevronRight size={24} className="text-gray-400" />
            </div>
            <span className="text-xs font-semibold text-gray-400 leading-tight text-center">
              All
            </span>
          </button>
        )}
      </div>
    </div>
  );
};

export default React.memo(MomentsStrip);
