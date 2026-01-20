import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw } from 'lucide-react'; // Added RefreshCw icon
import MemoryCard from './components/MemoryCard';
import ChatInterface from './components/ChatInterface';
import TopNavigation from './components/TopNavigation';
import FilterBar from './components/FilterBar';
import SettingsModal from './components/SettingsModal';
import EmptyState from './components/EmptyState';
import NewMemoryPage from './components/NewMemoryPage';
import ApiKeyModal from './components/ApiKeyModal';
import { InstallPrompt } from './components/InstallPrompt';

import { useMemories } from './hooks/useMemories';
import { useSettings } from './hooks/useSettings';
import { useMemoryFilters } from './hooks/useMemoryFilters';
import { useServiceWorker } from './hooks/useServiceWorker';
import { useShareReceiver } from './hooks/useShareReceiver';
import { useSync } from './hooks/useSync';
import { ViewMode } from './types';
import { initGA, logPageView, logEvent } from './services/analytics';

const App: React.FC = () => {
  const [view, setView] = useState<ViewMode>(ViewMode.FEED);
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [syncError, setSyncError] = useState(false); // Track sync errors

  const { updateAvailable, updateApp, appVersion } = useServiceWorker();
  const { shareData, clearShareData } = useShareReceiver();
  const { isLinked, sync, initialize } = useSync();

  const {
    memories,
    refreshMemories,
    handleDelete,
    handleRetry,
    createMemory 
  } = useMemories();

  useEffect(() => {
    initGA();
    logPageView('home');
    
    const linked = isLinked();
    console.log(`[App] Mount check. Linked: ${linked}`);

    if (linked) {
        initialize(() => {
            console.log('[App] Auth initialized. Attempting initial sync...');
            sync().then(() => {
                console.log('[App] Initial sync success.');
                refreshMemories();
                setSyncError(false);
            }).catch(err => {
                console.error('[App] Initial sync failed (likely popup blocked):', err);
                setSyncError(true); // Show manual sync button
            });
        });
        
        const intervalId = setInterval(() => {
            sync().then(() => {
                refreshMemories();
                setSyncError(false);
            }).catch(err => {
               // Silent fail on periodic sync
               console.warn('[App] Periodic sync skipped:', err);
            });
        }, 5 * 60 * 1000);

        return () => clearInterval(intervalId);
    }
  }, []); 

  // If share data arrives, open the capture modal immediately
  useEffect(() => {
    if (shareData) {
      logEvent('Share', 'Received', 'External Share');
      setIsCaptureOpen(true);
    }
  }, [shareData]);


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

  const handleSaveApiKey = async (key: string) => {
    saveKey(key);
    logEvent('Settings', 'API Key Set', 'Onboarding');
    setIsApiKeyModalOpen(false);
    
    const pendingIds = memories.filter(m => m.isPending || m.processingError).map(m => m.id);
    for (const id of pendingIds) {
        await handleRetry(id);
    }
  };

  const handleManualSync = () => {
      setSyncError(false);
      // Force sync with user gesture
      sync().then(refreshMemories).catch(e => {
          console.error("Manual sync error", e);
          setSyncError(true);
      });
  };

  if (isCaptureOpen) {
    return (
      <NewMemoryPage 
        onClose={() => {
          setIsCaptureOpen(false);
          logEvent('Memory', 'Capture Cancelled');
          if (shareData) clearShareData();
        }}
        onCreate={async (text, attachments, tags, location) => {
            await createMemory(text, attachments, tags, location);
            refreshMemories();
            logEvent('Memory', 'Created');
            if (shareData) clearShareData();
        }}
        onMemoryCreated={() => {}} 
        initialContent={shareData || undefined}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <InstallPrompt />
      <div className="sticky top-0 z-30 bg-gray-900/90 backdrop-blur-md border-b border-gray-800">
          <TopNavigation 
            setView={(newView) => {
                setView(newView);
                logEvent('Navigation', 'View Changed', newView);
            }} 
            resetFilters={() => {
                clearFilters();
                logEvent('Filter', 'Cleared');
            }} 
            onSettingsClick={() => {
                setIsSettingsOpen(true);
                logEvent('Navigation', 'Settings Opened');
            }}
            updateAvailable={updateAvailable}
            onUpdateApp={() => {
                updateApp();
                logEvent('App', 'Updated');
            }}
          />

          <FilterBar 
            availableTypes={availableTypes}
            filterType={filterType}
            setFilterType={(type) => {
                setFilterType(type);
                if (type) logEvent('Filter', 'Applied', type);
            }}
            clearFilters={() => {
                clearFilters();
                logEvent('Filter', 'Cleared');
            }}
          />
      </div>

      <main className="flex-1 p-4 sm:p-8 max-w-7xl mx-auto w-full relative">
        {/* Sync Error / Manual Trigger Indicator */}
        {syncError && isLinked() && (
            <button 
                onClick={handleManualSync}
                className="absolute top-0 right-4 -mt-2 z-10 flex items-center gap-2 bg-yellow-900/80 text-yellow-200 px-3 py-1.5 rounded-full text-xs font-medium border border-yellow-700/50 hover:bg-yellow-900 transition-colors animate-in fade-in"
            >
                <RefreshCw size={12} />
                Sync Paused (Tap to Resume)
            </button>
        )}

        {filteredMemories.length === 0 ? (
          <EmptyState 
            hasMemories={memories.length > 0} 
            clearFilters={() => {
                clearFilters();
                logEvent('Filter', 'Cleared from Empty State');
            }} 
          />
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-6">
            {filteredMemories.map(mem => (
              <MemoryCard 
                key={mem.id} 
                memory={mem} 
                onDelete={(id) => {
                    handleDelete(id);
                    logEvent('Memory', 'Deleted');
                }} 
                onRetry={(id) => {
                    handleRetry(id);
                    logEvent('Memory', 'Retried');
                }}
                hasApiKey={apiKeySet}
                onAddApiKey={() => setIsApiKeyModalOpen(true)}
              />
            ))}
          </div>
        )}
      </main>

      <button 
        onClick={() => {
            setIsCaptureOpen(true);
            logEvent('Navigation', 'Capture Opened', 'FAB');
        }}
        className="fixed bottom-6 right-4 sm:bottom-8 sm:right-8 z-20 h-14 sm:h-16 px-5 sm:px-7 bg-blue-600 text-white rounded-2xl flex items-center gap-3 shadow-2xl hover:bg-blue-700 hover:scale-105 active:scale-95 transition-all duration-300 shadow-blue-900/50"
      >
        <Plus size={28} strokeWidth={3} />
        <span className="font-bold text-lg">New</span>
      </button>

      {view === ViewMode.RECALL && (
        <ChatInterface 
          memories={filteredMemories.filter(m => !m.isDeleting)} 
          onClose={() => {
              setView(ViewMode.FEED);
              logEvent('Chat', 'Closed');
          }} 
        />
      )}

      {isSettingsOpen && (
        <SettingsModal 
            onClose={() => {
                setIsSettingsOpen(false);
                logEvent('Settings', 'Closed');
            }}
            clearKey={() => {
                clearKey();
                logEvent('Settings', 'API Key Cleared');
            }}
            availableTypes={availableTypes}
            onImportSuccess={() => {
                refreshMemories();
                logEvent('Data', 'Import Success');
                if (isLinked()) sync().then(refreshMemories); 
            }}
            appVersion={appVersion}
            hasApiKey={apiKeySet}
            onAddApiKey={() => {
                setIsSettingsOpen(false); 
                setIsApiKeyModalOpen(true);
            }}
        />
      )}

      {isApiKeyModalOpen && (
        <ApiKeyModal
            onClose={() => setIsApiKeyModalOpen(false)}
            onSave={handleSaveApiKey}
        />
      )}
    </div>
  );
};

export default App;
