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
            <h2 className="text-3xl font-black text-white mb-4 tracking-tight">Build your knowledge base</h2>
            <p className="text-gray-400 max-w-md text-lg leading-relaxed mb-8">
              Capture thoughts, links, and images.<br className="hidden sm:block" />
              SaveItForL8R organizes them for you.
            </p>

            {/* Fun decorative element pointing to FAB */}
            <div className="fixed bottom-28 right-8 sm:bottom-32 sm:right-24 z-10 animate-bounce pointer-events-none opacity-50 sm:opacity-100">
                <svg width="100" height="100" viewBox="0 0 100 100" fill="none" className="text-gray-600 rotate-12 drop-shadow-sm">
                    <path d="M20 20 C 50 20, 80 40, 90 90" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                    <path d="M90 90 L 65 80" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                    <path d="M90 90 L 100 65" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                </svg>
            </div>
        </>
      )}
    </div>
  );
};

export default EmptyState;
