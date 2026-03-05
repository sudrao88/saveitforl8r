import React from 'react';
import { X } from 'lucide-react';
import { Moment } from '../types';
import { getMomentIcon } from './MomentBubble';

interface AllMomentsSheetProps {
  moments: Moment[];
  onClose: () => void;
  onSelectMoment: (moment: Moment) => void;
}

const AllMomentsSheet: React.FC<AllMomentsSheetProps> = ({
  moments,
  onClose,
  onSelectMoment,
}) => (
  <div className="fixed inset-0 z-[100] bg-gray-950/95 backdrop-blur-md flex flex-col animate-in fade-in duration-300">
    <div className="sticky top-0 z-10 px-4 py-3 border-b border-gray-800 flex items-center justify-between bg-gray-950/80 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          className="p-3 -ml-3 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white transition-colors active:scale-95"
        >
          <X size={24} />
        </button>
        <h2 className="text-lg font-bold text-gray-100">All Moments</h2>
      </div>
      <span className="text-xs text-gray-500">{moments.length} moments</span>
    </div>
    <div className="flex-1 overflow-y-auto p-4 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-3">
        {moments.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400">
              No moments yet. Tap "New" to create one from your notes.
            </p>
          </div>
        ) : (
          moments.map(moment => (
            <button
              key={moment.id}
              onClick={() => onSelectMoment(moment)}
              className="w-full text-left p-4 bg-gray-800/50 border border-gray-700/50 rounded-xl hover:border-gray-600/50 transition-all active:scale-[0.98] flex items-center gap-4"
            >
              <div className="w-12 h-12 rounded-full bg-gray-700/50 flex items-center justify-center text-xl shrink-0">
                {moment.emoji || getMomentIcon(moment.type, moment.objective)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-200 truncate">
                  {moment.title}
                </p>
                <p className="text-xs text-gray-400">
                  {moment.noteIds.length} notes · {moment.type}
                </p>
                <p className="text-xs text-gray-500 truncate mt-0.5">
                  {moment.objective}
                </p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  </div>
);

export default AllMomentsSheet;
