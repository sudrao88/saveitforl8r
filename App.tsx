import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { App as CapacitorApp, URLOpenListenerEvent } from '@capacitor/app';
import { isNative } from './services/platform';
import MemoryCard from './components/MemoryCard';
import TopNavigation from './components/TopNavigation';
import FilterBar from './components/FilterBar';
import MomentsStrip from './components/MomentsStrip';
import EmptyState from './components/EmptyState';
import VirtualizedMemoryGrid from './components/VirtualizedMemoryGrid';

import ErrorBoundary from './components/ErrorBoundary';
import { Logo } from './components/icons';
import QuickNoteBar, { QuickNoteBarHandle } from './components/QuickNoteBar';
import GalleryViewer from './components/GalleryViewer';
import { lazyWithRetry } from './utils/lazyWithRetry';

// Lazy-load heavy components that aren't needed on initial render.
// lazyWithRetry clears stale SW caches and reloads if a chunk fails to import.
const ChatInterface = lazyWithRetry(() => import('./components/ChatInterface'));
const SettingsModal = lazyWithRetry(() => import('./components/SettingsModal'));
const NewMemoryPage = lazyWithRetry(() => import('./components/NewMemoryPage'));
const MomentSheet = lazyWithRetry(() => import('./components/MomentSheet'));
const MomentCreationDialog = lazyWithRetry(() => import('./components/MomentCreationDialog'));
const AllMomentsSheet = lazyWithRetry(() => import('./components/AllMomentsSheet'));
const CalendarAgendaView = lazyWithRetry(() => import('./components/CalendarAgendaView'));
const TodoListView = lazyWithRetry(() => import('./components/TodoListView'));

import { useMemories } from './hooks/useMemories';
import { useSettings } from './hooks/useSettings';
import { useMemoryFilters } from './hooks/useMemoryFilters';
import { useServiceWorker } from './hooks/useServiceWorker';
import { useShareReceiver } from './hooks/useShareReceiver';
import { useSync } from './hooks/useSync';
import { useAuth } from './hooks/useAuth';
import { useAdaptiveSearch } from './hooks/useAdaptiveSearch';
import { useHotkeys } from './hooks/useHotkeys';
import { useMoments } from './hooks/useMoments';
import { useCalendarEvents } from './hooks/useCalendarEvents';
import { useTodoItems } from './hooks/useTodoItems';
import { useNotifications } from './hooks/useNotifications';
import useNativeOTA from './hooks/useNativeOTA';
import { SyncProvider } from './context/SyncContext';
import { reconcileEmbeddings, ReconcileReport, getMemories as getStoredMemories } from './services/storageService';
import { ViewMode, Memory, Attachment, Moment, QuickNoteState, CalendarEvent } from './types';
import { initGA, logPageView, logEvent } from './services/analytics';
import { escapeHtml } from './utils/editorUtils';

import { ANALYTICS_EVENTS } from './constants';
import { handleDeepLink } from './services/googleAuth';

