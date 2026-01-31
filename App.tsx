import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Plus, RefreshCw, AlertTriangle, X, Download, Maximize, Minimize, FileText } from 'lucide-react'; 
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
import ErrorBoundary from './components/ErrorBoundary';
import { Logo } from './components/icons';

import { useMemories } from './hooks/useMemories';
import { useSettings } from './hooks/useSettings';
import { useMemoryFilters } from './hooks/useMemoryFilters';
import { useServiceWorker } from './hooks/useServiceWorker';
import { useShareReceiver } from './hooks/useShareReceiver';
import { useSync } from './hooks/useSync';
import { useAuth } from './hooks/useAuth';
import { useOnboarding } from './hooks/useOnboarding';
import { useAdaptiveSearch } from './hooks/useAdaptiveSearch';
import { useHotkeys } from './hooks/useHotkeys';
import { SyncProvider } from './context/SyncContext';
import { reconcileEmbeddings, ReconcileReport } from './services/storageService';
import { ViewMode, Memory, Attachment } from './types';
import { initGA, logPageView, logEvent } from './services/analytics';
import { ANALYTICS_EVENTS } from './constants';

const AppContent: React.FC = () => {
  const [view, setView] = useState<ViewMode>(ViewMode.FEED);
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [expandedMemory, setExpandedMemory] = useState<Memory | null>(null);
  const [viewingAttachment, setViewingAttachment] = useState<Attachment | null>(null);
  const [reconcileReport, setReconcileReport] = useState<ReconcileReport | null>(null);
  
  const { updateAvailable, updateApp, appVersion } = useServiceWorker();
  const { shareData, clearShareData } = useShareReceiver();
  
  const { sync, isSyncing, syncError } = useSync();
  const { authStatus, login, unlink } = useAuth();

  const { modelStatus, downloadProgress, retryDownload, search, embeddingStats, retryFailedEmbeddings, deleteNoteFromIndex, lastError, closeWorkerDB } = useAdaptiveSearch();

  const {
    memories,
    refreshMemories,
    handleDelete,
    handleRetry,
    createMemory,
    updateMemoryContent,
    togglePin,
    isLoading
  } = useMemories();

  const handleFullRefresh = useCallback(async () => {
      await refreshMemories();
      const report = await reconcileEmbeddings();
      setReconcileReport(report);
  }, [refreshMemories]);

  const syncRef = useRef(sync);
  const refreshRef = useRef(handleFullRefresh);

  useEffect(() => {
    syncRef.current = sync;
    refreshRef.current = handleFullRefresh;
  }, [sync, handleFullRefresh]);

  const { isShareOnboardingOpen, closeOnboarding } = useOnboarding({ memories });

  useEffect(() => {
    initGA();
    logPageView('home');
    
    reconcileEmbeddings().then(setReconcileReport).catch(console.error);
    
    if (authStatus === 'linked') {
        syncRef.current().then(() => {
            refreshRef.current();
        }).catch(err => {
            console.error('[App] Initial sync failed:', err);
        });
    }
  }, [authStatus]);

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

  const handleCaptureClose = useCallback(() => {
    setIsCaptureOpen(false);
    logEvent(ANALYTICS_EVENTS.MEMORY.CATEGORY, ANALYTICS_EVENTS.MEMORY.ACTION_CAPTURE_CANCELLED);
    clearShareData();
  }, [clearShareData]);

  const handleCreateMemory = useCallback(async (text: string, attachments: any[], tags: string[], location?: { latitude: number; longitude: number }) => {
    await createMemory(text, attachments, tags, location);
    setIsCaptureOpen(false);
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
    deleteNoteFromIndex(id); 
    logEvent(ANALYTICS_EVENTS.MEMORY.CATEGORY, ANALYTICS_EVENTS.MEMORY.ACTION_DELETED);
    if (expandedMemory?.id === id) setExpandedMemory(null);
  }, [handleDelete, expandedMemory, deleteNoteFromIndex]);

  const handleRetryMemory = useCallback((id: string) => {
    handleRetry(id);
    logEvent(ANALYTICS_EVENTS.MEMORY.CATEGORY, ANALYTICS_EVENTS.MEMORY.ACTION_RETRIED);
  }, [handleRetry]);

  const handleTogglePin = useCallback((id: string, isPinned: boolean) => {
    togglePin(id, isPinned);
  }, [togglePin]);

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
    handleFullRefresh();
    logEvent(ANALYTICS_EVENTS.DATA.CATEGORY, ANALYTICS_EVENTS.DATA.ACTION_IMPORT_SUCCESS);
    if (authStatus === 'linked') {
        syncRef.current().then(() => handleFullRefresh());
    } 
  }, [authStatus, handleFullRefresh]);

  const handleAddApiKey = useCallback(() => {
    setIsSettingsOpen(false); 
    setIsApiKeyModalOpen(true);
  }, [setIsSettingsOpen]);

  useHotkeys({
    'Mod+k': () => setIsCaptureOpen(true),
    'Mod+f': () => setView(ViewMode.RECALL),
    'Mod+,': () => setIsSettingsOpen(true),
  });

  const displayMemories = useMemo(() => {
    const active = filteredMemories.filter(m => !m.isDeleting);
    return active.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return 0; 
    });
  }, [filteredMemories]);

  const activeMemoryCount = useMemo(() => memories.filter(m => !m.isDeleted).length, [memories]);

  if (isLoading) {
    return (
        <div className="fixed inset-0 bg-gray-900 z-[9999] flex flex-col items-center justify-center">
            <Logo className="w-20 h-20 mb-6 animate-pulse" />
            <div className="flex gap-1.5 items-center">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
            </div>
        </div>
    );
  }

  if (isCaptureOpen) {
    return (
      <NewMemoryPage 
        onClose={handleCaptureClose}
        onCreate={handleCreateMemory}
        initialContent={shareData || undefined}
      />
    );
  }

  if (view === ViewMode.RECALL) {
     return (
        <ErrorBoundary
          fallbackTitle="Brain Search encountered an error"
          fallbackMessage="The AI search feature hit an unexpected issue. Your memories are safe — try reloading."
        >
          <ChatInterface
            memories={displayMemories}
            onClose={handleChatClose}
            searchFunction={search}
            onViewAttachment={setViewingAttachment}
          />
        </ErrorBoundary>
     );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <InstallPrompt />
      <div className="sticky top-0 z-30 bg-gray-900/90 backdrop-blur-md border-b border-gray-800 pt-[env(safe-area-inset-top)]">
          <TopNavigation 
            setView={handleSetView} 
            resetFilters={handleResetFilters} 
            onSettingsClick={handleSettingsClick}
            updateAvailable={updateAvailable}
            onUpdateApp={handleUpdateApp}
            syncError={!!syncError}
            isSyncing={isSyncing} 
            modelStatus={modelStatus}
          />

          <FilterBar 
            availableTypes={availableTypes}
            filterType={filterType}
            setFilterType={handleSetFilterType}
            clearFilters={handleResetFilters}
          />
      </div>

      <main className="flex-1 p-4 sm:p-8 max-w-7xl mx-auto w-full relative">
        {filteredMemories.length === 0 ? (
          <EmptyState 
            hasMemories={memories.length > 0} 
            clearFilters={handleClearFiltersEmptyState} 
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {displayMemories.map(mem => (
              <MemoryCard 
                key={mem.id} 
                memory={mem} 
                onDelete={handleDeleteMemory} 
                onRetry={handleRetryMemory}
                onUpdate={updateMemoryContent}
                onExpand={setExpandedMemory}
                onViewAttachment={setViewingAttachment}
                onTogglePin={handleTogglePin}
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

      {expandedMemory && (
        <div className="fixed inset-0 z-[100] bg-gray-950/90 backdrop-blur-md flex flex-col animate-in fade-in duration-300">
          <div className="sticky top-0 z-10 px-4 py-3 border-b border-gray-800 flex items-center justify-between bg-gray-950/50 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
             <div className="flex items-center gap-3">
                <button onClick={() => setExpandedMemory(null)} className="p-2 -ml-2 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
                    <X size={24} />
                </button>
                <h2 className="text-lg font-bold text-gray-100 truncate max-w-[200px] sm:max-w-md">Memory Detail</h2>
             </div>
             <Logo className="w-8 h-8 text-blue-500 opacity-50" />
          </div>
          <div className="flex-1 overflow-y-auto p-4 sm:p-8">
             <div className="max-w-2xl mx-auto pb-20">
                <MemoryCard 
                    memory={expandedMemory} 
                    onDelete={handleDeleteMemory} 
                    onRetry={handleRetryMemory}
                    onUpdate={updateMemoryContent}
                    onViewAttachment={setViewingAttachment}
                    onTogglePin={handleTogglePin}
                    isDialog={true}
                    hasApiKey={apiKeySet}
                    onAddApiKey={handleAddApiKey}
                />
             </div>
          </div>
        </div>
      )}

      {viewingAttachment && (
        <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex flex-col animate-in fade-in zoom-in-95 duration-200">
           <div className="flex items-center justify-between px-4 py-3 bg-black/50 border-b border-white/10 pt-[env(safe-area-inset-top)]">
              <div className="flex items-center gap-3">
                 <button onClick={() => setViewingAttachment(null)} className="p-2 -ml-2 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                    <X size={24} />
                 </button>
                 <span className="text-sm font-medium text-gray-200 truncate max-w-[200px] sm:max-w-md">{viewingAttachment.name}</span>
              </div>
              <a 
                href={viewingAttachment.data} 
                download={viewingAttachment.name}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all"
              >
                 <Download size={14} /> Download
              </a>
           </div>
           
           <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
              {viewingAttachment.type === 'image' ? (
                 <img 
                    src={viewingAttachment.data} 
                    alt={viewingAttachment.name} 
                    className="max-w-full max-h-full object-contain shadow-2xl rounded-lg animate-in zoom-in-90 duration-300"
                 />
              ) : viewingAttachment.mimeType === 'application/pdf' ? (
                 <iframe 
                    src={viewingAttachment.data} 
                    className="w-full h-full rounded-lg bg-white shadow-2xl border-none"
                    title={viewingAttachment.name}
                 />
              ) : (
                 <div className="bg-gray-900 border border-gray-800 p-8 rounded-2xl flex flex-col items-center gap-4 text-center max-w-sm">
                    <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center">
                       <FileText size={32} className="text-blue-400" />
                    </div>
                    <div>
                       <h3 className="text-gray-100 font-bold mb-1">{viewingAttachment.name}</h3>
                       <p className="text-gray-400 text-xs">Preview not available for this file type.</p>
                    </div>
                    <a 
                        href={viewingAttachment.data} 
                        download={viewingAttachment.name}
                        className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all shadow-lg"
                    >
                        Download to View
                    </a>
                 </div>
              )}
           </div>
        </div>
      )}

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
            onSyncComplete={handleFullRefresh} 
            modelStatus={modelStatus}
            downloadProgress={downloadProgress}
            retryDownload={retryDownload}
            embeddingStats={embeddingStats}
            retryFailedEmbeddings={retryFailedEmbeddings}
            totalMemories={activeMemoryCount}
            lastError={lastError}
            closeWorkerDB={closeWorkerDB}
            reconcileReport={reconcileReport}
        />
      )}

      {isApiKeyModalOpen && (
        <ApiKeyModal
            onClose={() => setIsApiKeyModalOpen(false)}
            onSave={handleSaveApiKey}
        />
      )}

      {isShareOnboardingOpen && (
          <ShareOnboardingModal onClose={closeOnboarding} />
      )}
    </div>
  );
};

const App = () => (
    <ErrorBoundary>
      <SyncProvider>
          <AppContent />
      </SyncProvider>
    </ErrorBoundary>
);

export default App;