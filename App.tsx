import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Plus, RefreshCw, AlertTriangle, X, Download, Maximize, Minimize, FileText } from 'lucide-react'; 
import { App as CapacitorApp, URLOpenListenerEvent } from '@capacitor/app';
import { isNative } from './services/platform';
import MemoryCard from './components/MemoryCard';
import ChatInterface from './components/ChatInterface';
import TopNavigation from './components/TopNavigation';
import FilterBar from './components/FilterBar';
import SettingsModal from './components/SettingsModal';
import EmptyState from './components/EmptyState';
import NewMemoryPage from './components/NewMemoryPage';

import ErrorBoundary from './components/ErrorBoundary';
import { Logo } from './components/icons';

import { useMemories } from './hooks/useMemories';
import { useSettings } from './hooks/useSettings';
import { useMemoryFilters } from './hooks/useMemoryFilters';
import { useServiceWorker } from './hooks/useServiceWorker';
import { useShareReceiver } from './hooks/useShareReceiver';
import { useSync } from './hooks/useSync';
import { useAuth } from './hooks/useAuth';
import { useAdaptiveSearch } from './hooks/useAdaptiveSearch';
import { useHotkeys } from './hooks/useHotkeys';
import useNativeOTA from './hooks/useNativeOTA';
import { SyncProvider } from './context/SyncContext';
import { reconcileEmbeddings, ReconcileReport } from './services/storageService';
import { ViewMode, Memory, Attachment } from './types';
import { initGA, logPageView, logEvent } from './services/analytics';
import { ANALYTICS_EVENTS } from './constants';
import { handleDeepLink } from './services/googleAuth';

