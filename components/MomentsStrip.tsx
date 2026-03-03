/**
 * MomentsStrip.tsx
 *
 * Horizontal strip of user-created Moment bubbles.
 * Includes a "New" button to create moments and an overflow "All" button.
 */

import React from 'react';
import { Plus, ChevronRight } from 'lucide-react';
import MomentBubble from './MomentBubble';
import { Moment, MomentSynthesis } from '../types';

interface MomentsStripProps {
  moments: Moment[];
  synthesesMap: Map<string, MomentSynthesis>;
  onMomentTap: (moment: Moment) => void;
  onNewMoment: () => void;
  onShowAll: () => void;
}

const MomentsStrip: React.FC<MomentsStripProps> = ({
  moments,
  synthesesMap,
  onMomentTap,
  onNewMoment,
  onShowAll,
}) => {
  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-8 py-3">
      <div className="flex items-center gap-4 overflow-x-auto no-scrollbar touch-pan-x">
        {/* New Moment button */}
        <button
          onClick={onNewMoment}
          className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
        >
          <div className="w-16 h-16 rounded-full flex items-center justify-center bg-blue-600/20 border-2 border-dashed border-blue-500/50 transition-all group-hover:border-blue-400 group-hover:bg-blue-600/30 group-active:scale-95">
            <Plus size={24} className="text-blue-400" />
          </div>
          <span className="text-[11px] font-semibold text-blue-400 leading-tight text-center">
            New
          </span>
        </button>

        {moments.map(moment => (
          <MomentBubble
            key={moment.id}
            moment={moment}
            synthesis={synthesesMap.get(moment.id)}
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
