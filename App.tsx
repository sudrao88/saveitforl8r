
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, RefreshCw, AlertTriangle } from 'lucide-react'; 
import MemoryCard from './components/MemoryCard';
import ChatInterface from './components/ChatInterface';
import TopNavigation from './components/TopNavigation';
import FilterBar from './components/FilterBar';
import SettingsModal from './components/SettingsModal';
import EmptyState from './components/EmptyState';
import NewMemoryPage from './components/NewMemoryPage';
import ApiKeyModal from './components/ApiKeyModal';
import ShareOnboardingModal from './components/ShareOnboardingModal';
import { InstallPrompt } from './components/InstallPrompt';

import { useMemories } from './hooks/useMemories';
import { useSettings } from './hooks/useSettings';
import { useMemoryFilters } from './hooks/useMemoryFilters';
import { useServiceWorker } from './hooks/useServiceWorker';
import { useShareReceiver } from './hooks/useShareReceiver';
import { useSync } from './hooks/useSync';
import { useAuth } from './hooks/useAuth';
import { useOnboarding } from './hooks/useOnboarding';
import { SyncProvider } from './context/SyncContext';
import { ViewMode } from './types';
import { initGA, logPageView, logEvent } from './services/analytics';
import { ANALYTICS_EVENTS } from './constants';

