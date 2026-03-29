/**
 * MomentsStrip.tsx
 *
 * Horizontal strip of user-created Moment bubbles.
 * Includes a "New" button to create moments and an overflow "All" button.
 */

import React from 'react';
import { Sparkles, ChevronRight, Calendar, CheckSquare, Trash2 } from 'lucide-react';
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
  onTodoTap: () => void;
  todoPendingCount: number;
  synthesisLoading?: Set<string>;
  deletionCandidateCount: number;
  onDeletionCandidatesTap: () => void;
}

const MomentsStrip: React.FC<MomentsStripProps> = ({
  moments,
  onMomentTap,
  onNewMoment,
  onShowAll,
  onCalendarTap,
  calendarEventCount,
  onTodoTap,
  todoPendingCount,
  synthesisLoading,
  deletionCandidateCount,
  onDeletionCandidatesTap,
}) => {
  return (
    <div className={`${layout.pageContainer} py-3`}>
      <div className="flex items-start gap-4 overflow-x-auto no-scrollbar touch-pan-x px-4 sm:px-8 py-1">
        {/* New Moment button — first in strip */}
        <button
          onClick={onNewMoment}
          className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
        >
          <div className="w-16 h-16 rounded-full flex items-center justify-center bg-(--color-accent)/20 border-2 border-dashed border-(--color-accent)/50 transition-all group-hover:border-(--color-accent-hover) group-hover:bg-(--color-accent)/30 group-active:scale-95">
            <Sparkles size={22} className="text-(--color-accent)" />
          </div>
          <span className="text-xs font-semibold text-(--color-accent) leading-tight text-center">
            Synthesize
          </span>
        </button>

        {/* Deletion candidates — shown only when candidates exist */}
        {deletionCandidateCount > 0 && (
          <button
            onClick={onDeletionCandidatesTap}
            className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
          >
            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-(--color-danger)/20 border-2 border-(--color-danger)/40 ring-2 ring-(--color-danger)/30 transition-all group-hover:ring-(--color-danger-hover) group-hover:bg-(--color-danger)/30 group-active:scale-95">
              <Trash2 size={22} className="text-(--color-danger)" />
            </div>
            <span className="text-xs font-semibold text-(--color-danger) leading-tight text-center">
              Cleanup
            </span>
            <span className="text-xs text-(--color-text-tertiary) leading-tight">
              {deletionCandidateCount} stale
            </span>
          </button>
        )}

        {/* Calendar bubble — second in strip */}
        <button
          onClick={onCalendarTap}
          className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
        >
          <div className="w-16 h-16 rounded-full flex items-center justify-center bg-(--color-warning)/20 border-2 border-(--color-warning)/40 ring-2 ring-(--color-warning)/30 transition-all group-hover:ring-(--color-warning) group-hover:bg-(--color-warning)/30 group-active:scale-95">
            <Calendar size={22} className="text-(--color-warning)" />
          </div>
          <span className="text-xs font-semibold text-(--color-warning) leading-tight text-center">
            Calendar
          </span>
          <span className="text-xs text-(--color-text-tertiary) leading-tight">
            {calendarEventCount} event{calendarEventCount !== 1 ? 's' : ''}
          </span>
        </button>

        {/* Todo List bubble — third in strip */}
        <button
          onClick={onTodoTap}
          className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
        >
          <div className="w-16 h-16 rounded-full flex items-center justify-center bg-(--color-success)/20 border-2 border-(--color-success)/40 ring-2 ring-(--color-success)/30 transition-all group-hover:ring-(--color-success) group-hover:bg-(--color-success)/30 group-active:scale-95">
            <CheckSquare size={22} className="text-(--color-success)" />
          </div>
          <span className="text-xs font-semibold text-(--color-success) leading-tight text-center">
            To Do
          </span>
          <span className="text-xs text-(--color-text-tertiary) leading-tight">
            {todoPendingCount} task{todoPendingCount !== 1 ? 's' : ''}
          </span>
        </button>

        {moments.map(moment => (
          <MomentBubble
            key={moment.id}
            moment={moment}
            onTap={onMomentTap}
            isResynthesizing={synthesisLoading?.has(moment.id) ?? false}
          />
        ))}

        {/* "All Moments" overflow button */}
        {moments.length > 0 && (
          <button
            onClick={onShowAll}
            className="flex flex-col items-center gap-1.5 shrink-0 group touch-manipulation"
          >
            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-(--color-surface-raised)/50 border border-(--color-border-subtle) ring-2 ring-(--color-border-default) transition-all group-hover:ring-(--color-text-tertiary) group-active:scale-95">
              <ChevronRight size={24} className="text-(--color-text-secondary)" />
            </div>
            <span className="text-xs font-semibold text-(--color-text-secondary) leading-tight text-center">
              All
            </span>
          </button>
        )}
      </div>
    </div>
  );
};

export default React.memo(MomentsStrip);