const AppContent: React.FC = () => {
  const [view, setView] = useState<ViewMode>(ViewMode.FEED);
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [expandedMemory, setExpandedMemory] = useState<Memory | null>(null);
  const [viewingGallery, setViewingGallery] = useState<{ attachments: Attachment[]; currentIndex: number } | null>(null);
  const [reconcileReport, setReconcileReport] = useState<ReconcileReport | null>(null);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [activeMoment, setActiveMoment] = useState<Moment | null>(null);
  const [showAllMoments, setShowAllMoments] = useState(false);
  const [showCreateMoment, setShowCreateMoment] = useState(false);
  const [quickNoteExpandState, setQuickNoteExpandState] = useState<QuickNoteState | null>(null);
  const quickNoteBarRef = useRef<QuickNoteBarHandle>(null);

  const { updateAvailable, updateApp, appVersion } = useServiceWorker();
  const {
      enableRemoteMode,
      updateAvailable: nativeUpdateAvailable,
      currentVersion: nativeVersion,
      isDownloading: isOtaDownloading,
      downloadError: otaDownloadError,
  } = useNativeOTA();

  const { shareData, clearShareData } = useShareReceiver();
  
  const { sync, isSyncing, isSyncingDownload, syncError, getSyncStatusMap, syncStatusVersion, retrySyncFile, setOnSyncProgress } = useSync();
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
    isLoading,
    setMomentsRef,
    setOnNoteMatchedMoments,
    setOnEnrichmentCompleteCalendar,
    setOnCalendarEventsSync,
    setOnEnrichmentCompleteTodo,
    setOnTodoItemsSync,
  } = useMemories();

  const {
    moments,
    createNewMoment,
    loadSynthesis,
    synthesisLoading,
    creating: momentCreating,
    addNoteToMoment,
    removeNoteFromMoments,
    deleteMoment,
    synthesesMap,
    setOnMomentChanged,
    refreshMoments,
    markMomentSeen,
  } = useMoments(memories);

  const {
    events: calendarEvents,
    processDetectedEvents,
    removeEventsForMemory,
    refreshEvents,
    upcomingCount: calendarUpcomingCount,
    checkAndExpandHorizon,
  } = useCalendarEvents();

  const {
    items: todoItems,
    processDetectedActionItems,
    removeItemsForMemory: removeTodoItemsForMemory,
    toggleComplete: toggleTodoComplete,
    dismissItem: dismissTodoItem,
    restoreItem: restoreTodoItem,
    refreshItems: refreshTodoItems,
    pendingCount: todoPendingCount,
  } = useTodoItems();

  const [showCalendarAgenda, setShowCalendarAgenda] = useState(false);
  const [showTodoList, setShowTodoList] = useState(false);

  // Notification scheduling — syncs on mount, resume, and data changes
  const {
    permissionStatus: notificationPermission,
    isEnabled: notificationsEnabled,
    notificationTime,
    requestPermission: requestNotificationPermission,
    setEnabled: setNotificationsEnabled,
    setNotificationTime: setNotifTime,
    isSupported: notificationsSupported,
    pendingRoute: notificationPendingRoute,
    clearPendingRoute: clearNotificationRoute,
  } = useNotifications(calendarEvents, todoItems);

  // Handle notification tap deep-link
  useEffect(() => {
    if (!notificationPendingRoute) return;
    if (notificationPendingRoute === 'calendar') {
      setShowCalendarAgenda(true);
    } else if (notificationPendingRoute === 'todo') {
      setShowTodoList(true);
    }
    // 'home' — just open the app, which is the default
    clearNotificationRoute();
  }, [notificationPendingRoute, clearNotificationRoute]);

  const { syncMoment, syncCalendarEvents, syncTodoItems } = useSync();

  // Wire up moments ref and callback for enrichment-time moment matching
  useEffect(() => {
    setMomentsRef(moments);
  }, [moments, setMomentsRef]);

  useEffect(() => {
    setOnNoteMatchedMoments(addNoteToMoment);
  }, [addNoteToMoment, setOnNoteMatchedMoments]);

  // Wire up calendar event extraction from enrichment
  useEffect(() => {
    setOnEnrichmentCompleteCalendar(processDetectedEvents);
  }, [processDetectedEvents, setOnEnrichmentCompleteCalendar]);

  // Wire up calendar events sync callback
  useEffect(() => {
    setOnCalendarEventsSync(syncCalendarEvents);
  }, [syncCalendarEvents, setOnCalendarEventsSync]);

  // Wire up todo item extraction from enrichment
  useEffect(() => {
    setOnEnrichmentCompleteTodo(processDetectedActionItems);
  }, [processDetectedActionItems, setOnEnrichmentCompleteTodo]);

  // Wire up todo items sync callback
  useEffect(() => {
    setOnTodoItemsSync(syncTodoItems);
  }, [syncTodoItems, setOnTodoItemsSync]);

  // Expand recurring event horizons on mount
  useEffect(() => {
    checkAndExpandHorizon().then(newEvents => {
      if (newEvents.length > 0) {
        syncCalendarEvents(newEvents).catch(err =>
          console.error('[Calendar] Failed to sync expanded horizon events:', err)
        );
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wire up moment sync callback
  useEffect(() => {
    setOnMomentChanged((moment: Moment) => {
      syncMoment(moment).catch(err => console.error('[Sync] Moment sync failed:', err));
    });
  }, [syncMoment, setOnMomentChanged]);

  const handleMomentTap = useCallback((moment: Moment) => {
    setActiveMoment(moment);
    markMomentSeen(moment.id);
  }, [markMomentSeen]);

  const handleMomentClose = useCallback(() => {
    setActiveMoment(null);
  }, []);

  const handleCalendarTap = useCallback(() => {
    setShowCalendarAgenda(true);
  }, []);

  const handleTodoTap = useCallback(() => {
    setShowTodoList(true);
  }, []);

  const handleShowAllMoments = useCallback(() => {
    setShowAllMoments(true);
  }, []);

  const handleSelectMomentFromList = useCallback((moment: Moment) => {
    setShowAllMoments(false);
    setActiveMoment(moment);
  }, []);

  const handleNewMoment = useCallback(() => {
    if (authStatus !== 'linked') {
      setMomentError('Please log in to create a moment.');
      setTimeout(() => setMomentError(null), 5000);
      return;
    }
    if (memories.length === 0) {
      setMomentError('You don\'t have any notes yet. Save some notes first, then come back to create a synthesis!');
      setTimeout(() => setMomentError(null), 5000);
      return;
    }
    setShowCreateMoment(true);
  }, [authStatus, memories.length]);

  const [momentError, setMomentError] = useState<string | null>(null);

  const ERROR_DISPLAY_DURATION = 5000;

  useEffect(() => {
    if (momentError) {
      const timerId = setTimeout(() => {
        setMomentError(null);
      }, ERROR_DISPLAY_DURATION);
      return () => clearTimeout(timerId);
    }
  }, [momentError]);

  const handleCreateMomentSubmit = useCallback(async (objective: string) => {
    setMomentError(null);
    const moment = await createNewMoment(objective, memories);
    setShowCreateMoment(false);
    if (moment) {
      setActiveMoment(moment);
    } else {
      setMomentError('Failed to create moment. Please check your connection and try again.');
    }
  }, [createNewMoment, memories]);

  const handleFullRefresh = useCallback(async () => {
      const [, , , , report] = await Promise.all([
        refreshMemories(),
        refreshMoments(),
        refreshEvents(),
        refreshTodoItems(),
        reconcileEmbeddings(),
      ]);
      setReconcileReport(report);
  }, [refreshMemories, refreshMoments, refreshEvents, refreshTodoItems]);

  const syncRef = useRef(sync);
  const refreshRef = useRef(handleFullRefresh);
  const topNavRef = useRef<HTMLDivElement>(null);
  const [topNavHeight, setTopNavHeight] = useState(0);

  useEffect(() => {
    syncRef.current = sync;
    refreshRef.current = handleFullRefresh;
  }, [sync, handleFullRefresh]);

  useLayoutEffect(() => {
    const el = topNavRef.current;
    if (!el) return;
    const update = () => setTopNavHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const {
    isSettingsOpen,
    setIsSettingsOpen,
  } = useSettings();

  const handleCaptureClose = useCallback(() => {
    setIsCaptureOpen(false);
    setQuickNoteExpandState(null);
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
            const code = params.get('code') || '';
            const error = params.get('error') || '';

            // Validate code format (Google auth codes are alphanumeric with limited symbols)
            if (code && !/^[A-Za-z0-9/_.-]+$/.test(code)) {
                console.error('Invalid OAuth code format');
                return;
            }

            // Build scheme URL with properly encoded parameters
            const schemeParams = new URLSearchParams({ code, error });
            const schemeUrl = `com.saveitforl8r.app://google-auth?${schemeParams.toString()}`;

            console.log("Bouncing to native app:", schemeUrl);
            window.location.href = schemeUrl;

            // Visual feedback using safe DOM construction (avoid innerHTML XSS)
            const container = document.createElement('div');
            container.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#111827;color:white;font-family:sans-serif;';
            const heading = document.createElement('h2');
            heading.textContent = 'Redirecting to App...';
            const para = document.createElement('p');
            para.textContent = 'If not redirected, ';
            const link = document.createElement('a');
            link.href = schemeUrl;
            link.textContent = 'click here';
            link.style.color = '#3b82f6';
            para.appendChild(link);
            para.appendChild(document.createTextNode('.'));
            container.appendChild(heading);
            container.appendChild(para);
            document.body.replaceChildren(container);
        }
    }
  }, []);

  // INITIALIZATION EFFECT - runs once on mount and when auth status changes.
  // Heavy operations (reconcile, sync) are deferred so the UI is interactive
  // immediately — tapping the quick note bar brings up the keyboard without
  // competing for the main thread.
  useEffect(() => {
    initGA();
    logPageView('home');

    // Defer non-critical background work so user interactions (e.g. tapping
    // the quick note bar to open the keyboard) are not blocked.
    setTimeout(() => {
      reconcileEmbeddings().then(setReconcileReport).catch(console.error);

      if (authStatus === 'linked') {
          syncRef.current().then(() => {
              return refreshRef.current();
          }).then(() => {
              // Auto-retry enrichment for memories that failed while
              // unauthenticated. We read from storage after sync+refresh
              // so we operate on the latest data, not a stale closure.
              return getStoredMemories();
          }).then(freshMemories => {
              const pendingIds = freshMemories
                .filter(m => !m.isDeleted && (m.isPending || m.processingError))
                .map(m => m.id);
              if (pendingIds.length > 0) {
                  console.log(`[App] Auth linked — auto-retrying ${pendingIds.length} failed memories`);
                  pendingIds.forEach(id => handleRetry(id));
              }
          }).catch(err => {
              console.error('[App] Initial sync failed:', err);
          });
      }
    }, 0);
  }, [authStatus]);

  // Render notes incrementally as they are downloaded during sync, rather
  // than waiting for the entire sync to finish. A debounce timer coalesces
  // rapid per-item callbacks into batched refreshes (~300ms apart).
  const syncProgressTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    const debouncedRefresh = () => {
      if (syncProgressTimerRef.current) clearTimeout(syncProgressTimerRef.current);
      syncProgressTimerRef.current = setTimeout(() => {
        refreshMemories();
        refreshMoments();
        refreshEvents();
        refreshTodoItems();
      }, 300);
    };
    setOnSyncProgress(debouncedRefresh);
    return () => {
      setOnSyncProgress(undefined);
      if (syncProgressTimerRef.current) clearTimeout(syncProgressTimerRef.current);
    };
  }, [setOnSyncProgress, refreshMemories, refreshMoments, refreshEvents, refreshTodoItems]);

  // Refresh memory state after periodic/visibility-triggered sync downloads
  // complete. The init effect above handles the first sync; this covers
  // subsequent background syncs that write to IndexedDB without updating
  // React state.
  const wasSyncingDownload = useRef(false);
  useEffect(() => {
    if (wasSyncingDownload.current && !isSyncingDownload) {
      refreshMemories();
    }
    wasSyncingDownload.current = isSyncingDownload;
  }, [isSyncingDownload, refreshMemories]);

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
      if (viewingGallery) {
        setViewingGallery(null);
      } else if (showTodoList) {
        setShowTodoList(false);
      } else if (showCalendarAgenda) {
        setShowCalendarAgenda(false);
      } else if (activeMoment) {
        setActiveMoment(null);
      } else if (showAllMoments) {
        setShowAllMoments(false);
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
  }, [viewingGallery, expandedMemory, isSettingsOpen, editingMemory, isCaptureOpen, view, activeMoment, showAllMoments, showCalendarAgenda, showTodoList, handleCaptureClose, handleEditClose]);

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
    removeNoteFromMoments(id).catch(err => console.error('[Moments] Failed to remove note from moments:', err));
    removeEventsForMemory(id).then(tombstones => {
      if (tombstones.length > 0) {
        syncCalendarEvents(tombstones).catch(err => console.error('[Calendar] Failed to sync deleted events:', err));
      }
    }).catch(err => console.error('[Calendar] Failed to remove events for memory:', err));
    removeTodoItemsForMemory(id).then(tombstones => {
      if (tombstones.length > 0) {
        syncTodoItems(tombstones).catch(err => console.error('[Todo] Failed to sync deleted items:', err));
      }
    }).catch(err => console.error('[Todo] Failed to remove items for memory:', err));
    logEvent(ANALYTICS_EVENTS.MEMORY.CATEGORY, ANALYTICS_EVENTS.MEMORY.ACTION_DELETED);
    if (expandedMemory?.id === id) setExpandedMemory(null);
  }, [handleDelete, expandedMemory, deleteNoteFromIndex, removeNoteFromMoments, removeEventsForMemory, syncCalendarEvents, removeTodoItemsForMemory, syncTodoItems]);

  const handleRetryMemory = useCallback((id: string) => {
    handleRetry(id);
    logEvent(ANALYTICS_EVENTS.MEMORY.CATEGORY, ANALYTICS_EVENTS.MEMORY.ACTION_RETRIED);
  }, [handleRetry]);

  const handleTogglePin = useCallback((id: string, isPinned: boolean) => {
    togglePin(id, isPinned);
  }, [togglePin]);

  const handleViewAttachment = useCallback((attachment: Attachment, allAttachments: Attachment[]) => {
    const index = allAttachments.findIndex(a => a.id === attachment.id);
    setViewingGallery({ attachments: allAttachments, currentIndex: Math.max(0, index) });
  }, []);

  const handleOpenCapture = useCallback(() => {
    setIsCaptureOpen(true);
    logEvent(ANALYTICS_EVENTS.NAVIGATION.CATEGORY, ANALYTICS_EVENTS.NAVIGATION.ACTION_CAPTURE_OPENED, 'FAB');
  }, []);

  const handleQuickNoteSave = useCallback(async (text: string, attachments: Attachment[], tags: string[]) => {
    await createMemory(text, attachments, tags);
    logEvent(ANALYTICS_EVENTS.QUICK_NOTE.CATEGORY, ANALYTICS_EVENTS.QUICK_NOTE.ACTION_SAVED);
  }, [createMemory]);

  const handleQuickNoteExpand = useCallback((state: QuickNoteState) => {
    setQuickNoteExpandState(state);
    setIsCaptureOpen(true);
    logEvent(ANALYTICS_EVENTS.QUICK_NOTE.CATEGORY, ANALYTICS_EVENTS.QUICK_NOTE.ACTION_EXPANDED);
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
    'Mod+k': () => quickNoteBarRef.current?.focus(),
    'Mod+f': () => setView(ViewMode.RECALL),
    'Mod+,': () => setIsSettingsOpen(true),
  });

  const displayMemories = useMemo(() => {
    const active = filteredMemories.filter(m => !m.isDeleting);
    return active.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.timestamp - a.timestamp;
    });
  }, [filteredMemories]);

  const activeMemoryCount = useMemo(() => memories.filter(m => !m.isDeleted).length, [memories]);

  // Snapshot the sync status map so components re-render when statuses change
  const syncStatusMap = useMemo(() => new Map(getSyncStatusMap()), [syncStatusVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep expanded memory in sync with the memories array so checklist
  // toggles and other content updates are reflected immediately.
  const liveExpandedMemory = useMemo(() => {
    if (!expandedMemory) return null;
    return memories.find(m => m.id === expandedMemory.id) || expandedMemory;
  }, [expandedMemory, memories]);

  // Keep active moment in sync with moments list so pending→completed
  // transitions are reflected in the MomentSheet automatically.
  const liveActiveMoment = useMemo(() => {
    if (!activeMoment) return null;
    return moments.find(m => m.id === activeMoment.id) || activeMoment;
  }, [activeMoment, moments]);

  const isUpdateAvailable = isNative() ? nativeUpdateAvailable : updateAvailable;
  const versionToDisplay = isNative() ? nativeVersion : appVersion;

  if (editingMemory) {
    return (
      <ErrorBoundary
        fallbackTitle="Memory editor encountered an error"
        fallbackMessage="Something went wrong while editing. Your data is safe — try reloading."
      >
        <Suspense fallback={null}>
          <NewMemoryPage
              onClose={handleEditClose}
              onCreate={handleCreateMemory}
              onUpdate={handleUpdateMemory}
              editMemory={editingMemory}
            />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (isCaptureOpen) {
    const expandInitial = quickNoteExpandState ? {
      text: quickNoteExpandState.content,
      attachments: quickNoteExpandState.attachments,
      tags: quickNoteExpandState.tags,
    } : undefined;
    return (
      <ErrorBoundary
        fallbackTitle="Memory capture encountered an error"
        fallbackMessage="Something went wrong while capturing. Your data is safe — try reloading."
      >
        <Suspense fallback={null}>
          <NewMemoryPage
              onClose={handleCaptureClose}
              onCreate={handleCreateMemory}
              initialContent={expandInitial || (shareData ? { ...shareData, text: escapeHtml(shareData.text) } : undefined)}
            />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (view === ViewMode.RECALL) {
     return (
        <>
          <ErrorBoundary
            fallbackTitle="Brain Search encountered an error"
            fallbackMessage="The AI search feature hit an unexpected issue. Your memories are safe — try reloading."
          >
            <Suspense fallback={null}>
              <ChatInterface
                  memories={displayMemories}
                  onClose={handleChatClose}
                  searchFunction={search}
                  onViewAttachment={handleViewAttachment}
                  onDelete={handleDeleteMemory}
                  onEdit={handleEditMemory}
                  onTogglePin={handleTogglePin}
                />
            </Suspense>
          </ErrorBoundary>
          {viewingGallery && (
            <ErrorBoundary
              fallbackTitle="Gallery encountered an error"
              fallbackMessage="Something went wrong displaying media. Your data is safe — try reloading."
            >
              <GalleryViewer
                  attachments={viewingGallery.attachments}
                  initialIndex={viewingGallery.currentIndex}
                  onClose={() => setViewingGallery(null)}
                />
            </ErrorBoundary>
          )}
        </>
     );
  }

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Main UI — hidden when MomentCreationDialog is open */}
      {!showCreateMoment ? (
        <>
          <div ref={topNavRef} className="sticky top-0 z-(--z-overlay) bg-black/90 backdrop-blur-md border-b border-gray-800/50 pt-[var(--sat)]">
              <TopNavigation
                setView={handleSetView}
                resetFilters={handleResetFilters}
                onSettingsClick={handleSettingsClick}
                updateAvailable={isUpdateAvailable}
                onUpdateApp={handleUpdateApp}
                syncError={!!syncError}
                isSyncingDownload={isSyncingDownload}
                modelStatus={modelStatus}
                isOtaDownloading={isOtaDownloading}
              />
          </div>

          <MomentsStrip
            moments={moments}
            onMomentTap={handleMomentTap}
            onNewMoment={handleNewMoment}
            onShowAll={handleShowAllMoments}
            onCalendarTap={handleCalendarTap}
            calendarEventCount={calendarUpcomingCount}
            onTodoTap={handleTodoTap}
            todoPendingCount={todoPendingCount}
            synthesisLoading={synthesisLoading}
          />

          {availableTypes.length > 0 && (
            <div className="sticky z-(--z-dropdown) bg-(--color-surface-base) backdrop-blur-md border-b border-gray-800/50" style={{ top: `${topNavHeight}px` }}>
              <FilterBar
                availableTypes={availableTypes}
                filterType={filterType}
                setFilterType={handleSetFilterType}
                clearFilters={handleResetFilters}
              />
            </div>
          )}

          <main className="flex-1 p-4 sm:p-8 pb-24 max-w-7xl mx-auto w-full relative">
            {isLoading ? (
              <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className="break-inside-avoid rounded-xl bg-(--color-surface-raised) border border-(--color-border-subtle) p-4 animate-pulse">
                    <div className="h-4 bg-gray-700/50 rounded w-3/4 mb-3"></div>
                    <div className="h-3 bg-gray-700/30 rounded w-full mb-2"></div>
                    <div className="h-3 bg-gray-700/30 rounded w-5/6 mb-2"></div>
                    <div className="h-3 bg-gray-700/30 rounded w-2/3"></div>
                  </div>
                ))}
              </div>
            ) : filteredMemories.length === 0 ? (
              <EmptyState
                hasMemories={memories.length > 0}
                clearFilters={handleClearFiltersEmptyState}
              />
            ) : (
              <VirtualizedMemoryGrid
                memories={displayMemories}
                onDelete={handleDeleteMemory}
                onRetry={handleRetryMemory}
                onUpdate={updateMemoryContent}
                onExpand={setExpandedMemory}
                onViewAttachment={handleViewAttachment}
                onTogglePin={handleTogglePin}
                onEdit={handleEditMemory}
                isAuthenticated={authStatus === 'linked'}
                onSignIn={login}
                syncStatusMap={syncStatusMap}
                onSyncRetry={retrySyncFile}
              />
            )}
          </main>

          <QuickNoteBar
            ref={quickNoteBarRef}
            onSave={handleQuickNoteSave}
            onExpand={handleQuickNoteExpand}
          />
        </>
      ) : (
        <>
          {/* Overlay for MomentCreationDialog */}
          <div
            className="fixed inset-0 z-(--z-overlay) bg-black/60 backdrop-blur-sm animate-in fade-in duration-(--duration-fast)"
            aria-hidden
          />
          {/* Spacer to maintain layout when main content is hidden for moment creation */}
          <div className="flex-1" />
        </>
      )}

      {liveExpandedMemory && (
        <div className="fixed inset-0 z-(--z-sheet) bg-black/90 backdrop-blur-md flex flex-col animate-in fade-in duration-(--duration-normal)">
          <div className="sticky top-0 z-10 px-4 py-3 border-b border-gray-800 flex items-center justify-between bg-black/50 backdrop-blur-xl pt-[var(--sat)]">
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
                    memory={liveExpandedMemory}
                    onDelete={handleDeleteMemory}
                    onRetry={handleRetryMemory}
                    onUpdate={updateMemoryContent}
                    onViewAttachment={handleViewAttachment}
                    onTogglePin={handleTogglePin}
                    onEdit={handleEditMemory}
                    isDialog={true}
                    isAuthenticated={authStatus === 'linked'}
                    onSignIn={login}
                    syncStatus={syncStatusMap.get(liveExpandedMemory.id)}
                    onSyncRetry={retrySyncFile}
                />
             </div>
          </div>
        </div>
      )}

      {viewingGallery && (
          <ErrorBoundary
            fallbackTitle="Gallery encountered an error"
            fallbackMessage="Something went wrong displaying media. Your data is safe — try reloading."
          >
            <GalleryViewer
              attachments={viewingGallery.attachments}
              initialIndex={viewingGallery.currentIndex}
              onClose={() => setViewingGallery(null)}
            />
          </ErrorBoundary>
      )}

      {isSettingsOpen && (
          <Suspense fallback={null}>
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
                notificationsSupported={notificationsSupported}
                notificationsEnabled={notificationsEnabled}
                notificationPermission={notificationPermission}
                notificationTime={notificationTime}
                onNotificationsEnabledChange={setNotificationsEnabled}
                onNotificationTimeChange={setNotifTime}
                onRequestNotificationPermission={requestNotificationPermission}
            />
          </Suspense>
      )}

      {liveActiveMoment && (
        <Suspense fallback={null}>
          <MomentSheet
            moment={liveActiveMoment}
            memories={memories}
            onClose={handleMomentClose}
            loadSynthesis={loadSynthesis}
            onDelete={deleteMoment}
            onViewAttachment={handleViewAttachment}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <MomentCreationDialog
          isOpen={showCreateMoment}
          isCreating={momentCreating}
          onClose={() => setShowCreateMoment(false)}
          onCreate={handleCreateMomentSubmit}
        />
      </Suspense>

      {showAllMoments && (
        <Suspense fallback={null}>
          <AllMomentsSheet
            moments={moments}
            onClose={() => setShowAllMoments(false)}
            onSelectMoment={handleSelectMomentFromList}
          />
        </Suspense>
      )}

      {showCalendarAgenda && (
        <Suspense fallback={null}>
          <CalendarAgendaView
            events={calendarEvents}
            memories={memories}
            onClose={() => setShowCalendarAgenda(false)}
            onViewAttachment={handleViewAttachment}
            onDelete={handleDeleteMemory}
            onEdit={handleEditMemory}
            onTogglePin={handleTogglePin}
          />
        </Suspense>
      )}

      {showTodoList && (
        <Suspense fallback={null}>
          <TodoListView
            items={todoItems}
            memories={memories}
            pendingCount={todoPendingCount}
            onClose={() => setShowTodoList(false)}
            onToggleComplete={async (itemId) => {
              const updated = await toggleTodoComplete(itemId);
              if (updated) {
                try {
                  await syncTodoItems([updated]);
                } catch (err) {
                  console.error('[Todo] Failed to sync toggled item:', err);
                }
              }
            }}
            onDismiss={async (itemId) => {
              const updated = await dismissTodoItem(itemId);
              if (updated) {
                try {
                  await syncTodoItems([updated]);
                } catch (err) {
                  console.error('[Todo] Failed to sync dismissed item:', err);
                }
              }
            }}
            onRestore={async (itemId) => {
              const updated = await restoreTodoItem(itemId);
              if (updated) {
                try {
                  await syncTodoItems([updated]);
                } catch (err) {
                  console.error('[Todo] Failed to sync restored item:', err);
                }
              }
            }}
            onViewAttachment={handleViewAttachment}
            onDelete={handleDeleteMemory}
            onEdit={handleEditMemory}
            onTogglePin={handleTogglePin}
          />
        </Suspense>
      )}

      {momentError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-(--z-toast) bg-red-900/90 border border-red-700/50 text-red-200 px-4 py-3 rounded-xl text-sm font-medium shadow-lg animate-in fade-in slide-in-from-top-2 duration-(--duration-normal) max-w-sm text-center backdrop-blur-md">
          {momentError}
        </div>
      )}

      {isOtaDownloading && (
        <div className="fixed inset-0 z-(--z-tooltip) bg-black/95 backdrop-blur-md flex flex-col items-center justify-center gap-6">
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