const AppContent: React.FC = () => {
  const [view, setView] = useState<ViewMode>(ViewMode.FEED);
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  // Moved syncError handling to SyncContext, but we might keep local UI state if needed
  // Using context state now

  const { updateAvailable, updateApp, appVersion } = useServiceWorker();
  const { shareData, clearShareData } = useShareReceiver();
  
  // Use context hooks
  const { sync, isSyncing, syncError } = useSync();
  const { authStatus, login, unlink } = useAuth();

  const {
    memories,
    refreshMemories,
    handleDelete,
    handleRetry,
    createMemory 
  } = useMemories();

  // Use the new custom hook for onboarding logic
  const { isShareOnboardingOpen, closeOnboarding } = useOnboarding({ memories });

  useEffect(() => {
    initGA();
    logPageView('home');
    
    // Initial sync if linked
    if (authStatus === 'linked') {
        console.log('[App] Linked. Triggering initial sync...');
        sync().then(() => {
            console.log('[App] Initial sync complete. Refreshing memories.');
            refreshMemories();
        }).catch(err => {
            console.error('[App] Initial sync failed:', err);
        });
    }
  }, [authStatus, sync, refreshMemories]); 

  // If share data arrives, open the capture modal immediately
  useEffect(() => {
    if (shareData) {
      logEvent(ANALYTICS_EVENTS.SHARE.CATEGORY, ANALYTICS_EVENTS.SHARE.ACTION_RECEIVED, ANALYTICS_EVENTS.SHARE.LABEL_EXTERNAL);
      setIsCaptureOpen(true);
    }
  }, [shareData]);


  const {
    apiKeySet,
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

  const handleSaveApiKey = useCallback(async (key: string): Promise<void> => {
    saveKey(key);
    logEvent(ANALYTICS_EVENTS.SETTINGS.CATEGORY, ANALYTICS_EVENTS.SETTINGS.ACTION_API_KEY_SET, 'Onboarding');
    setIsApiKeyModalOpen(false);
    
    const pendingIds = memories.filter(m => m.isPending || m.processingError).map(m => m.id);
    
    const retryPromises = pendingIds.map(async (id) => {
        try {
            await handleRetry(id);
        } catch (error) {
            console.error(`Failed to retry memory ${id}:`, error);
        }
    });

    await Promise.allSettled(retryPromises);
  }, [saveKey, memories, handleRetry]);

  const handleManualSync = useCallback((): void => {
      sync().then(refreshMemories).catch(e => {
          console.error("Manual sync error", e);
      });
  }, [sync, refreshMemories]);

  // Memoized handlers
  const handleCaptureClose = useCallback(() => {
    setIsCaptureOpen(false);
    logEvent(ANALYTICS_EVENTS.MEMORY.CATEGORY, ANALYTICS_EVENTS.MEMORY.ACTION_CAPTURE_CANCELLED);
    clearShareData();
  }, [clearShareData]);

  const handleCreateMemory = useCallback(async (text: string, attachments: File[], tags: string[], location?: { latitude: number; longitude: number }) => {
    setIsCaptureOpen(false); // Close modal first
    await createMemory(text, attachments, tags, location);
    // Remove refreshMemories() call as createMemory now updates state locally
    logEvent(ANALYTICS_EVENTS.MEMORY.CATEGORY, ANALYTICS_EVENTS.MEMORY.ACTION_CREATED);
    clearShareData();
  }, [createMemory, clearShareData]);

  const handleChatClose = useCallback(() => {
    setView(ViewMode.FEED);
    logEvent(ANALYTICS_EVENTS.CHAT.CATEGORY, ANALYTICS_EVENTS.CHAT.ACTION_CLOSED);
  }, []);

  const handleSetView = useCallback((newView: ViewMode) => {
    setView(newView);
    logEvent(ANALYTICS_EVENTS.NAVIGATION.CATEGORY, ANALYTICS_EVENTS.NAVIGATION.ACTION_VIEW_CHANGED, newView);
  }, []);

  const handleResetFilters = useCallback(() => {
    clearFilters();
    logEvent(ANALYTICS_EVENTS.FILTER.CATEGORY, ANALYTICS_EVENTS.FILTER.ACTION_CLEARED);
  }, [clearFilters]);

  const handleSettingsClick = useCallback(() => {
    setIsSettingsOpen(true);
    logEvent(ANALYTICS_EVENTS.NAVIGATION.CATEGORY, ANALYTICS_EVENTS.NAVIGATION.ACTION_SETTINGS_OPENED);
  }, [setIsSettingsOpen]);

  const handleUpdateApp = useCallback(() => {
    updateApp();
    logEvent(ANALYTICS_EVENTS.APP.CATEGORY, ANALYTICS_EVENTS.APP.ACTION_UPDATED);
  }, [updateApp]);

  const handleSetFilterType = useCallback((type: string | null) => {
    setFilterType(type);
    if (type) logEvent(ANALYTICS_EVENTS.FILTER.CATEGORY, ANALYTICS_EVENTS.FILTER.ACTION_APPLIED, type);
  }, [setFilterType]);

  const handleClearFiltersEmptyState = useCallback(() => {
    clearFilters();
    logEvent(ANALYTICS_EVENTS.FILTER.CATEGORY, ANALYTICS_EVENTS.FILTER.ACTION_CLEARED_EMPTY);
  }, [clearFilters]);

  const handleDeleteMemory = useCallback((id: string) => {
    handleDelete(id);
    logEvent(ANALYTICS_EVENTS.MEMORY.CATEGORY, ANALYTICS_EVENTS.MEMORY.ACTION_DELETED);
  }, [handleDelete]);

  const handleRetryMemory = useCallback((id: string) => {
    handleRetry(id);
    logEvent(ANALYTICS_EVENTS.MEMORY.CATEGORY, ANALYTICS_EVENTS.MEMORY.ACTION_RETRIED);
  }, [handleRetry]);

  const handleOpenCapture = useCallback(() => {
    setIsCaptureOpen(true);
    logEvent(ANALYTICS_EVENTS.NAVIGATION.CATEGORY, ANALYTICS_EVENTS.NAVIGATION.ACTION_CAPTURE_OPENED, 'FAB');
  }, []);

  const handleSettingsClose = useCallback(() => {
    setIsSettingsOpen(false);
    logEvent(ANALYTICS_EVENTS.SETTINGS.CATEGORY, ANALYTICS_EVENTS.SETTINGS.ACTION_CLOSED);
  }, [setIsSettingsOpen]);

  const handleClearKey = useCallback(() => {
    clearKey();
    logEvent(ANALYTICS_EVENTS.SETTINGS.CATEGORY, ANALYTICS_EVENTS.SETTINGS.ACTION_API_KEY_CLEARED);
  }, [clearKey]);

  const handleImportSuccess = useCallback(() => {
    refreshMemories();
    logEvent(ANALYTICS_EVENTS.DATA.CATEGORY, ANALYTICS_EVENTS.DATA.ACTION_IMPORT_SUCCESS);
    if (authStatus === 'linked') sync().then(refreshMemories); 
  }, [refreshMemories, authStatus, sync]);

  const handleAddApiKey = useCallback(() => {
    setIsSettingsOpen(false); 
    setIsApiKeyModalOpen(true);
  }, [setIsSettingsOpen]);

  // Performance Optimization: Memoize displayMemories
  const displayMemories = useMemo(() => {
    return filteredMemories.filter(m => !m.isDeleting);
  }, [filteredMemories]);

  // 1. Capture/New Memory View (Full Screen)
  if (isCaptureOpen) {
    return (
      <NewMemoryPage 
        onClose={handleCaptureClose}
        onCreate={handleCreateMemory}
        initialContent={shareData || undefined}
      />
    );
  }

  // 2. Chat/Recall View (Full Screen)
  if (view === ViewMode.RECALL) {
     return (
        <ChatInterface 
          memories={displayMemories} 
          onClose={handleChatClose} 
        />
     );
  }

  // 3. Main Feed View
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <InstallPrompt />
      <div className="sticky top-0 z-30 bg-gray-900/90 backdrop-blur-md border-b border-gray-800">
          <TopNavigation 
            setView={handleSetView} 
            resetFilters={handleResetFilters} 
            onSettingsClick={handleSettingsClick}
            updateAvailable={updateAvailable}
            onUpdateApp={handleUpdateApp}
            syncError={!!syncError}
            isSyncing={isSyncing} 
          />

          <FilterBar 
            availableTypes={availableTypes}
            filterType={filterType}
            setFilterType={handleSetFilterType}
            clearFilters={handleResetFilters}
          />
      </div>

      <main className="flex-1 p-4 sm:p-8 max-w-7xl mx-auto w-full relative">
        {/* Sync Error Banner Removed - relying on Settings Icon Dot */}
        {filteredMemories.length === 0 ? (
          <EmptyState 
            hasMemories={memories.length > 0} 
            clearFilters={handleClearFiltersEmptyState} 
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredMemories.map(mem => (
              <MemoryCard 
                key={mem.id} 
                memory={mem} 
                onDelete={handleDeleteMemory} 
                onRetry={handleRetryMemory}
                hasApiKey={apiKeySet}
                onAddApiKey={handleAddApiKey}
              />
            ))}
          </div>
        )}
      </main>

      <button 
        onClick={handleOpenCapture}
        className="fixed bottom-6 right-4 sm:bottom-8 sm:right-8 z-20 h-14 sm:h-16 px-5 sm:px-7 bg-blue-600 text-white rounded-2xl flex items-center gap-3 shadow-2xl hover:bg-blue-700 hover:scale-105 active:scale-95 transition-all duration-300 shadow-blue-900/50"
      >
        <Plus size={28} strokeWidth={3} />
        <span className="font-bold text-lg">New</span>
      </button>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <SettingsModal 
            onClose={handleSettingsClose}
            clearKey={handleClearKey}
            availableTypes={availableTypes}
            onImportSuccess={handleImportSuccess}
            appVersion={appVersion}
            hasApiKey={apiKeySet}
            onAddApiKey={handleAddApiKey}
            syncError={!!syncError}
            onSyncComplete={refreshMemories} 
        />
      )}

      {/* API Key Modal */}
      {isApiKeyModalOpen && (
        <ApiKeyModal
            onClose={() => setIsApiKeyModalOpen(false)}
            onSave={handleSaveApiKey}
        />
      )}

      {/* Share Onboarding Modal */}
      {isShareOnboardingOpen && (
          <ShareOnboardingModal onClose={closeOnboarding} />
      )}
    </div>
  );
};

// Wrap App with SyncProvider
const App = () => (
    <SyncProvider>
        <AppContent />
    </SyncProvider>
);

export default App;
