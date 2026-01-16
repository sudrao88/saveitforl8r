import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import MemoryCard from './components/MemoryCard';
import ChatInterface from './components/ChatInterface';
import TopNavigation from './components/TopNavigation';
import FilterBar from './components/FilterBar';
import SettingsModal from './components/SettingsModal';
import LandingPage from './components/LandingPage';
import EmptyState from './components/EmptyState';
import NewMemoryPage from './components/NewMemoryPage';
import { InstallPrompt } from './components/InstallPrompt';

import { useMemories } from './hooks/useMemories';
import { useSettings } from './hooks/useSettings';
import { useMemoryFilters } from './hooks/useMemoryFilters';
import { useServiceWorker } from './hooks/useServiceWorker';
import { ViewMode } from './types';

const App: React.FC = () => {
  const [view, setView] = useState<ViewMode>(ViewMode.FEED);
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);

  const { updateAvailable, updateApp } = useServiceWorker();

  const {
    memories,
    refreshMemories,
    handleDelete,
    handleRetry
  } = useMemories();

  const {
    apiKeySet,
    inputApiKey,
    setInputApiKey,
    isSettingsOpen,
    setIsSettingsOpen,
    saveKey,
    clearKey
  } = useSettings();

  const {
    filterType,
    setFilterType,
    availableTypes,
    filteredMemories,
    clearFilters
  } = useMemoryFilters(memories);

  if (!apiKeySet) {
    return (
      <LandingPage 
        inputApiKey={inputApiKey} 
        setInputApiKey={setInputApiKey} 
        saveKey={saveKey} 
      />
    );
  }

  // Full Page New Memory View
  if (isCaptureOpen) {
    return (
      <NewMemoryPage 
        onClose={() => setIsCaptureOpen(false)}
        onMemoryCreated={() => {
          refreshMemories();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <InstallPrompt />
      {/* Sticky Header Wrapper */}
      <div className="sticky top-0 z-30 bg-gray-900/90 backdrop-blur-md border-b border-gray-800">
          <TopNavigation 
            setView={setView} 
            resetFilters={clearFilters} 
            onSettingsClick={() => setIsSettingsOpen(true)}
            updateAvailable={updateAvailable}
            onUpdateApp={updateApp}
          />

          <FilterBar 
            availableTypes={availableTypes}
            filterType={filterType}
            setFilterType={setFilterType}
            clearFilters={clearFilters}
          />
      </div>

      {/* Grid Content */}
      <main className="flex-1 p-4 sm:p-8 max-w-7xl mx-auto w-full">
        {filteredMemories.length === 0 ? (
          <EmptyState 
            hasMemories={memories.length > 0} 
            clearFilters={clearFilters} 
          />
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-6">
            {filteredMemories.map(mem => (
              <MemoryCard 
                key={mem.id} 
                memory={mem} 
                onDelete={handleDelete} 
                onRetry={handleRetry}
              />
            ))}
          </div>
        )}
      </main>

      {/* Floating Action Button (Extended Material Design Style) */}
      <button 
        onClick={() => setIsCaptureOpen(true)}
        className="fixed bottom-6 right-4 sm:bottom-8 sm:right-8 z-20 h-14 sm:h-16 px-5 sm:px-7 bg-blue-600 text-white rounded-2xl flex items-center gap-3 shadow-2xl hover:bg-blue-700 hover:scale-105 active:scale-95 transition-all duration-300 shadow-blue-900/50"
      >
        <Plus size={28} strokeWidth={3} />
        <span className="font-bold text-lg">New</span>
      </button>

      {view === ViewMode.RECALL && (
        <ChatInterface 
          memories={filteredMemories.filter(m => !m.isDeleting)} 
          onClose={() => setView(ViewMode.FEED)} 
        />
      )}

      {/* Settings Dialog */}
      {isSettingsOpen && (
        <SettingsModal 
            onClose={() => setIsSettingsOpen(false)}
            clearKey={clearKey}
            availableTypes={availableTypes}
            onImportSuccess={refreshMemories}
        />
      )}
    </div>
  );
};

export default App;
