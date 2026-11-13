import React from 'react';
import { X } from 'lucide-react';
import { Moment } from '../types';
import { FALLBACK_MOMENT_EMOJI } from './MomentBubble';
import { overlay, card } from '../styles/design-system';
import { canMatchMoment } from '../utils/momentMatching';

interface AllMomentsSheetProps {
  moments: Moment[];
  matchCounts: Map<string, number>;
  onClose: () => void;
  onSelectMoment: (moment: Moment) => void;
}

const AllMomentsSheet: React.FC<AllMomentsSheetProps> = ({
  moments,
  matchCounts,
  onClose,
  onSelectMoment,
}) => (
  <div className={overlay.sheetBase}>
    <div className={overlay.sheetHeader}>
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          className={overlay.closeBtn}
        >
          <X size={24} />
        </button>
        <h2 className="text-lg font-bold text-(--color-text-primary)">All Moments</h2>
      </div>
      <span className="text-xs text-(--color-text-tertiary)">{moments.length} moments</span>
    </div>
    <div className="flex-1 overflow-y-auto p-4 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-3">
        {moments.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-(--color-text-secondary)">
              No moments yet. Tap "New" to create one from your notes.
            </p>
          </div>
        ) : (
          moments.map(moment => {
            const count = matchCounts.get(moment.id) ?? 0;
            return (
              <button
                key={moment.id}
                onClick={() => onSelectMoment(moment)}
                className={`w-full text-left p-4 ${card.elevated} hover:border-(--color-border-subtle) transition-all active:scale-[0.98] flex items-center gap-4`}
              >
                <div className="w-12 h-12 rounded-full bg-(--color-surface-raised)/50 flex items-center justify-center text-xl shrink-0">
                  {moment.emoji || FALLBACK_MOMENT_EMOJI}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-(--color-text-primary) truncate">
                    {moment.title}
                  </p>
                  <p className="text-xs text-(--color-text-secondary)">
                    {canMatchMoment(moment)
                      ? `${count} note${count !== 1 ? 's' : ''}`
                      : 'Waiting for connection'}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  </div>
);

export default AllMomentsSheet;
