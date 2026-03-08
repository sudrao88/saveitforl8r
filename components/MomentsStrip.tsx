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

interface MomentsStripProps {
  moments: Moment[];
  onMomentTap: (moment: Moment) => void;
  onNewMoment: () => void;
  onShowAll: () => void;
  onCalendarTap: () => void;
  calendarEventCount: number;
}

const MomentsStrip: React.FC<MomentsStripProps> = ({
  moments,
  onMomentTap,
  onNewMoment,
  onShowAll,
  onCalendarTap,
  calendarEventCount,
}) => {
  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-8 py-3">
      <div className="flex items-start gap-4 overflow-x-auto no-scrollbar touch-pan-x p-1">
        {/* New Moment button — first in strip */}
        <button
          onClick={onNewMoment}
          className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
        >
          <div className="w-16 h-16 rounded-full flex items-center justify-center bg-blue-600/20 border-2 border-dashed border-blue-500/50 transition-all group-hover:border-blue-400 group-hover:bg-blue-600/30 group-active:scale-95">
            <Sparkles size={22} className="text-blue-400" />
          </div>
          <span className="text-[11px] font-semibold text-blue-400 leading-tight text-center">
            Synthesize
          </span>
        </button>

        {/* Calendar bubble — second in strip */}
        <button
          onClick={onCalendarTap}
          className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation relative"
        >
          <div className="w-16 h-16 rounded-full flex items-center justify-center bg-purple-600/20 border-2 border-purple-500/40 ring-2 ring-purple-500/30 transition-all group-hover:ring-purple-400 group-hover:bg-purple-600/30 group-active:scale-95">
            <Calendar size={22} className="text-purple-400" />
          </div>
          {calendarEventCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-purple-500 text-white text-[10px] font-bold rounded-full px-1 shadow-lg">
              {calendarEventCount > 99 ? '99+' : calendarEventCount}
            </span>
          )}
          <span className="text-[11px] font-semibold text-purple-400 leading-tight text-center">
            Calendar
          </span>
        </button>

        {moments.map(moment => (
          <MomentBubble
            key={moment.id}
            moment={moment}
            onTap={onMomentTap}
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
            <span className="text-[11px] font-semibold text-gray-400 leading-tight text-center">
              All
            </span>
          </button>
        )}
      </div>
    </div>
  );
};

export default MomentsStrip;
