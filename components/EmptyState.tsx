import React from 'react';
import { btn, card, text } from '../styles/design-system';

interface EmptyStateProps {
  hasMemories: boolean;
  clearFilters: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ hasMemories, clearFilters }) => {
  return (
    <div className="h-[60vh] flex flex-col items-center justify-center text-center px-6 relative">
      {hasMemories ? (
        <div className="flex flex-col items-center animate-in fade-in zoom-in-95">
          <div className="w-16 h-16 bg-(--color-surface-raised) rounded-2xl flex items-center justify-center mb-4 border border-(--color-border-default)">
             <span className="text-3xl">🔍</span>
          </div>
          <h3 className="text-xl font-bold text-(--color-text-primary)">No matching memories</h3>
          <p className={`${text.body} mt-2`}>Try adjusting your filters.</p>
          <button
            onClick={clearFilters}
            className={`${btn.base} ${btn.secondary} mt-6 text-(--color-accent)`}
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <>
            <h2 className="text-3xl font-black text-(--color-text-primary) mb-2 tracking-tight">
              🧠 Your AI-Powered Second Brain
            </h2>
            <p className="text-(--color-text-secondary) text-base mb-6 max-w-sm">
              Drop anything in. We'll handle the rest.
            </p>

            <div className="grid grid-cols-2 gap-3 max-w-md mb-8 text-left">
              <div className={`${card.base} px-3 py-3`}>
                <div className="text-lg mb-1">✨</div>
                <h3 className={text.subheading}>AI Enrichment</h3>
                <p className={`${text.caption} leading-snug`}>Auto-summarized, tagged &amp; classified</p>
              </div>
              <div className={`${card.base} px-3 py-3`}>
                <div className="text-lg mb-1">🔮</div>
                <h3 className={text.subheading}>Brain Search</h3>
                <p className={`${text.caption} leading-snug`}>Ask questions, get answers from your notes</p>
              </div>
              <div className={`${card.base} px-3 py-3`}>
                <div className="text-lg mb-1">🧩</div>
                <h3 className={text.subheading}>Synthesize</h3>
                <p className={`${text.caption} leading-snug`}>Turn notes into itineraries, briefs &amp; more</p>
              </div>
              <div className={`${card.base} px-3 py-3`}>
                <div className="text-lg mb-1">🔒</div>
                <h3 className={text.subheading}>Private &amp; Secure</h3>
                <p className={`${text.caption} leading-snug`}>256-bit encrypted, your eyes only</p>
              </div>
            </div>

            <p className={text.body}>
              Start by dropping a thought below 👇
            </p>
        </>
      )}
    </div>
  );
};

export default EmptyState;
