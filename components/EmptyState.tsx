import React from 'react';

interface EmptyStateProps {
  hasMemories: boolean;
  clearFilters: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ hasMemories, clearFilters }) => {
  return (
    <div className="h-[60vh] flex flex-col items-center justify-center text-center px-6 relative">
      {hasMemories ? (
        <div className="flex flex-col items-center animate-in fade-in zoom-in-95">
          <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center mb-4 border border-gray-700">
             <span className="text-3xl">🔍</span>
          </div>
          <h3 className="text-xl font-bold text-gray-200">No matching memories</h3>
          <p className="text-gray-500 mt-2">Try adjusting your filters.</p>
          <button 
            onClick={clearFilters}
            className="mt-6 px-4 py-2 bg-gray-800 text-blue-400 text-sm font-bold rounded-xl border border-gray-700 hover:bg-gray-700 transition-colors"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <>
            <h2 className="text-3xl font-black text-white mb-2 tracking-tight">
              🧠 Your AI-Powered Second Brain
            </h2>
            <p className="text-gray-400 text-base mb-6 max-w-sm">
              Drop anything in. We'll handle the rest.
            </p>

            <div className="grid grid-cols-2 gap-3 max-w-md mb-8 text-left">
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-3">
                <div className="text-lg mb-1">✨</div>
                <h3 className="text-sm font-bold text-gray-200">AI Enrichment</h3>
                <p className="text-xs text-gray-500 leading-snug">Auto-summarized, tagged &amp; classified</p>
              </div>
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-3">
                <div className="text-lg mb-1">🔮</div>
                <h3 className="text-sm font-bold text-gray-200">Brain Search</h3>
                <p className="text-xs text-gray-500 leading-snug">Ask questions, get answers from your notes</p>
              </div>
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-3">
                <div className="text-lg mb-1">🧩</div>
                <h3 className="text-sm font-bold text-gray-200">Synthesize</h3>
                <p className="text-xs text-gray-500 leading-snug">Turn notes into itineraries, briefs &amp; more</p>
              </div>
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-3">
                <div className="text-lg mb-1">🔒</div>
                <h3 className="text-sm font-bold text-gray-200">Private &amp; Secure</h3>
                <p className="text-xs text-gray-500 leading-snug">256-bit encrypted, your eyes only</p>
              </div>
            </div>

            <p className="text-gray-500 text-sm">
              Start by dropping a thought below 👇
            </p>
        </>
      )}
    </div>
  );
};

export default EmptyState;