const AppContent: React.FC = () => {
  const [view, setView] = useState<ViewMode>(ViewMode.FEED);
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [expandedMemory, setExpandedMemory] = useState<Memory | null>(null);
  const [viewingAttachment, setViewingAttachment] = useState<Attachment | null>(null);
  const [reconcileReport, setReconcileReport] = useState<ReconcileReport | null>(null);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  
  const { updateAvailable, updateApp, appVersion } = useServiceWorker();
  const {
      enableRemoteMode,
      updateAvailable: nativeUpdateAvailable,
      currentVersion: nativeVersion,
      isDownloading: isOtaDownloading,
      downloadError: otaDownloadError,
  } = useNativeOTA();

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
    updateMemory,
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

  const {
    isSettingsOpen,
    setIsSettingsOpen,
  } = useSettings();

  const handleCaptureClose = useCallback(() => {
    setIsCaptureOpen(false);
    logEvent(ANALYTICS_EVENTS.MEMORY.CATEGORY, ANALYTICS_EVENTS.MEMORY.ACTION_CAPTURE_CANCELLED);
    clearShareData();
  }, [clearShareData]);

  const handleEditClose = useCallback(() => {
    setEditingMemory(null);
  }, []);

  // BOUNCER LOGIC (Web only)
  // Redirects back to native app if 'state' indicates a native login flow
  useEffect(() => {
    if (!isNative()) {
        const params = new URLSearchParams(window.location.search);
        const state = params.get('state');
        if (state === 'is_native_login') {
            const code = params.get('code');
            const error = params.get('error');
            // Custom scheme: com.saveitforl8r.app://google-auth
            const schemeUrl = `com.saveitforl8r.app://google-auth?code=${code}&error=${error || ''}`;
            
            console.log("Bouncing to native app:", schemeUrl);
            window.location.href = schemeUrl;
            
            // Visual feedback
            document.body.innerHTML = `
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#111827;color:white;font-family:sans-serif;">
                <h2>Redirecting to App...</h2>
                <p>If not redirected, <a href="${schemeUrl}" style="color:#3b82f6">click here</a>.</p>
              </div>
            `;
        }
    }
  }, []);

  // INITIALIZATION EFFECT - runs once on mount and when auth status changes
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

        // Auto-retry enrichment for memories that failed while unauthenticated
        const pendingIds = memories.filter(m => m.isPending || m.processingError).map(m => m.id);
        if (pendingIds.length > 0) {
            console.log(`[App] Auth linked — auto-retrying ${pendingIds.length} failed memories`);
            pendingIds.forEach(id => handleRetry(id));
        }
    }
  }, [authStatus]);

  // NATIVE DEEP LINK HANDLING (Google Auth)
  useEffect(() => {
    if (!isNative()) return;

    const handleUrlOpen = async (event: URLOpenListenerEvent) => {
        // Handle Google Auth Deep Link
        if (event.url.includes('google-auth')) {
            try {
                await handleDeepLink(event.url);
                // Trigger sync after successful login
                if (authStatus !== 'linked') {
                    // Force a reload or re-check auth state might be needed, 
                    // but handleDeepLink does a reload() currently.
                }
            } catch (e) {
                console.error("Deep link error:", e);
                alert("Login failed. Please try again.");
            }
        }
    };

    CapacitorApp.addListener('appUrlOpen', handleUrlOpen);

    // No cleanup here to avoid removing backButton listener if they are shared on the plugin level
    // in older versions, but typically addListener returns a handle to remove it specifically.
    // For simplicity in this functional component, we assume it persists.
  }, [authStatus]);

  // NATIVE BACK BUTTON HANDLING - separate effect with UI state dependencies
  useEffect(() => {
    if (!isNative()) return;

    const handleBackButton = ({ canGoBack }: { canGoBack: boolean }) => {
      if (viewingAttachment) {
        setViewingAttachment(null);
      } else if (expandedMemory) {
        setExpandedMemory(null);
      } else if (isSettingsOpen) {
        setIsSettingsOpen(false);
      } else if (editingMemory) {
        handleEditClose();
      } else if (isCaptureOpen) {
        handleCaptureClose();
      } else if (view === ViewMode.RECALL) {
        setView(ViewMode.FEED);
      } else if (canGoBack) {
        window.history.back();
      } else {
        CapacitorApp.exitApp();
      }
    };

    const listener = CapacitorApp.addListener('backButton', handleBackButton);

    return () => {
      // Clean up specifically this listener if promise resolves (React 18 safe?)
      // Since addListener is async in some versions, but usually returns PluginListenerHandle
      listener.then(handle => handle.remove()).catch(e => console.error(e));
    };
  }, [viewingAttachment, expandedMemory, isSettingsOpen, editingMemory, isCaptureOpen, view, handleCaptureClose, handleEditClose]);

  useEffect(() => {
    if (shareData) {
      logEvent(ANALYTICS_EVENTS.SHARE.CATEGORY, ANALYTICS_EVENTS.SHARE.ACTION_RECEIVED, ANALYTICS_EVENTS.SHARE.LABEL_EXTERNAL);
      setIsCaptureOpen(true);
    }
  }, [shareData]);


  const {
    filterType,
    setFilterType,
    availableTypes,
    filteredMemories,
    clearFilters
  } = useMemoryFilters(memories);

  const handleCreateMemory = useCallback(async (text: string, attachments: any[], tags: string[], location?: { latitude: number; longitude: number }) => {
    await createMemory(text, attachments, tags, location);
    setIsCaptureOpen(false);
    logEvent(ANALYTICS_EVENTS.MEMORY.CATEGORY, ANALYTICS_EVENTS.MEMORY.ACTION_CREATED);
    clearShareData();
  }, [createMemory, clearShareData]);

  const handleUpdateMemory = useCallback(async (id: string, text: string, attachments: any[], tags: string[], location?: { latitude: number; longitude: number }) => {
    await updateMemory(id, text, attachments, tags, location);
    setEditingMemory(null);
    // Close expanded view if we were editing from there
    if (expandedMemory?.id === id) {
      setExpandedMemory(null);
    }
    logEvent(ANALYTICS_EVENTS.MEMORY.CATEGORY, ANALYTICS_EVENTS.MEMORY.ACTION_CREATED, 'updated');
  }, [updateMemory, expandedMemory]);

  const handleEditMemory = useCallback((memory: Memory) => {
    setEditingMemory(memory);
    // Close expanded view when opening edit
    setExpandedMemory(null);
    logEvent(ANALYTICS_EVENTS.MEMORY.CATEGORY, ANALYTICS_EVENTS.MEMORY.ACTION_CREATED, 'edit_started');
  }, []);

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
    if (isNative()) {
      enableRemoteMode().catch(console.error);
    } else {
      updateApp();
    }
    logEvent(ANALYTICS_EVENTS.APP.CATEGORY, ANALYTICS_EVENTS.APP.ACTION_UPDATED);
  }, [updateApp, enableRemoteMode]);

  const handleSetFilterType = useCallback((type: string | null) => {
    setFilterType(type);
    if (type) logEvent(ANALYTICS_EVENTS.FILTER.CATEGORY, ANALYTICS_EVENTS.FILTER.ACTION_APPLIED, type);
  }, [setFilterType]);

  const handleClearFiltersEmptyState = useCallback((type?: string) => {
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

  const handleImportSuccess = useCallback(() => {
    handleFullRefresh();
    logEvent(ANALYTICS_EVENTS.DATA.CATEGORY, ANALYTICS_EVENTS.DATA.ACTION_IMPORT_SUCCESS);
    if (authStatus === 'linked') {
        syncRef.current().then(() => handleFullRefresh());
    } 
  }, [authStatus, handleFullRefresh]);

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

  const isUpdateAvailable = isNative() ? nativeUpdateAvailable : updateAvailable;
  const versionToDisplay = isNative() ? nativeVersion : appVersion;

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

  if (editingMemory) {
    return (
      <NewMemoryPage
        onClose={handleEditClose}
        onCreate={handleCreateMemory}
        onUpdate={handleUpdateMemory}
        editMemory={editingMemory}
      />
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
      <div className="sticky top-0 z-[50] bg-gray-900/90 backdrop-blur-md border-b border-gray-800 pt-[env(safe-area-inset-top)]">
          <TopNavigation
            setView={handleSetView}
            resetFilters={handleResetFilters}
            onSettingsClick={handleSettingsClick}
            updateAvailable={isUpdateAvailable}
            onUpdateApp={handleUpdateApp}
            syncError={!!syncError}
            isSyncing={isSyncing}
            modelStatus={modelStatus}
            isOtaDownloading={isOtaDownloading}
          />

          <FilterBar 
            availableTypes={availableTypes}
            filterType={filterType}
            setFilterType={handleSetFilterType}
            clearFilters={handleResetFilters}
          />
      </div>

      <main className="flex-1 p-4 sm:p-8 max-w-7xl mx-auto w-full relative z-[40]">
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
                onEdit={handleEditMemory}
                isAuthenticated={authStatus === 'linked'}
                onSignIn={login}
              />
            ))}
          </div>
        )}
      </main>

      {/* FAB: Use calc for safe area positioning instead of pb-safe to prevent layout shift during scroll */}
      <button
        onClick={handleOpenCapture}
        className="fixed right-4 sm:right-8 z-[60] h-14 px-5 bg-blue-600 text-white rounded-2xl flex items-center gap-3 shadow-2xl hover:bg-blue-700 hover:scale-105 active:scale-95 transition-colors duration-200 shadow-blue-900/50 touch-manipulation will-change-transform"
        style={{ bottom: 'calc(24px + env(safe-area-inset-bottom))' }}
      >
        <Plus size={28} strokeWidth={3} />
        <span className="font-bold text-lg hidden sm:inline">New</span>
      </button>

      {expandedMemory && (
        <div className="fixed inset-0 z-[100] bg-gray-950/90 backdrop-blur-md flex flex-col animate-in fade-in duration-300">
          <div className="sticky top-0 z-10 px-4 py-3 border-b border-gray-800 flex items-center justify-between bg-gray-950/50 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
             <div className="flex items-center gap-3">
                <button onClick={() => setExpandedMemory(null)} className="p-3 -ml-3 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white transition-colors active:scale-95">
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
                    onEdit={handleEditMemory}
                    isDialog={true}
                    isAuthenticated={authStatus === 'linked'}
                    onSignIn={login}
                />
             </div>
          </div>
        </div>
      )}

      {viewingAttachment && (
        <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex flex-col animate-in fade-in zoom-in-95 duration-200">
           <div className="flex items-center justify-between px-4 py-3 bg-black/50 border-b border-white/10 pt-[env(safe-area-inset-top)]">
              <div className="flex items-center gap-3">
                 <button onClick={() => setViewingAttachment(null)} className="p-3 -ml-3 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors active:scale-95">
                    <X size={24} />
                 </button>
                 <span className="text-sm font-medium text-gray-200 truncate max-w-[200px] sm:max-w-md">{viewingAttachment.name}</span>
              </div>
              <a 
                href={viewingAttachment.data} 
                download={viewingAttachment.name}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all active:scale-95"
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
                        className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all shadow-lg active:scale-95"
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
            availableTypes={availableTypes}
            onImportSuccess={handleImportSuccess}
            appVersion={versionToDisplay}
            syncError={syncError}
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

      {isOtaDownloading && (
        <div className="fixed inset-0 z-[9999] bg-gray-950/95 backdrop-blur-md flex flex-col items-center justify-center gap-6">
          <Logo className="w-16 h-16 text-blue-500" />
          <div className="flex flex-col items-center gap-3">
            <RefreshCw size={32} className="text-blue-400 animate-spin" />
            <h2 className="text-xl font-bold text-gray-100">Downloading Update</h2>
            <p className="text-sm text-gray-400 text-center max-w-xs">
              Please wait while the latest version is downloaded. The app will reload automatically.
            </p>
          </div>
        </div>
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