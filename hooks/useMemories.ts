import { useState, useEffect, useCallback, useRef } from 'react';
import { getMemories, deleteMemory, saveMemory, getMemory } from '../services/storageService';
import { submitEnrichment } from '../services/geminiService';
import { Memory, Attachment, Moment, CalendarEvent, TodoItem, UploadProgress } from '../types';
import { uploadFileChunked } from '../services/chunkUploadService';
import { useSync } from './useSync';
import { useAuth } from './useAuth';
import { useEnrichmentPolling } from './useEnrichmentPolling';
import { logEvent } from '../services/analytics';
import { ANALYTICS_EVENTS } from '../constants';

/** Builds the lightweight moments metadata array sent with enrichment requests. */
const buildMomentsMeta = (moments: Moment[]) => {
  const active = moments
    .filter(m => !m.isDeleted)
    .map(m => ({ id: m.id, objective: m.objective, refinedObjective: m.refinedObjective, title: m.title, type: m.type }));
  return active.length > 0 ? active : undefined;
};

export const useMemories = () => {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { sync, syncFile } = useSync();
  const { authStatus } = useAuth();
  const mounted = useRef(false);

  // Moments ref and callback for enrichment-time moment matching
  const momentsRef = useRef<Moment[]>([]);
  const onNoteMatchedMomentsRef = useRef<((momentId: string, noteId: string) => Promise<void>) | undefined>(undefined);

  const setMomentsRef = useCallback((moments: Moment[]) => {
    momentsRef.current = moments;
  }, []);

  const setOnNoteMatchedMoments = useCallback((cb: (momentId: string, noteId: string) => Promise<void>) => {
    onNoteMatchedMomentsRef.current = cb;
  }, []);

  // Calendar events callback for enrichment-time event extraction
  const onEnrichmentCompleteCalendarRef = useRef<((memory: Memory) => Promise<CalendarEvent[]>) | undefined>(undefined);

  const setOnEnrichmentCompleteCalendar = useCallback((cb: (memory: Memory) => Promise<CalendarEvent[]>) => {
    onEnrichmentCompleteCalendarRef.current = cb;
  }, []);

  // Todo items callback for enrichment-time action item extraction
  const onEnrichmentCompleteTodoRef = useRef<((memory: Memory) => Promise<TodoItem[]>) | undefined>(undefined);

  const setOnEnrichmentCompleteTodo = useCallback((cb: (memory: Memory) => Promise<TodoItem[]>) => {
    onEnrichmentCompleteTodoRef.current = cb;
  }, []);

  // Todo items sync callback — set by App.tsx to sync items to Drive
  const onTodoItemsSyncRef = useRef<((items: TodoItem[]) => Promise<void>) | undefined>(undefined);

  const setOnTodoItemsSync = useCallback((cb: (items: TodoItem[]) => Promise<void>) => {
    onTodoItemsSyncRef.current = cb;
  }, []);

  // Calendar events sync callback — set by App.tsx to sync events to Drive
  const onCalendarEventsSyncRef = useRef<((events: CalendarEvent[]) => Promise<void>) | undefined>(undefined);

  const setOnCalendarEventsSync = useCallback((cb: (events: CalendarEvent[]) => Promise<void>) => {
    onCalendarEventsSyncRef.current = cb;
  }, []);

  // Upload progress tracking — mirrors the syncStatusMap pattern
  const [uploadProgressVersion, setUploadProgressVersion] = useState(0);
  const uploadProgressMapRef = useRef<Map<string, UploadProgress>>(new Map());

  const updateUploadProgress = useCallback((memoryId: string, progress: UploadProgress | null) => {
    if (progress === null) {
      uploadProgressMapRef.current.delete(memoryId);
    } else {
      uploadProgressMapRef.current.set(memoryId, progress);
    }
    setUploadProgressVersion(v => v + 1);
  }, []);

  const getUploadProgressMap = useCallback(() => uploadProgressMapRef.current, []);

  // Abort controllers for in-progress chunked uploads, keyed by memoryId
  const uploadAbortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Cancel all in-progress uploads on unmount
  useEffect(() => {
    return () => {
      uploadAbortControllersRef.current.forEach(controller => controller.abort());
      uploadAbortControllersRef.current.clear();
    };
  }, []);

  const recoveryAttemptedRef = useRef(false);
  const memoriesRef = useRef(memories);

  // Keep memoriesRef in sync for use inside polling closure
  useEffect(() => { memoriesRef.current = memories; }, [memories]);

  // Helper for single file sync - Memoized
  const trySyncFile = useCallback(async (memory: Memory) => {
      if (authStatus === 'linked') {
          syncFile(memory).catch(err => console.error("Single file sync failed:", err));
      }
  }, [authStatus, syncFile]);

  // Enrichment polling — extracted into a dedicated hook to eliminate
  // duplicated result-handling logic that was in 3 separate places.
  // The onEnrichmentComplete callback also handles moment matching.
  const { startPolling, recoverPending } = useEnrichmentPolling({
    memoriesRef,
    setMemories,
    onEnrichmentComplete: useCallback((memory: Memory) => {
      logEvent(ANALYTICS_EVENTS.ENRICHMENT.CATEGORY, ANALYTICS_EVENTS.ENRICHMENT.ACTION_COMPLETED);
      if (authStatus === 'linked') {
        syncFile(memory).catch(err => console.error("Sync failed:", err));
      }
      // Handle moment matching from enrichment results
      const matched = memory.enrichment?.matchedMomentIds;
      if (matched && matched.length > 0) {
        if (onNoteMatchedMomentsRef.current) {
          for (const momentId of matched) {
            onNoteMatchedMomentsRef.current(momentId, memory.id).catch(err =>
              console.error(`[Moments] Failed to add note to moment ${momentId}:`, err)
            );
          }
        } else {
          console.warn(`[Moments] matchedMomentIds present but onNoteMatchedMomentsRef not set — notes not added to moments`);
        }
      }
      // Process calendar events from enrichment results and sync to Drive
      if (onEnrichmentCompleteCalendarRef.current) {
        onEnrichmentCompleteCalendarRef.current(memory).then(eventsToSync => {
          if (eventsToSync.length > 0 && onCalendarEventsSyncRef.current) {
            onCalendarEventsSyncRef.current(eventsToSync).catch(err =>
              console.error(`[Calendar] Failed to sync calendar events:`, err)
            );
          }
        }).catch(err =>
          console.error(`[Calendar] Failed to process detected events:`, err)
        );
      }
      // Process todo items from enrichment results and sync to Drive
      if (onEnrichmentCompleteTodoRef.current) {
        onEnrichmentCompleteTodoRef.current(memory).then(itemsToSync => {
          if (itemsToSync.length > 0 && onTodoItemsSyncRef.current) {
            onTodoItemsSyncRef.current(itemsToSync).catch(err =>
              console.error(`[Todo] Failed to sync todo items:`, err)
            );
          }
        }).catch(err =>
          console.error(`[Todo] Failed to process detected action items:`, err)
        );
      }
    }, [authStatus, syncFile]),
  });

  const refreshMemories = useCallback(async () => {
    try {
        const loaded = await getMemories();
        const activeMemories = loaded.filter(m => !m.isDeleted);
        setMemories(activeMemories);
    } catch (error) {
        console.error("Failed to refresh memories:", error);
    } finally {
        setIsLoading(false);
    }
  }, []);

  // Initial load only
  useEffect(() => {
    if (!mounted.current) {
        refreshMemories();
        mounted.current = true;
    }
  }, [refreshMemories]);

  // Auto-recover pending enrichments on app load
  useEffect(() => {
    if (isLoading || recoveryAttemptedRef.current) return;
    recoveryAttemptedRef.current = true;

    const pendingMemories = memories.filter(m => m.isPending);
    if (pendingMemories.length === 0) return;

    recoverPending(pendingMemories);
  }, [isLoading, memories, recoverPending]);

  // Auto-start polling if there are pending memories (e.g., after recovery leaves some as "processing")
  useEffect(() => {
    const hasPending = memories.some(m => m.isPending);
    if (hasPending) {
      startPolling();
    }
  }, [memories, startPolling]);

  const handleDelete = useCallback(async (id: string) => {
    setMemories(prev => prev.map(m => m.id === id ? { ...m, isDeleting: true } : m));

    try {
      const existing = await getMemory(id);
      if (existing && !existing.isDeleted) {
          const tombstone: Memory = {
              ...existing,
              isDeleted: true,
              timestamp: Date.now(),
              content: '',
              attachments: [],
              image: undefined
          };
          await saveMemory(tombstone);
          // Sync just this tombstone
          await trySyncFile(tombstone);
      } else if (!existing) {
          await deleteMemory(id);
      }

      setMemories(prev => prev.filter(m => m.id !== id));
    } catch (error) {
      console.error("Failed to delete memory:", error);
      alert("Could not delete memory. Please try again.");
      await refreshMemories();
    }
  }, [refreshMemories, trySyncFile]);

  // Threshold for chunked upload — base64 data longer than this is uploaded in chunks.
  // 20 attachments × 1.2 MB = ~24 MB worst-case inline payload, safely under Cloud Run's 32 MB body cap
  // (leaving headroom for JSON wrapper, text, tags, and moments metadata).
  const CHUNKED_UPLOAD_THRESHOLD = 1_200_000; // ~900KB decoded

  /**
   * Convert a base64 data URI to a Blob efficiently using fetch(),
   * which avoids the large intermediate string copies of atob().
   */
  const dataUriToBlob = async (dataUri: string, mimeType: string): Promise<Blob> => {
    try {
      const res = await fetch(dataUri);
      return await res.blob();
    } catch {
      // Fallback for environments where fetch(dataUri) is unsupported
      const b64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
      const binary = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return new Blob([binary], { type: mimeType });
    }
  };

  /**
   * Upload large attachments in chunks, then submit enrichment.
   * Small attachments are sent inline with the enrichment request as before.
   */
  const uploadAndEnrich = useCallback(async (
    memoryId: string,
    text: string,
    attachments: Attachment[],
    location: { latitude: number; longitude: number; accuracy?: number } | undefined,
    tags: string[],
    newMemory: Memory,
  ) => {
    const largeAtts = attachments.filter(a => a.data && a.data.length > CHUNKED_UPLOAD_THRESHOLD);
    let enrichmentAttachments = [...attachments];

    if (largeAtts.length > 0) {
      // Calculate total bytes for progress (approximate from base64 length)
      // data is guaranteed present — largeAtts is filtered by a.data above
      const totalBytes = largeAtts.reduce((sum, a) => {
        const b64 = a.data!.includes(',') ? a.data!.split(',')[1] : a.data!;
        return sum + Math.ceil(b64.length * 3 / 4);
      }, 0);

      updateUploadProgress(memoryId, { status: 'uploading', bytesUploaded: 0, totalBytes });

      // Create an AbortController so uploads can be cancelled on unmount
      const abortController = new AbortController();
      uploadAbortControllersRef.current.set(memoryId, abortController);

      try {
        let cumulativeUploaded = 0;
        const uploadedMap = new Map<string, { fileUri: string; geminiFileName: string }>();

        for (const att of largeAtts) {
          const blob = await dataUriToBlob(att.data!, att.mimeType);
          const prevUploaded = cumulativeUploaded;

          const result = await uploadFileChunked(
            blob, att.mimeType, att.name, memoryId,
            (bytes, _total) => {
              updateUploadProgress(memoryId, {
                status: 'uploading',
                bytesUploaded: prevUploaded + bytes,
                totalBytes,
              });
            },
            abortController.signal,
          );

          cumulativeUploaded += blob.size;
          uploadedMap.set(att.id, result);
        }

        // Replace large attachments with fileUri references for the enrichment request
        enrichmentAttachments = attachments.map(a => {
          const uploaded = uploadedMap.get(a.id);
          if (uploaded) return { ...a, fileUri: uploaded.fileUri, geminiFileName: uploaded.geminiFileName };
          return a;
        });

        updateUploadProgress(memoryId, { status: 'processing', bytesUploaded: totalBytes, totalBytes });
      } catch (uploadErr) {
        if (abortController.signal.aborted) {
          console.log('[Upload] Chunked upload cancelled for', memoryId);
        } else {
          console.error('[Upload] Chunked upload failed:', uploadErr);
        }
        updateUploadProgress(memoryId, { status: 'failed', bytesUploaded: 0, totalBytes });
        const failedMemory: Memory = { ...newMemory, isPending: false, processingError: true };
        await saveMemory(failedMemory);
        setMemories(prev => prev.map(m => m.id === memoryId ? failedMemory : m));
        return;
      } finally {
        uploadAbortControllersRef.current.delete(memoryId);
      }
    }

    // Submit enrichment (fileUri for uploaded attachments, inline data for small ones)
    startPolling();
    try {
      await submitEnrichment(text, enrichmentAttachments, location, tags, memoryId, buildMomentsMeta(momentsRef.current));
      updateUploadProgress(memoryId, null);
    } catch (err) {
      console.error('Enrichment submission failed:', err);
      updateUploadProgress(memoryId, null);
      const failedMemory: Memory = { ...newMemory, isPending: false, processingError: true };
      await saveMemory(failedMemory);
      setMemories(prev => prev.map(m => m.id === memoryId ? failedMemory : m));
    }
  }, [startPolling, updateUploadProgress]);

  const handleRetry = useCallback(async (id: string) => {
    const memory = memoriesRef.current.find(m => m.id === id);
    if (!memory) return;

    const attachments: Attachment[] = memory.attachments ? [...memory.attachments] : [];
    if (attachments.length === 0 && memory.image) {
        attachments.push({
            id: 'legacy-img',
            type: 'image',
            mimeType: 'image/jpeg',
            data: memory.image,
            name: 'Captured Image'
        });
    }

    // Guard: skip attachments whose data was not loaded (e.g. deferred from sync)
    const validAttachments = attachments.filter(a => a.data || a.fileUri);
    if (validAttachments.length < attachments.length) {
      console.warn(`[Retry] Skipping ${attachments.length - validAttachments.length} attachment(s) with missing data for memory ${id}`);
    }

    const pendingMemory: Memory = {
        ...memory,
        isPending: true,
        processingError: false,
        attachments: validAttachments.filter(a => a.id !== 'legacy-img'),
    };
    await saveMemory(pendingMemory);
    setMemories(prev => prev.map(m => m.id === id ? pendingMemory : m));

    // Use the same upload-then-enrich flow as createMemory
    await uploadAndEnrich(id, memory.content, validAttachments, memory.location, memory.tags, pendingMemory);
  }, [uploadAndEnrich]);

  const createMemory = useCallback(async (
    text: string,
    attachments: Attachment[],
    tags: string[],
    location?: { latitude: number; longitude: number; accuracy?: number }
  ) => {
      // 1. Prepare initial memory object — show card immediately
      const memoryId = crypto.randomUUID();
      const timestamp = Date.now();

      const newMemory: Memory = {
        id: memoryId,
        timestamp,
        content: text,
        attachments,
        tags,
        location,
        isPending: true,
        processingError: false
      };

      // 2. Save locally and show card
      setMemories(prev => [newMemory, ...prev]);
      await saveMemory(newMemory);
      trySyncFile(newMemory);

      // 3. Upload large attachments (if any) then submit enrichment
      uploadAndEnrich(memoryId, text, attachments, location, tags, newMemory);

      // Return immediately so the modal can close
      return Promise.resolve();
  }, [trySyncFile, uploadAndEnrich]);

  const updateMemoryContent = useCallback(async (id: string, newContent: string) => {
      setMemories(prev => prev.map(m => m.id === id ? { ...m, content: newContent } : m));

      try {
          const current = await getMemory(id);
          if (current) {
            const updated = { ...current, content: newContent, timestamp: Date.now() };
            await saveMemory(updated);
            await trySyncFile(updated);
          }
      } catch (e) {
          console.error("Update failed", e);
      }
  }, [trySyncFile]);

  const dismissDeletionCandidate = useCallback(async (id: string) => {
    setMemories(prev => prev.map(m => m.id === id ? { ...m, isDeletionDismissed: true } : m));
    try {
      const current = await getMemory(id);
      if (current) {
        const updated = { ...current, isDeletionDismissed: true };
        await saveMemory(updated);
        await trySyncFile(updated);
      }
    } catch (e) {
      console.error('Failed to dismiss deletion candidate', e);
      setMemories(prev => prev.map(m => m.id === id ? { ...m, isDeletionDismissed: false } : m));
    }
  }, [trySyncFile]);

  const togglePin = useCallback(async (id: string, isPinned: boolean) => {
    setMemories(prev => prev.map(m => m.id === id ? { ...m, isPinned } : m));
    try {
        const current = await getMemory(id);
        if (current) {
            const updated = { ...current, isPinned };
            await saveMemory(updated);
            await trySyncFile(updated);
        }
    } catch (e) {
        console.error("Failed to toggle pin", e);
        // Revert on error
        setMemories(prev => prev.map(m => m.id === id ? { ...m, isPinned: !isPinned } : m));
    }
  }, [trySyncFile]);

  const updateMemory = useCallback(async (
    id: string,
    text: string,
    attachments: Attachment[],
    tags: string[],
    location?: { latitude: number; longitude: number; accuracy?: number }
  ) => {
      const existing = await getMemory(id);
      if (!existing) {
          console.error("Memory not found for update:", id);
          return;
      }

      // Update content immediately with "Enriching..." state
      const updatedMemory: Memory = {
        ...existing,
        content: text,
        attachments,
        tags,
        location: location || existing.location,
        enrichment: undefined, // Clear old enrichment to force re-processing
        isPending: true,
        processingError: false,
        timestamp: Date.now()
      };

      // Update UI with new content and "Enriching..." state
      setMemories(prev => prev.map(m => m.id === id ? updatedMemory : m));

      // Save locally so if app closes, we at least have the text update
      await saveMemory(updatedMemory);

      // Sync immediately (save the text changes even before enrichment finishes)
      await trySyncFile(updatedMemory);

      // Submit enrichment with moments metadata and start polling
      startPolling();

      submitEnrichment(text, attachments, updatedMemory.location, tags, id, buildMomentsMeta(momentsRef.current))
        .catch(async (err) => {
            console.error("Update enrichment submission failed:", err);
            const current = await getMemory(id);
            if (!current || current.isDeleted) return;

            const failedMemory: Memory = {
                ...updatedMemory,
                isPending: false,
                processingError: true
            };
            await saveMemory(failedMemory);
            setMemories(prev => prev.map(m => m.id === id ? failedMemory : m));
        });

      return Promise.resolve();
  }, [trySyncFile, startPolling]);

  // Incremental upsert for sync-downloaded memories. Inserts new memories
  // or updates existing ones in-place without a full IDB reload.
  const upsertMemory = useCallback((memory: Memory) => {
    if (memory.isDeleted) {
      setMemories(prev => prev.filter(m => m.id !== memory.id));
      return;
    }
    setMemories(prev => {
      const idx = prev.findIndex(m => m.id === memory.id);
      if (idx >= 0) {
        // Update in-place — only replace if data actually changed
        const existing = prev[idx];
        if (existing.timestamp === memory.timestamp &&
            existing._attachmentsDeferred === memory._attachmentsDeferred) {
          return prev; // no change, avoid re-render
        }
        const next = [...prev];
        next[idx] = memory;
        return next;
      }
      // Insert new memory in sorted position (descending timestamp)
      const insertIdx = prev.findIndex(m => m.timestamp < memory.timestamp);
      if (insertIdx === -1) return [...prev, memory];
      const next = [...prev];
      next.splice(insertIdx, 0, memory);
      return next;
    });
  }, []);

  // Online recovery — uses the extracted recoverPending instead of
  // re-implementing the completed/failed/processing logic inline.
  useEffect(() => {
    const handleOnline = async () => {
      // Trigger sync if linked
      if (authStatus === 'linked') sync();

      // Recover pending enrichments from server
      const pendingItems = memoriesRef.current.filter(m => m.isPending);
      if (pendingItems.length > 0) {
          await recoverPending(pendingItems);
      }

      // Auto-retry enrichment for failed memories
      const failures = memoriesRef.current.filter(m => m.processingError);
      if (failures.length > 0) {
          failures.forEach(m => handleRetry(m.id));
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [sync, authStatus, handleRetry, recoverPending]);

  return {
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
  };
};
