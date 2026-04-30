import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { Bell, RefreshCw, X } from 'lucide-react';
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
import { btn, overlay } from './styles/design-system';
import AnimatedPresence from './components/AnimatedPresence';
import { useFrozenValue } from './hooks/useAnimatedUnmount';

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
const DeletionCandidatesSheet = lazyWithRetry(() => import('./components/DeletionCandidatesSheet'));

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
import { useDeletionCandidates } from './hooks/useDeletionCandidates';
import { useNotifications } from './hooks/useNotifications';
import useNativeOTA from './hooks/useNativeOTA';
import { useWidgetDeepLink } from './hooks/useWidgetDeepLink';
import { tryBackHandlers } from './hooks/useBackButton';
import { SyncProvider } from './context/SyncContext';
import { reconcileEmbeddings, ReconcileReport, getMemories as getStoredMemories } from './services/storageService';
import { ViewMode, Memory, Attachment, Moment, QuickNoteState, CalendarEvent } from './types';
import { initGA, logPageView, logEvent } from './services/analytics';
import { escapeHtml } from './utils/editorUtils';

import { ANALYTICS_EVENTS } from './constants';
import { handleDeepLink } from './services/googleAuth';

/** Must match --duration-sheet in index.css (used by overlay.sheetEnter / sheetExit). */
const SHEET_DURATION = 600;

