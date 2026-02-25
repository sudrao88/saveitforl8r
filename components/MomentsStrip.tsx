/**
 * MomentsStrip.tsx
 *
 * Instagram Stories-style horizontal strip of Moment preview bubbles.
 * Sits between TopNavigation and FilterBar in the sticky header.
 */

import React from 'react';
import { ChevronRight } from 'lucide-react';
import MomentBubble from './MomentBubble';
import { MomentCluster, MomentMeta, MomentSynthesis } from '../types';

interface MomentsStripProps {
  moments: MomentCluster[];
  metaMap: Map<string, MomentMeta>;
  synthesesMap: Map<string, MomentSynthesis>;
  onMomentTap: (cluster: MomentCluster) => void;
  onShowAll: () => void;
}

const MomentsStrip: React.FC<MomentsStripProps> = ({
  moments,
  metaMap,
  synthesesMap,
  onMomentTap,
  onShowAll,
}) => {
  if (moments.length === 0) return null;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-8 py-3">
      <div className="flex items-center gap-4 overflow-x-auto no-scrollbar touch-pan-x">
        {moments.map(cluster => (
          <MomentBubble
            key={cluster.id}
            cluster={cluster}
            meta={metaMap.get(cluster.id)}
            synthesis={synthesesMap.get(cluster.id)}
            onTap={onMomentTap}
          />
        ))}

        {/* "All Moments" overflow button */}
        <button
          onClick={onShowAll}
          className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
        >
          <div className="w-16 h-16 rounded-full flex items-center justify-center bg-gray-800/50 border border-gray-700/50 ring-2 ring-gray-700 transition-all group-hover:ring-gray-500 group-active:scale-95">
            <ChevronRight size={24} className="text-gray-400" />
          </div>
          <span className="text-[11px] font-semibold text-gray-400 leading-tight">
            All
          </span>
          <span className="text-[10px] text-gray-600 leading-tight">
            &nbsp;
          </span>
        </button>
      </div>
    </div>
  );
};

export default MomentsStrip;