/** Must match --duration-slow in index.css (used by overlay.viewEnter / viewExit / modalEnter / modalExit / backdropEnter / backdropExit). */
const VIEW_DURATION = 400;

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
  const [newMemoryId, setNewMemoryId] = useState<string | null>(null);
  const scrolledMemoryIdRef = useRef<string | null>(null);
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
  
  const { sync, isSyncing, isSyncingDownload, syncError, getSyncStatusMap, syncStatusVersion, retrySyncFile, setOnSyncProgress, setOnMemorySynced } = useSync();
  const { authStatus, login, unlink, recheckAuth } = useAuth();

  const { modelStatus, downloadProgress, retryDownload, search, embeddingStats, retryFailedEmbeddings, deleteNoteFromIndex, lastError, closeWorkerDB } = useAdaptiveSearch();

  const {
    memories,
    refreshMemories,
    upsertMemory,
    handleDelete,
    handleRetry,
    createMemory,
    updateMemory,
    updateMemoryContent,
    togglePin,
    dismissDeletionCandidate,
    isLoading,
    setMomentsRef,
    setOnNoteMatchedMoments,
    setOnEnrichmentCompleteCalendar,
    setOnCalendarEventsSync,
    setOnEnrichmentCompleteTodo,
    setOnTodoItemsSync,
    getUploadProgressMap,
    uploadProgressVersion,
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
  const [showDeletionCandidates, setShowDeletionCandidates] = useState(false);

  const deletionCandidates = useDeletionCandidates(memories, calendarEvents, todoItems);
  const [notifBannerDismissed, setNotifBannerDismissed] = useState(false);

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
    openSettings: openNotificationSettings,
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
  const handleRetryRef = useRef(handleRetry);

  useEffect(() => {
    syncRef.current = sync;
    refreshRef.current = handleFullRefresh;
    handleRetryRef.current = handleRetry;
  }, [sync, handleFullRefresh, handleRetry]);

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
                  pendingIds.forEach(id => handleRetryRef.current(id));
              }
          }).catch(err => {
              console.error('[App] Initial sync failed:', err);
          });
      }
    }, 0);
  }, [authStatus]);

  // Incrementally render cards as they are downloaded during sync.
  // Each synced memory is upserted into React state directly, avoiding
  // a full IDB reload per item (which caused jank and flickering).
  useEffect(() => {
    setOnMemorySynced(upsertMemory);
    return () => { setOnMemorySynced(undefined); };
  }, [setOnMemorySynced, upsertMemory]);

  // For non-memory entities (moments, events, todos), use a debounced
  // refresh on sync progress since they don't have incremental upsert.
  const syncProgressTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    const debouncedRefresh = () => {
      if (syncProgressTimerRef.current) clearTimeout(syncProgressTimerRef.current);
      syncProgressTimerRef.current = setTimeout(() => {
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
  }, [setOnSyncProgress, refreshMoments, refreshEvents, refreshTodoItems]);

  // Safety-net refresh after sync completes for moments/events/todos.
  // Memories are already up-to-date via incremental upsert.
  const wasSyncingDownload = useRef(false);
  useEffect(() => {
    if (wasSyncingDownload.current && !isSyncingDownload) {
      refreshMoments();
      refreshEvents();
      refreshTodoItems();
    }
    wasSyncingDownload.current = isSyncingDownload;
  }, [isSyncingDownload, refreshMoments, refreshEvents, refreshTodoItems]);

  // NATIVE DEEP LINK HANDLING (Google Auth)
  // Uses a ref for recheckAuth so the listener doesn't need to be re-added on every render.
  const recheckAuthRef = useRef(recheckAuth);
  useEffect(() => { recheckAuthRef.current = recheckAuth; }, [recheckAuth]);

  useEffect(() => {
    if (!isNative()) return;

    const handleUrlOpen = async (event: URLOpenListenerEvent) => {
        // Handle Google Auth Deep Link
        if (event.url.includes('google-auth')) {
            try {
                const success = await handleDeepLink(event.url);
                if (success) {
                    // Update React auth state directly instead of reloading
                    // the page — reload() is unreliable on Android when called
                    // from a deep link handler and prevents the init effect
                    // from triggering the first sync.
                    await recheckAuthRef.current();
                }
            } catch (e) {
                console.error("Deep link error:", e);
                alert("Login failed. Please try again.");
            }
        }
    };

    const listenerPromise = CapacitorApp.addListener('appUrlOpen', handleUrlOpen);

    return () => {
        listenerPromise.then(handle => handle.remove()).catch(e => console.error(e));
    };
  }, []);

  // NATIVE BACK BUTTON HANDLING - separate effect with UI state dependencies
  useEffect(() => {
    if (!isNative()) return;

    const handleBackButton = ({ canGoBack }: { canGoBack: boolean }) => {
      // First, let component-level handlers try (nested dialogs, previews, confirmations)
      if (tryBackHandlers()) return;

      // Then app-level state checks (outermost overlays first)
      if (viewingGallery) {
        setViewingGallery(null);
      } else if (showDeletionCandidates) {
        setShowDeletionCandidates(false);
      } else if (showTodoList) {
        setShowTodoList(false);
      } else if (showCalendarAgenda) {
        setShowCalendarAgenda(false);
      } else if (showCreateMoment) {
        setShowCreateMoment(false);
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
  }, [viewingGallery, expandedMemory, isSettingsOpen, setIsSettingsOpen, editingMemory, isCaptureOpen, view, activeMoment, showAllMoments, showCalendarAgenda, showTodoList, showDeletionCandidates, showCreateMoment, handleCaptureClose, handleEditClose]);

  useEffect(() => {
    if (shareData) {
      logEvent(ANALYTICS_EVENTS.SHARE.CATEGORY, ANALYTICS_EVENTS.SHARE.ACTION_RECEIVED, ANALYTICS_EVENTS.SHARE.LABEL_EXTERNAL);
      // Route shared content to the QuickNote bar instead of opening full editor
      if (quickNoteBarRef.current) {
        quickNoteBarRef.current.setContent(shareData.text, shareData.attachments);
        clearShareData();
      } else {
        setIsCaptureOpen(true);
        clearShareData();
      }
    }
  }, [shareData, clearShareData]);


  const {
    filterType,
    setFilterType,
    availableTypes,
    filteredMemories,
    clearFilters
  } = useMemoryFilters(memories);

  const handleCreateMemory = useCallback(async (text: string, attachments: any[], tags: string[], location?: { latitude: number; longitude: number }) => {
    const id = await createMemory(text, attachments, tags, location);
    setNewMemoryId(id);
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

  const handleDeleteNotes = useCallback(async (noteIds: string[]) => {
    await Promise.all(noteIds.map(async (id) => {
      try {
        await handleDelete(id);
        deleteNoteFromIndex(id);
        await removeNoteFromMoments(id);
        const eventTombstones = await removeEventsForMemory(id);
        if (eventTombstones.length > 0) {
          await syncCalendarEvents(eventTombstones);
        }
        const todoTombstones = await removeTodoItemsForMemory(id);
        if (todoTombstones.length > 0) {
          await syncTodoItems(todoTombstones);
        }
      } catch (err) {
        console.error(`[DeleteNotes] Failed to delete note ${id}:`, err);
      }
    }));
    logEvent(ANALYTICS_EVENTS.MEMORY.CATEGORY, ANALYTICS_EVENTS.MEMORY.ACTION_DELETED);
  }, [handleDelete, deleteNoteFromIndex, removeNoteFromMoments, removeEventsForMemory, syncCalendarEvents, removeTodoItemsForMemory, syncTodoItems]);

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
    let location: { latitude: number; longitude: number; accuracy?: number } | undefined;
    try {
      if (isNative()) {
        const { Geolocation } = await import('@capacitor/geolocation');
        const pos = await Promise.race([
          Geolocation.getCurrentPosition({ timeout: 5000 }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        if (pos) {
          location = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy };
        }
      } else if (navigator.geolocation) {
        const pos = await Promise.race([
          new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]) as GeolocationPosition | null;
        if (pos) {
          location = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy };
        }
      }
    } catch (e) {
      console.warn('QuickNote location unavailable', e);
    }
    const id = await createMemory(text, attachments, tags, location);
    setNewMemoryId(id);
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

  // Handle home screen widget deep links
  useWidgetDeepLink({
    onFocus: useCallback(() => quickNoteBarRef.current?.focus(), []),
    onCamera: useCallback(() => {
      quickNoteBarRef.current?.triggerCamera();
      logEvent(ANALYTICS_EVENTS.NAVIGATION.CATEGORY, ANALYTICS_EVENTS.NAVIGATION.ACTION_CAPTURE_OPENED, 'Widget-Camera');
    }, []),
    onDocument: useCallback(() => {
      quickNoteBarRef.current?.triggerDocument();
      logEvent(ANALYTICS_EVENTS.NAVIGATION.CATEGORY, ANALYTICS_EVENTS.NAVIGATION.ACTION_CAPTURE_OPENED, 'Widget-Document');
    }, []),
  });

  // Handle widget search deep link (cold + warm launch)
  useEffect(() => {
    const processWidgetSearch = () => {
      if (window.__pendingWidgetSearch) {
        delete window.__pendingWidgetSearch;
      }
      setView(ViewMode.RECALL);
    };

    window.addEventListener('onWidgetSearch', processWidgetSearch);

    // Handle events that arrived before the listener was attached (cold launch)
    if (window.__pendingWidgetSearch) {
      processWidgetSearch();
    }

    return () => window.removeEventListener('onWidgetSearch', processWidgetSearch);
  }, []);

  const displayMemories = useMemo(() => {
    const active = filteredMemories.filter(m => !m.isDeleting);
    return active.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.timestamp - a.timestamp;
    });
  }, [filteredMemories]);

  // After a new memory is added, scroll its card into view exactly once —
  // re-runs on displayMemories changes only until the card first renders,
  // so background sync updates don't re-trigger the scroll.
  useEffect(() => {
    if (!newMemoryId) {
      scrolledMemoryIdRef.current = null;
      return;
    }
    if (scrolledMemoryIdRef.current === newMemoryId) return;
    const el = document.querySelector(`[data-memory-id="${newMemoryId}"]`);
    if (!el) return;
    scrolledMemoryIdRef.current = newMemoryId;
    const raf = requestAnimationFrame(() => {
      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(raf);
  }, [newMemoryId, displayMemories]);

  // Clear the highlight after 1.5s. Independent of displayMemories so
  // list updates during the hold don't extend the highlight window.
  useEffect(() => {
    if (!newMemoryId) return;
    const timer = setTimeout(() => setNewMemoryId(null), 1500);
    return () => clearTimeout(timer);
  }, [newMemoryId]);

  const activeMemoryCount = useMemo(() => memories.filter(m => !m.isDeleted).length, [memories]);

  // Snapshot the sync status map so components re-render when statuses change
  const syncStatusMap = useMemo(() => new Map(getSyncStatusMap()), [syncStatusVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Snapshot the upload progress map so memory cards show upload progress
  const uploadProgressMap = useMemo(() => new Map(getUploadProgressMap()), [uploadProgressVersion]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const captureInitialContent = useMemo(() => {
    if (!isCaptureOpen) return undefined;
    if (quickNoteExpandState) {
      return {
        text: quickNoteExpandState.content,
        attachments: quickNoteExpandState.attachments,
        tags: quickNoteExpandState.tags,
      };
    }
    if (shareData) {
      return { ...shareData, text: escapeHtml(shareData.text) };
    }
    return undefined;
  }, [isCaptureOpen, quickNoteExpandState, shareData]);

  // Truly fullscreen views (opaque bg-black at z-sheet / z-modal) — QuickNoteBar must hide
  const isFullscreenViewOpen = !!editingMemory || isCaptureOpen || view === ViewMode.RECALL || !!viewingGallery;
  // Any overlay (fullscreen OR sheet) — feed behind gets pointer-events-none + aria-hidden
  const anyOverlayOpen = isFullscreenViewOpen || !!liveExpandedMemory || isSettingsOpen || !!liveActiveMoment || showAllMoments || showCalendarAgenda || showTodoList || showDeletionCandidates;

  // Keep feed locked during sheet exit animations so background elements
  // don't become interactive/accessible while the sheet is still sliding out.
  // Only engage on a real open → closed transition; on initial mount
  // anyOverlayOpen is already false, and locking here would disable the
  // QuickNoteBar, search button, and other feed controls for SHEET_DURATION
  // on cold start (visible as unresponsive UI on iOS launch).
  const [exitLock, setExitLock] = useState(false);
  const exitLockTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevAnyOverlayOpen = useRef(anyOverlayOpen);
  useEffect(() => {
    const wasOpen = prevAnyOverlayOpen.current;
    prevAnyOverlayOpen.current = anyOverlayOpen;
    if (anyOverlayOpen) {
      if (exitLockTimer.current) clearTimeout(exitLockTimer.current);
      setExitLock(false);
    } else if (wasOpen) {
      setExitLock(true);
      exitLockTimer.current = setTimeout(() => setExitLock(false), SHEET_DURATION);
    }
    return () => { if (exitLockTimer.current) clearTimeout(exitLockTimer.current); };
  }, [anyOverlayOpen]);
  const feedLocked = anyOverlayOpen || exitLock;

  // Freeze nullable values so content stays visible during exit animations.
  // When state becomes null (triggering AnimatedPresence exit), the frozen
  // value retains the last valid data so content doesn't vanish mid-animation.
  const frozenEditingMemory = useFrozenValue(editingMemory);
  const frozenExpandedMemory = useFrozenValue(liveExpandedMemory);
  const frozenActiveMoment = useFrozenValue(liveActiveMoment);
  const frozenViewingGallery = useFrozenValue(viewingGallery);
  const frozenMomentError = useFrozenValue(momentError);

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Feed layout — always rendered, overlaid by fullscreen views */}
      <div className={feedLocked ? 'pointer-events-none' : undefined} aria-hidden={feedLocked || undefined}>
        <div className="sticky top-0 z-(--z-overlay) bg-(--color-surface-base) pt-[var(--sat)]">
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
            {availableTypes.length > 0 && (
              <div className="bg-(--color-surface-base) backdrop-blur-md border-b border-(--color-border-default)/50">
                <FilterBar
                  availableTypes={availableTypes}
                  filterType={filterType}
                  setFilterType={handleSetFilterType}
                  clearFilters={handleResetFilters}
                />
              </div>
            )}
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
          deletionCandidateCount={deletionCandidates.length}
          onDeletionCandidatesTap={() => {
            setShowDeletionCandidates(true);
            logEvent(ANALYTICS_EVENTS.DELETION_CANDIDATES.CATEGORY, ANALYTICS_EVENTS.DELETION_CANDIDATES.ACTION_OPENED);
          }}
        />

        {notificationsSupported && notificationPermission === 'prompt' && !notifBannerDismissed && activeMemoryCount > 0 && (
          <div className="mx-4 sm:mx-8 my-3 flex items-center gap-3 p-3 bg-(--color-accent-muted) border border-(--color-accent)/30 rounded-(--radius-xl)">
            <Bell size={18} className="text-(--color-accent) shrink-0" />
            <p className="flex-1 text-sm text-(--color-text-secondary)">
              Enable notifications to get a daily briefing of your events and tasks.
            </p>
            <button
              onClick={async () => {
                await setNotificationsEnabled(true);
              }}
              className={`${btn.base} ${btn.primarySm} shrink-0`}
            >
              Enable
            </button>
            <button
              onClick={() => setNotifBannerDismissed(true)}
              className="shrink-0 p-1 text-(--color-text-tertiary) hover:text-(--color-text-secondary) transition-colors duration-(--duration-fast)"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-8 pb-24 max-w-7xl mx-auto w-full relative">
          {isLoading ? (
            <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="break-inside-avoid rounded-(--radius-xl) bg-(--color-surface-raised) border border-(--color-border-subtle) p-4 animate-pulse">
                  <div className="h-4 bg-(--color-surface-raised)/50 rounded w-3/4 mb-3"></div>
                  <div className="h-3 bg-(--color-surface-raised)/30 rounded w-full mb-2"></div>
                  <div className="h-3 bg-(--color-surface-raised)/30 rounded w-5/6 mb-2"></div>
                  <div className="h-3 bg-(--color-surface-raised)/30 rounded w-2/3"></div>
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
              uploadProgressMap={uploadProgressMap}
              highlightedMemoryId={newMemoryId}
            />
          )}
        </main>

        {!isFullscreenViewOpen && (
          <QuickNoteBar
            ref={quickNoteBarRef}
            onSave={handleQuickNoteSave}
            onExpand={handleQuickNoteExpand}
          />
        )}
      </div>

      {/* ─── Fullscreen view overlays (stacked, animated) ──────── */}

      <AnimatedPresence
        isOpen={!!editingMemory}
        enterClassName={overlay.viewEnter}
        exitClassName={overlay.viewExit}
        duration={VIEW_DURATION}
        className="fixed inset-0 z-(--z-sheet)"
      >
        <ErrorBoundary
          fallbackTitle="Memory editor encountered an error"
          fallbackMessage="Something went wrong while editing. Your data is safe — try reloading."
        >
          <Suspense fallback={null}>
            <NewMemoryPage
              onClose={handleEditClose}
              onCreate={handleCreateMemory}
              onUpdate={handleUpdateMemory}
              editMemory={frozenEditingMemory!}
            />
          </Suspense>
        </ErrorBoundary>
      </AnimatedPresence>

      <AnimatedPresence
        isOpen={isCaptureOpen}
        enterClassName={overlay.viewEnter}
        exitClassName={overlay.viewExit}
        duration={VIEW_DURATION}
        className="fixed inset-0 z-(--z-sheet)"
      >
        <ErrorBoundary
          fallbackTitle="Memory capture encountered an error"
          fallbackMessage="Something went wrong while capturing. Your data is safe — try reloading."
        >
          <Suspense fallback={null}>
            <NewMemoryPage
              onClose={handleCaptureClose}
              onCreate={handleCreateMemory}
              initialContent={captureInitialContent}
            />
          </Suspense>
        </ErrorBoundary>
      </AnimatedPresence>

      <AnimatedPresence
        isOpen={view === ViewMode.RECALL}
        enterClassName={overlay.viewEnter}
        exitClassName={overlay.viewExit}
        duration={VIEW_DURATION}
        className="fixed inset-0 z-(--z-modal)"
      >
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
      </AnimatedPresence>

      {/* ─── Overlay sheets (animated enter/exit) ──────────── */}

      <AnimatedPresence
        isOpen={!!liveExpandedMemory}
        enterClassName={overlay.backdropEnter}
        exitClassName={overlay.backdropExit}
        duration={VIEW_DURATION}
        className="fixed inset-0 z-(--z-sheet) bg-black/90 backdrop-blur-md flex flex-col"
      >
        <div className="sticky top-0 z-(--z-sticky) px-4 py-3 border-b border-(--color-border-default) flex items-center justify-between bg-(--color-surface-base)/50 backdrop-blur-xl pt-[var(--sat)]">
           <div className="flex items-center gap-3">
              <button onClick={() => setExpandedMemory(null)} className={overlay.closeBtn}>
                  <X size={24} />
              </button>
              <h2 className="text-lg font-bold text-(--color-text-primary) truncate max-w-[200px] sm:max-w-md">Memory Detail</h2>
           </div>
           <Logo className="w-8 h-8 text-(--color-accent) opacity-50" />
        </div>
        {frozenExpandedMemory && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-8">
             <div className="max-w-2xl mx-auto pb-20">
                <MemoryCard
                    memory={frozenExpandedMemory}
                    onDelete={handleDeleteMemory}
                    onRetry={handleRetryMemory}
                    onUpdate={updateMemoryContent}
                    onViewAttachment={handleViewAttachment}
                    onTogglePin={handleTogglePin}
                    onEdit={handleEditMemory}
                    isDialog={true}
                    isAuthenticated={authStatus === 'linked'}
                    onSignIn={login}
                    syncStatus={syncStatusMap.get(frozenExpandedMemory.id)}
                    onSyncRetry={retrySyncFile}
                    uploadProgress={uploadProgressMap.get(frozenExpandedMemory.id)}
                />
             </div>
          </div>
        )}
      </AnimatedPresence>

      <AnimatedPresence
        isOpen={isSettingsOpen}
        enterClassName={overlay.modalEnter}
        exitClassName={overlay.modalExit}
        duration={VIEW_DURATION}
        className="fixed inset-0 z-(--z-sheet)"
      >
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
              onOpenNotificationSettings={openNotificationSettings}
          />
        </Suspense>
      </AnimatedPresence>

      <AnimatedPresence
        isOpen={!!liveActiveMoment}
        enterClassName={overlay.sheetEnter}
        exitClassName={overlay.sheetExit}
        duration={SHEET_DURATION}
        className="fixed inset-0 z-(--z-sheet)"
      >
        <Suspense fallback={null}>
          {frozenActiveMoment && (
            <MomentSheet
              moment={frozenActiveMoment}
              memories={memories}
              onClose={handleMomentClose}
              loadSynthesis={loadSynthesis}
              onDelete={deleteMoment}
              onDeleteNotes={handleDeleteNotes}
              onViewAttachment={handleViewAttachment}
              onMemoryDelete={handleDeleteMemory}
              onMemoryEdit={handleEditMemory}
              onMemoryTogglePin={handleTogglePin}
            />
          )}
        </Suspense>
      </AnimatedPresence>

      <Suspense fallback={null}>
        <MomentCreationDialog
          isOpen={showCreateMoment}
          isCreating={momentCreating}
          onClose={() => setShowCreateMoment(false)}
          onCreate={handleCreateMomentSubmit}
        />
      </Suspense>

      <AnimatedPresence
        isOpen={showAllMoments}
        enterClassName={overlay.sheetEnter}
        exitClassName={overlay.sheetExit}
        duration={SHEET_DURATION}
        className="fixed inset-0 z-(--z-sheet)"
      >
        <Suspense fallback={null}>
          <AllMomentsSheet
            moments={moments}
            onClose={() => setShowAllMoments(false)}
            onSelectMoment={handleSelectMomentFromList}
          />
        </Suspense>
      </AnimatedPresence>

      <AnimatedPresence
        isOpen={showCalendarAgenda}
        enterClassName={overlay.sheetEnter}
        exitClassName={overlay.sheetExit}
        duration={SHEET_DURATION}
        className="fixed inset-0 z-(--z-sheet)"
      >
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
      </AnimatedPresence>

      <AnimatedPresence
        isOpen={showTodoList}
        enterClassName={overlay.sheetEnter}
        exitClassName={overlay.sheetExit}
        duration={SHEET_DURATION}
        className="fixed inset-0 z-(--z-sheet)"
      >
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
      </AnimatedPresence>

      <AnimatedPresence
        isOpen={showDeletionCandidates}
        enterClassName={overlay.sheetEnter}
        exitClassName={overlay.sheetExit}
        duration={SHEET_DURATION}
        className="fixed inset-0 z-(--z-sheet)"
      >
        <Suspense fallback={null}>
          <DeletionCandidatesSheet
            candidates={deletionCandidates}
            calendarEvents={calendarEvents}
            todoItems={todoItems}
            onClose={() => setShowDeletionCandidates(false)}
            onDelete={(id) => {
              handleDeleteMemory(id);
              logEvent(ANALYTICS_EVENTS.DELETION_CANDIDATES.CATEGORY, ANALYTICS_EVENTS.DELETION_CANDIDATES.ACTION_DELETED);
            }}
            onDismiss={(id) => {
              dismissDeletionCandidate(id);
              logEvent(ANALYTICS_EVENTS.DELETION_CANDIDATES.CATEGORY, ANALYTICS_EVENTS.DELETION_CANDIDATES.ACTION_DISMISSED);
            }}
            onViewAttachment={handleViewAttachment}
            onEdit={handleEditMemory}
            onTogglePin={handleTogglePin}
          />
        </Suspense>
      </AnimatedPresence>

      <AnimatedPresence
        isOpen={!!viewingGallery}
        enterClassName={overlay.viewerEnter}
        exitClassName={overlay.viewerExit}
        duration={150}
      >
        <ErrorBoundary
          fallbackTitle="Gallery encountered an error"
          fallbackMessage="Something went wrong displaying media. Your data is safe — try reloading."
        >
          {frozenViewingGallery && (
            <GalleryViewer
              attachments={frozenViewingGallery.attachments}
              initialIndex={frozenViewingGallery.currentIndex}
              onClose={() => setViewingGallery(null)}
            />
          )}
        </ErrorBoundary>
      </AnimatedPresence>

      <AnimatedPresence
        isOpen={!!momentError}
        enterClassName={overlay.toastEnter}
        exitClassName={overlay.toastExit}
        className="fixed top-4 left-1/2 -translate-x-1/2 z-(--z-toast) bg-(--color-danger)/90 border border-(--color-danger)/50 text-(--color-text-primary) px-4 py-3 rounded-(--radius-xl) text-sm font-medium shadow-lg max-w-sm text-center backdrop-blur-md"
      >
        {frozenMomentError}
      </AnimatedPresence>

      {isOtaDownloading && (
        <div className="fixed inset-0 z-(--z-tooltip) bg-black/95 backdrop-blur-md flex flex-col items-center justify-center gap-6">
          <Logo className="w-16 h-16 text-(--color-accent)" />
          <div className="flex flex-col items-center gap-3">
            <RefreshCw size={32} className="text-(--color-accent) animate-spin" />
            <h2 className="text-xl font-bold text-(--color-text-primary)">Downloading Update</h2>
            <p className="text-sm text-(--color-text-secondary) text-center max-w-xs">
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