import React, { createContext, useContext, useState, useCallback, ReactNode, useRef, useEffect } from 'react';
import { getMemories, getMemory, saveMemory, deleteMemory, reconcileEmbeddings, getAllMomentsIncludingDeleted, saveMoment, deleteMomentHard, getMomentSynthesis, saveMomentSynthesis, deleteMomentSynthesis, getAllCalendarEventsIncludingDeleted, saveCalendarEvent, deleteCalendarEventHard, getAllTodoItemsIncludingDeleted, updateTodoItem, deleteTodoItemHard } from '../services/storageService';

import {
    listAllFiles,
    downloadFilesStreaming,
    uploadFile,
    uploadMultipleFiles,
    findFileByName,
    findAllFilesByName,
    cleanupFilesByName,
    deleteFileById,
    isLinked as checkIsLinked,
    deleteRemoteNote,
    type DriveFile,
} from '../services/googleDriveService';
import { Memory, Attachment, Moment, MomentSynthesis, CalendarEvent, TodoItem, isMemoryInFlight, isMemoryFailed } from '../types';
import { useAuth } from '../hooks/useAuth';
import { storage } from '../services/platform';
import { enqueue as bgSyncEnqueue, peekAll as bgSyncPeekAll, remove as bgSyncRemove } from '../services/backgroundSyncQueue';
import { startForegroundSync, updateForegroundSyncProgress, stopForegroundSync } from '../services/nativeBackgroundSync';

type SyncStatus = 'syncing' | 'synced' | 'error';

interface SyncContextType {
  isSyncing: boolean;
  isSyncingDownload: boolean;
  syncError: string | null;
  sync: (forceFullSync?: boolean) => Promise<void>;
  syncFile: (memory: Memory) => Promise<void>;
  syncMoment: (moment: Moment) => Promise<void>;
  syncCalendarEvents: (events: CalendarEvent[]) => Promise<void>;
  syncTodoItems: (items: TodoItem[]) => Promise<void>;
  retrySyncFile: (memoryId: string) => Promise<void>;
  getSyncStatusMap: () => Map<string, SyncStatus>;
  syncStatusVersion: number;
  pendingCount: number;
  setOnSyncProgress: (cb: (() => void) | undefined) => void;
  setOnMemorySynced: (cb: ((memory: Memory) => void) | undefined) => void;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

const SNAPSHOT_KEY = 'gdrive_remote_snapshot';
const LAST_SYNC_KEY = 'gdrive_last_sync_time';
const SYNC_DEBOUNCE_MS = 2000;
const PERIODIC_SYNC_INTERVAL_MS = 5 * 60 * 1000;      // 5 minutes (foreground)
const BACKGROUND_SYNC_INTERVAL_MS = 15 * 60 * 1000;   // 15 minutes (backgrounded tab)
const STALE_SYNC_THRESHOLD_MS = 2 * 60 * 1000;        // 2 minutes

// ---- Shared Execution Logic ----

interface ExecuteSyncCallbacks {
    onProgress?: () => void;
    onMemorySynced?: (memory: Memory) => void;
}

const executeSyncPlan = async (plan: SyncPlan, callbacks?: ExecuteSyncCallbacks): Promise<string[]> => {
    const errors: string[] = [];
    const { onProgress, onMemorySynced } = callbacks || {};

    /** Call onProgress after awaiting the given promise. */
    const withProgress = async <T,>(promise: Promise<T>): Promise<T> => {
        const result = await promise;
        onProgress?.();
        return result;
    };

    // Build a lookup from fileId → DownloadItem for use in the streaming callback
    const downloadItemByFileId = new Map(plan.toDownload.map(d => [d.fileId, d]));

    // Track successfully downloaded notes for moment-match reconciliation
    const downloadedNotes: Array<{ id: string; enrichment?: { matchedMomentIds?: string[] } }> = [];

    // Track note IDs that arrived as tombstones so dangling refs can be
    // scrubbed from moments after the download phase.
    const deletedNoteIds = new Set<string>();

    // Memories whose attachments were deferred — full versions emitted after download phase
    const deferredAttachmentMemories: Memory[] = [];

    // Stream-download and process each file immediately as it arrives,
    // rather than buffering all downloads in memory first. This lets
    // the UI render cards incrementally as they sync.
    const fileIdsToDownload = plan.toDownload.map(d => d.fileId);
    const { failures: dlFailures } = await downloadFilesStreaming(
        fileIdsToDownload,
        async (fileId: string, content: any) => {
            const item = downloadItemByFileId.get(fileId);
            if (!item) return;

            try {
                // Handle moment synthesis files
                if (item.noteId.startsWith('moment-synthesis-')) {
                    const synthesisContent = content as unknown as MomentSynthesis;
                    const momentId = item.noteId.replace('moment-synthesis-', '');
                    const safeSynthesis: MomentSynthesis = { ...synthesisContent, momentId };

                    const localSynthesis = await getMomentSynthesis(momentId);
                    if (!localSynthesis || safeSynthesis.generatedAt > localSynthesis.generatedAt) {
                        await withProgress(saveMomentSynthesis(safeSynthesis));
                    }
                    return;
                }

                // Handle calendar event files
                if (item.noteId.startsWith('event-')) {
                    const eventContent = content as unknown as CalendarEvent;
                    const verifiedEventId = item.noteId.replace('event-', '');
                    const safeEvent: CalendarEvent = { ...eventContent, id: verifiedEventId };
                    if (item.localCalendarEvent) {
                        if (safeEvent.updatedAt > item.localCalendarEvent.updatedAt) {
                            if (safeEvent.isDeleted) {
                                await withProgress(deleteCalendarEventHard(verifiedEventId));
                            } else {
                                await withProgress(saveCalendarEvent(safeEvent));
                            }
                        } else if (item.localCalendarEvent.updatedAt > safeEvent.updatedAt) {
                            plan.toUpload.push({
                                noteId: item.noteId,
                                memory: item.localCalendarEvent,
                                remoteFileId: item.fileId
                            });
                        }
                    } else {
                        if (safeEvent.isDeleted) {
                            await withProgress(deleteCalendarEventHard(verifiedEventId));
                        } else {
                            await withProgress(saveCalendarEvent(safeEvent));
                        }
                    }
                    return;
                }

                // Handle todo item files
                if (item.noteId.startsWith('todo-')) {
                    const todoContent = content as unknown as TodoItem;
                    const verifiedTodoId = item.noteId.replace('todo-', '');
                    const safeTodo: TodoItem = { ...todoContent, id: verifiedTodoId };
                    if (item.localTodoItem) {
                        if (safeTodo.updatedAt > item.localTodoItem.updatedAt) {
                            if (safeTodo.isDeleted) {
                                await withProgress(deleteTodoItemHard(verifiedTodoId));
                            } else {
                                await withProgress(updateTodoItem(safeTodo));
                            }
                        } else if (item.localTodoItem.updatedAt > safeTodo.updatedAt) {
                            plan.toUpload.push({
                                noteId: item.noteId,
                                memory: item.localTodoItem,
                                remoteFileId: item.fileId
                            });
                        }
                    } else {
                        if (safeTodo.isDeleted) {
                            await withProgress(deleteTodoItemHard(verifiedTodoId));
                        } else {
                            await withProgress(updateTodoItem(safeTodo));
                        }
                    }
                    return;
                }

                // Handle moment files with proper conflict resolution.
                // Tombstones are authoritative: a remote `isDeleted` always wins,
                // even if the local copy has a newer updatedAt. Otherwise the
                // local timestamp gets bumped by background activity
                // (addNoteToMoment from enrichment, markMomentSeen,
                // loadSynthesis, recoverPendingResynthesis) and the deletion
                // would be silently discarded — then the alive local copy is
                // re-uploaded, resurrecting the moment on every device.
                if (item.noteId.startsWith('moment-')) {
                    const momentContent = content as unknown as Moment;
                    const verifiedMomentId = item.noteId.replace('moment-', '');
                    const safeMoment: Moment = { ...momentContent, id: verifiedMomentId };
                    if (safeMoment.isDeleted) {
                        await withProgress(deleteMomentHard(verifiedMomentId));
                    } else if (item.localMoment) {
                        if (safeMoment.updatedAt > item.localMoment.updatedAt) {
                            await withProgress(saveMoment(safeMoment));
                        } else if (item.localMoment.updatedAt > safeMoment.updatedAt) {
                            plan.toUpload.push({
                                noteId: item.noteId,
                                memory: item.localMoment,
                                remoteFileId: item.fileId
                            });
                        }
                    } else {
                        await withProgress(saveMoment(safeMoment));
                    }
                    return;
                }

                // --- Memory files ---

                // Self-heal invalid timestamps
                if (typeof content.timestamp !== 'number' || !isFinite(content.timestamp) || content.timestamp <= 0) {
                    let healed = item.local?.timestamp;
                    if (typeof healed !== 'number' || !isFinite(healed) || healed <= 0) {
                        healed = Date.now();
                    }
                    console.warn(`[Sync] Healing memory ${item.noteId}: invalid timestamp ${content.timestamp} → ${healed}`);
                    content.timestamp = healed;
                    plan.toUpload.push({ noteId: item.noteId, memory: content, remoteFileId: item.fileId });
                }

                const shouldSave = item.local
                    ? content.timestamp > item.local.timestamp
                    : !content.isDeleted;

                const shouldUploadLocal = item.local && item.local.timestamp > content.timestamp;

                if (shouldUploadLocal) {
                    plan.toUpload.push({
                        noteId: item.noteId,
                        memory: item.local!,
                        remoteFileId: item.fileId
                    });
                } else if (shouldSave) {
                    if (content.isDeleted) {
                        await withProgress(deleteMemory(item.noteId));
                        deletedNoteIds.add(item.noteId);
                    } else {
                        // Save full memory to IDB
                        await withProgress(saveMemory(content));

                        // Emit lightweight version (without attachment data) to UI
                        // so the card renders immediately with textual info.
                        // Attachment data will be emitted after the download phase.
                        const hasAttachments = (content.attachments?.length > 0) || content.image;
                        if (onMemorySynced) {
                            if (hasAttachments) {
                                const lightMemory: Memory = {
                                    ...content,
                                    attachments: content.attachments?.map((a: Attachment) => ({
                                        ...a, data: ''
                                    })) || [],
                                    image: content.image ? '' : undefined,
                                    _attachmentsDeferred: true,
                                };
                                onMemorySynced(lightMemory);
                                deferredAttachmentMemories.push(content);
                            } else {
                                onMemorySynced(content);
                            }
                        }
                    }
                }

                // Track for moment-match reconciliation
                downloadedNotes.push({ id: item.noteId, enrichment: (content as Memory).enrichment });

            } catch (e) {
                console.error(`[Sync] Process download failed for ${item.noteId}:`, e);
                errors.push(item.noteId);
            }
        }
    );

    // Record download failures
    const dlFailureSet = new Set(dlFailures);
    for (const item of plan.toDownload) {
        if (dlFailureSet.has(item.fileId)) {
            errors.push(item.noteId);
        }
    }

    // Emit full memories (with attachments) for deferred items now that
    // the download phase is complete. Batched to avoid per-card re-renders.
    if (onMemorySynced && deferredAttachmentMemories.length > 0) {
        for (const fullMemory of deferredAttachmentMemories) {
            onMemorySynced(fullMemory);
        }
    }

    // --- Reconcile note-to-moment matches for downloaded notes ---
    // When a note is enriched on Device A, its enrichment.matchedMomentIds is set.
    // Device A also updates the moment's noteIds and syncs it. But if the moment
    // sync hasn't propagated yet (race condition, offline, etc.), Device B needs
    // to apply these matches locally when it downloads the note.
    // (downloadedNotes was populated during the streaming download phase above)
    const matchesToApply = collectMatchedMomentIds(downloadedNotes);
    const needMomentsFetch = matchesToApply.size > 0 || deletedNoteIds.size > 0;

    // Index plan.toUpload by noteId so queueMomentUpload is O(1) per call
    // even when many moments are updated in a single sync pass.
    const uploadIdxByNoteId = new Map<string, number>();
    plan.toUpload.forEach((u, i) => uploadIdxByNoteId.set(u.noteId, i));
    const queueMomentUpload = (updated: Moment) => {
        const key = `moment-${updated.id}`;
        const existingIdx = uploadIdxByNoteId.get(key);
        if (existingIdx !== undefined) {
            plan.toUpload[existingIdx] = { ...plan.toUpload[existingIdx], memory: updated };
        } else {
            uploadIdxByNoteId.set(key, plan.toUpload.length);
            plan.toUpload.push({ noteId: key, memory: updated });
        }
    };

    if (needMomentsFetch) {
        const allMoments = await getAllMomentsIncludingDeleted();
        const momentsById = new Map(allMoments.map(m => [m.id, m]));

        // Drop dangling noteIds from moments when remote tombstones arrive.
        // Done before applyNoteToMomentMatches so a noteId can't be both
        // removed (because the note was tombstoned) and re-added (because a
        // separately-downloaded note's matchedMomentIds still references it).
        if (deletedNoteIds.size > 0) {
            const cleanedMoments = await removeDanglingNoteIdsFromMoments(deletedNoteIds, allMoments, 'Sync:Download');
            for (const updated of cleanedMoments) {
                momentsById.set(updated.id, updated);
                queueMomentUpload(updated);
            }
        }

        if (matchesToApply.size > 0) {
            const updatedMoments = await applyNoteToMomentMatches(
                matchesToApply,
                Array.from(momentsById.values()),
                'Sync:Download',
            );
            for (const updated of updatedMoments) {
                queueMomentUpload(updated);
            }
        }
    }

    // Build upload list, including synthesis files for any moments being uploaded
    const uploadItems: Array<{ filename: string; content: Memory | Moment | MomentSynthesis | CalendarEvent | TodoItem; existingFileId?: string }> = plan.toUpload.map(u => ({
        filename: `${u.noteId}.json`,
        content: u.memory,
        existingFileId: u.remoteFileId
    }));

    // Collect moment IDs that need synthesis uploads
    const momentIdsForSynth: string[] = [];
    for (const u of plan.toUpload) {
        if (u.noteId.startsWith('moment-') && !u.noteId.startsWith('moment-synthesis-')) {
            momentIdsForSynth.push(u.noteId.replace('moment-', ''));
        }
    }

    // Fetch all syntheses in parallel from IDB
    const synthResults = await Promise.all(
        momentIdsForSynth.map(async (momentId) => {
            const synthesis = await getMomentSynthesis(momentId);
            if (!synthesis) return null;
            const synthFilename = `moment-synthesis-${momentId}.json`;
            const remoteSynthFile = await findFileByName(synthFilename);
            return { filename: synthFilename, content: synthesis, existingFileId: remoteSynthFile?.id };
        })
    );
    for (const item of synthResults) {
        if (item) uploadItems.push(item);
    }

    const { failures: upFailures } = await uploadMultipleFiles(uploadItems);
    // Report progress for each upload (successful or not)
    for (let i = 0; i < uploadItems.length; i++) onProgress?.();
    errors.push(...upFailures.map(f => f.replace('.json', '')));

    // Queue failed uploads for Background Sync retry (best-effort)
    for (const failedFilename of upFailures) {
        try {
            const failedItem = uploadItems.find(item => item.filename === failedFilename);
            if (failedItem) {
                await bgSyncEnqueue({
                    type: 'sync-drive',
                    payload: {
                        noteId: failedFilename.replace('.json', ''),
                        filename: failedItem.filename,
                        content: failedItem.content,
                        existingFileId: failedItem.existingFileId,
                    },
                });
            }
        } catch {
            // Background Sync queue is best-effort, don't fail the sync
        }
    }

    // toDeleteRemote contains canonical file IDs plus any duplicate file IDs
    // discovered during planning (see pushDeleteRemote in doDeltaSync). For
    // moment deletions, the synthesis is included as a separate entry by the
    // synthesis branch of the planner, so this loop stays a pure execution
    // engine without extra Drive lookups. Synthesis files that exist on Drive
    // but were never in the snapshot are caught by the orphan-cleanup pass.
    for (const item of plan.toDeleteRemote) {
        try {
            await deleteFileById(item.fileId);
        } catch (e) {
            console.error(`[Sync] Failed to delete remote file for ${item.noteId}:`, e);
            errors.push(item.noteId);
        }
        onProgress?.();
    }

    for (const id of [...plan.toHardDeleteLocal, ...plan.toDeleteLocal]) {
        try {
            if (id.startsWith('todo-')) {
                await deleteTodoItemHard(id.replace('todo-', ''));
            } else if (id.startsWith('event-')) {
                await deleteCalendarEventHard(id.replace('event-', ''));
            } else if (id.startsWith('moment-synthesis-')) {
                // Synthesis-only deletion (orphan cleanup)
                await deleteMomentSynthesis(id.replace('moment-synthesis-', ''));
            } else if (id.startsWith('moment-')) {
                // deleteMomentHard cascades to deleteMomentSynthesis
                await deleteMomentHard(id.replace('moment-', ''));
            } else {
                await deleteMemory(id);
            }
        } catch (e) { errors.push(id); }
    }

    return errors;
};

/**
 * Maximum number of notes that can be linked to a single moment.
 * Prevents unbounded growth of the noteIds array from enrichment data.
 */
const MAX_NOTE_IDS_PER_MOMENT = 500;

/**
 * Shared helper: apply note-to-moment matches from a matchesToApply map.
 * For each momentId in the map, checks if the corresponding moment exists
 * and is missing any of the note IDs, then updates it in IndexedDB.
 *
 * @returns Array of updated moments (for syncing to Drive).
 */
const applyNoteToMomentMatches = async (
    matchesToApply: Map<string, Set<string>>,
    moments: Moment[],
    logPrefix: string,
): Promise<Moment[]> => {
    const momentLookup = new Map(moments.map(m => [m.id, m]));
    const updatedMoments: Moment[] = [];

    for (const [momentId, noteIds] of matchesToApply) {
        const moment = momentLookup.get(momentId);
        if (!moment || moment.isDeleted) continue;

        const existingIds = new Set(moment.noteIds);
        const newNoteIds = [...noteIds].filter(nid => !existingIds.has(nid));
        if (newNoteIds.length === 0) continue;

        // Cap total noteIds to prevent unbounded growth
        const combinedIds = [...moment.noteIds, ...newNoteIds];
        if (combinedIds.length > MAX_NOTE_IDS_PER_MOMENT) {
            console.warn(`[${logPrefix}] Moment ${momentId} would exceed ${MAX_NOTE_IDS_PER_MOMENT} noteIds, truncating`);
            combinedIds.length = MAX_NOTE_IDS_PER_MOMENT;
        }

        const updated: Moment = {
            ...moment,
            noteIds: combinedIds,
            updatedAt: Date.now(),
        };

        await saveMoment(updated);
        updatedMoments.push(updated);
    }

    return updatedMoments;
};

/**
 * Strip any noteIds that no longer correspond to a live memory from each moment.
 * Triggered when remote tombstones arrive via sync — without this, a moment can
 * keep claiming "22 notes" while only 19 actually resolve, producing a mismatch
 * between the moment header and the deletion sheet.
 *
 * @returns Array of updated moments (for syncing to Drive).
 */
const removeDanglingNoteIdsFromMoments = async (
    deletedNoteIds: Set<string>,
    moments: Moment[],
    logPrefix: string,
): Promise<Moment[]> => {
    if (deletedNoteIds.size === 0) return [];
    const updatedMoments: Moment[] = [];

    for (const moment of moments) {
        if (moment.isDeleted) continue;
        if (!moment.noteIds.some(id => deletedNoteIds.has(id))) continue;

        const filtered = moment.noteIds.filter(id => !deletedNoteIds.has(id));
        const updated: Moment = {
            ...moment,
            noteIds: filtered,
            inputHash: undefined,
            updatedAt: Date.now(),
        };

        await saveMoment(updated);
        await deleteMomentSynthesis(moment.id).catch(e =>
            console.warn(`[${logPrefix}] Failed to clear synthesis for ${moment.id}:`, e)
        );
        updatedMoments.push(updated);
    }

    return updatedMoments;
};

/**
 * Build a matchesToApply map from notes' enrichment.matchedMomentIds.
 */
const collectMatchedMomentIds = (notes: Array<{ id: string; enrichment?: { matchedMomentIds?: string[] }; isDeleted?: boolean; isPending?: boolean }>): Map<string, Set<string>> => {
    const matchesToApply = new Map<string, Set<string>>();
    for (const note of notes) {
        if (note.isDeleted || note.isPending) continue;
        const matched = note.enrichment?.matchedMomentIds;
        if (!matched || matched.length === 0) continue;

        for (const momentId of matched) {
            if (!matchesToApply.has(momentId)) matchesToApply.set(momentId, new Set());
            matchesToApply.get(momentId)!.add(note.id);
        }
    }
    return matchesToApply;
};

/**
 * Reconcile all local notes' matchedMomentIds with their corresponding moments.
 * Ensures that if a note's enrichment says it belongs to a moment, the moment's
 * noteIds array reflects that. Returns any moments that were updated so they can
 * be synced to Drive.
 */
const reconcileAllNoteToMomentMatches = async (): Promise<Moment[]> => {
    const allMemories = await getMemories();
    const allMoments = await getAllMomentsIncludingDeleted();
    const matchesToApply = collectMatchedMomentIds(allMemories);
    return applyNoteToMomentMatches(matchesToApply, allMoments, 'Sync:FullReconcile');
};

// ---- Sync Plan Types ----

interface DownloadItem {
    noteId: string;
    fileId: string;
    local?: Memory;
    localMoment?: Moment;
    localCalendarEvent?: CalendarEvent;
    localTodoItem?: TodoItem;
}

interface UploadItem {
    noteId: string;
    memory: Memory | Moment | CalendarEvent | TodoItem;
    remoteFileId?: string;
}

interface DeleteRemoteItem {
    noteId: string;
    fileId: string;
}

interface SyncPlan {
    toDownload: DownloadItem[];
    toUpload: UploadItem[];
    toDeleteLocal: string[];
    toDeleteRemote: DeleteRemoteItem[];
    toHardDeleteLocal: string[];
}

export const SyncProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingDownload, setIsSyncingDownload] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncStatusVersion, setSyncStatusVersion] = useState(0);

  const { authStatus, getAccessToken } = useAuth();
  const isSyncingRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const syncStatusMapRef = useRef<Map<string, SyncStatus>>(new Map());
  const syncStatusTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const onSyncProgressRef = useRef<(() => void) | undefined>(undefined);
  const onMemorySyncedRef = useRef<((memory: Memory) => void) | undefined>(undefined);

  const setOnSyncProgress = useCallback((cb: (() => void) | undefined) => {
    onSyncProgressRef.current = cb;
  }, []);

  const setOnMemorySynced = useCallback((cb: ((memory: Memory) => void) | undefined) => {
    onMemorySyncedRef.current = cb;
  }, []);

  const updateSyncStatus = useCallback((noteId: string, status: SyncStatus) => {
      // Clear any existing auto-clear timer for this note
      const existingTimer = syncStatusTimersRef.current.get(noteId);
      if (existingTimer) clearTimeout(existingTimer);

      syncStatusMapRef.current.set(noteId, status);
      setSyncStatusVersion(v => v + 1);

      if (status === 'synced') {
          const timer = setTimeout(() => {
              syncStatusMapRef.current.delete(noteId);
              syncStatusTimersRef.current.delete(noteId);
              setSyncStatusVersion(v => v + 1);
          }, 5000);
          syncStatusTimersRef.current.set(noteId, timer);
      }
  }, []);

  const getSyncStatusMap = useCallback(() => syncStatusMapRef.current, []);

  const syncFileInternal = useCallback(async (memory: Memory) => {
      if (isMemoryInFlight(memory) || isMemoryFailed(memory)) return;

      try {
          const filename = `${memory.id}.json`;
          const remoteFile = await findFileByName(filename);
          const uploaded = await uploadFile(filename, memory, remoteFile?.id);

          if (uploaded?.modifiedTime) {
              const snapshotJSON = await storage.get(SNAPSHOT_KEY);
              const snapshot = snapshotJSON ? JSON.parse(snapshotJSON) : {};
              snapshot[memory.id] = uploaded.modifiedTime;
              await storage.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
          }
      } catch (e) {
          console.error(`[Sync] Internal sync failed for ${memory.id}:`, e);
          throw e;
      }
  }, []);

  const syncMomentInternal = useCallback(async (moment: Moment) => {
      try {
          const snapshotJSON = await storage.get(SNAPSHOT_KEY);
          const snapshot = snapshotJSON ? JSON.parse(snapshotJSON) : {};

          // For tombstones, skip the synthesis upload — the file is about to
          // be deleted from Drive anyway (see performMomentSync).
          if (!moment.isDeleted) {
              // Upload the synthesis first, then the moment metadata. If the
              // sequence is interrupted, Drive may carry an updated synthesis
              // without updated metadata (harmless — next sync converges) instead
              // of metadata pointing at a synthesis Drive doesn't yet have (which
              // would force another device to refetch from scratch).
              const synthesis = await getMomentSynthesis(moment.id);
              if (synthesis) {
                  const synthFilename = `moment-synthesis-${moment.id}.json`;
                  // findAllFilesByName so we can clean up any duplicates left
                  // by a prior race (concurrent upload from another device, or
                  // a re-synthesis that POSTed because findFileByName missed).
                  const remoteSynthFiles = await findAllFilesByName(synthFilename);
                  const primarySynth = remoteSynthFiles[0];
                  const uploadedSynth = await uploadFile(synthFilename, synthesis, primarySynth?.id);

                  // Delete any extras so they don't resurrect a deleted moment
                  // and don't sit on Drive consuming quota.
                  for (let i = 1; i < remoteSynthFiles.length; i++) {
                      try {
                          await deleteFileById(remoteSynthFiles[i].id);
                      } catch (e) {
                          console.warn(`[Sync] Failed to remove duplicate synthesis ${remoteSynthFiles[i].id}:`, e);
                      }
                  }

                  if (uploadedSynth?.modifiedTime) {
                      snapshot[`moment-synthesis-${moment.id}`] = uploadedSynth.modifiedTime;
                  }
              }
          }

          const filename = `moment-${moment.id}.json`;
          const remoteFiles = await findAllFilesByName(filename);
          const primaryRemote = remoteFiles[0];

          // If the moment was previously synced (snapshot has an entry) but is
          // missing from Drive, another device has deleted it. Re-uploading
          // would resurrect it on every device. Instead, propagate the deletion
          // locally so background updates (addNoteToMoment, markMomentSeen,
          // loadSynthesis, etc.) don't bring it back from the dead.
          if (!primaryRemote && snapshot[`moment-${moment.id}`]) {
              await deleteMomentHard(moment.id);
              delete snapshot[`moment-${moment.id}`];
              delete snapshot[`moment-synthesis-${moment.id}`];
              await storage.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
              return;
          }

          const uploadedMoment = await uploadFile(filename, moment, primaryRemote?.id);

          // Clean up duplicate moment files. Otherwise a delete could leave
          // an orphan that gets pulled back down by the next listAllFiles.
          for (let i = 1; i < remoteFiles.length; i++) {
              try {
                  await deleteFileById(remoteFiles[i].id);
              } catch (e) {
                  console.warn(`[Sync] Failed to remove duplicate moment ${remoteFiles[i].id}:`, e);
              }
          }

          if (uploadedMoment?.modifiedTime) {
              snapshot[`moment-${moment.id}`] = uploadedMoment.modifiedTime;
          }

          await storage.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
      } catch (e) {
          console.error(`[Sync] Moment sync failed for ${moment.id}:`, e);
          throw e;
      }
  }, []);

  const saveSnapshot = useCallback(async (remoteFiles: DriveFile[], updateLastSyncTime = true) => {
      const snapshot = Object.fromEntries(remoteFiles.map(f => [f.name.replace('.json', ''), f.modifiedTime]));
      await storage.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
      if (updateLastSyncTime) {
          await storage.set(LAST_SYNC_KEY, Date.now().toString());
      }
  }, []);

  const doDeltaSync = useCallback(async (previousSnapshot: Record<string, string>, callbacks?: ExecuteSyncCallbacks) => {
    const localMemories = await getMemories();
    const localMap = new Map(localMemories.map(m => [m.id, m]));

    // Load local moments for sync
    const localMoments = await getAllMomentsIncludingDeleted();
    const localMomentMap = new Map(localMoments.map(m => [`moment-${m.id}`, m]));

    // Load local calendar events for sync
    const localCalendarEvents = await getAllCalendarEventsIncludingDeleted();
    const localEventMap = new Map(localCalendarEvents.map(e => [`event-${e.id}`, e]));

    // Load local todo items for sync
    const localTodoItems = await getAllTodoItemsIncludingDeleted();
    const localTodoMap = new Map(localTodoItems.map(t => [`todo-${t.id}`, t]));

    const remoteFiles = await listAllFiles();
    // Build remoteMap (first occurrence per name) and duplicatesByName (extras).
    // Drive permits multiple files with the same name; concurrent uploads from
    // different devices, or a POST-after-missed-lookup, can create duplicates.
    // The canonical entry drives planning; the extras get queued for deletion
    // alongside whatever fate befalls the canonical.
    const remoteMap = new Map<string, DriveFile>();
    const duplicatesByName = new Map<string, DriveFile[]>();
    for (const f of remoteFiles) {
        const noteId = f.name.replace('.json', '');
        if (!remoteMap.has(noteId)) {
            remoteMap.set(noteId, f);
        } else {
            const list = duplicatesByName.get(noteId) || [];
            list.push(f);
            duplicatesByName.set(noteId, list);
        }
    }

    const lastSyncTimeStr = await storage.get(LAST_SYNC_KEY);
    const lastSyncTime = parseInt(lastSyncTimeStr || '0');

    const plan: SyncPlan = {
        toDownload: [],
        toUpload: [],
        toDeleteLocal: [],
        toDeleteRemote: [],
        toHardDeleteLocal: [],
    };

    // Push a delete-remote entry plus any duplicates for the same logical id,
    // so executeSyncPlan can stay a simple execution engine without making
    // extra Drive lookups per item. Also scheduled when the entity is being
    // uploaded to a moment file — performMomentSync's cleanup covers that
    // path; here we only fan out on actual deletes.
    const pushDeleteRemote = (noteId: string, fileId: string) => {
        plan.toDeleteRemote.push({ noteId, fileId });
        const dups = duplicatesByName.get(noteId);
        if (dups) {
            for (const dup of dups) {
                plan.toDeleteRemote.push({ noteId, fileId: dup.id });
            }
        }
    };

    const handled = new Set<string>();

    for (const [noteId, remoteFile] of remoteMap.entries()) {
        if (previousSnapshot[noteId] && previousSnapshot[noteId] === remoteFile.modifiedTime) {
            continue;
        }

        handled.add(noteId);

        // Handle calendar event files
        if (noteId.startsWith('event-')) {
            const localEvent = localEventMap.get(noteId);
            if (localEvent?.isDeleted) {
                pushDeleteRemote(noteId, remoteFile.id);
                plan.toHardDeleteLocal.push(noteId);
            } else {
                plan.toDownload.push({ noteId, fileId: remoteFile.id, localCalendarEvent: localEvent });
            }
            continue;
        }

        // Handle todo item files
        if (noteId.startsWith('todo-')) {
            const localTodo = localTodoMap.get(noteId);
            if (localTodo?.isDeleted) {
                pushDeleteRemote(noteId, remoteFile.id);
                plan.toHardDeleteLocal.push(noteId);
            } else {
                plan.toDownload.push({ noteId, fileId: remoteFile.id, localTodoItem: localTodo });
            }
            continue;
        }

        // Handle moment synthesis files — download to keep caches in sync
        if (noteId.startsWith('moment-synthesis-')) {
            const momentId = noteId.replace('moment-synthesis-', '');
            const localMoment = localMomentMap.get(`moment-${momentId}`);
            if (localMoment?.isDeleted) {
                // Parent moment is deleted locally — clean up the remote synthesis
                pushDeleteRemote(noteId, remoteFile.id);
                plan.toHardDeleteLocal.push(noteId);
            } else {
                plan.toDownload.push({ noteId, fileId: remoteFile.id });
            }
            continue;
        }

        // Handle moment files separately
        if (noteId.startsWith('moment-')) {
            const localMoment = localMomentMap.get(noteId);
            if (localMoment?.isDeleted) {
                pushDeleteRemote(noteId, remoteFile.id);
                plan.toHardDeleteLocal.push(noteId);
            } else {
                plan.toDownload.push({ noteId, fileId: remoteFile.id, localMoment: localMoment });
            }
            continue;
        }

        const local = localMap.get(noteId);

        if (local?.isDeleted) {
            pushDeleteRemote(noteId, remoteFile.id);
            plan.toHardDeleteLocal.push(noteId);
        } else if (!local) {
            plan.toDownload.push({ noteId, fileId: remoteFile.id });
        } else {
            plan.toDownload.push({ noteId, fileId: remoteFile.id, local });
        }
    }

    for (const noteId of Object.keys(previousSnapshot)) {
        if (remoteMap.has(noteId)) continue;
        if (handled.has(noteId)) continue;

        handled.add(noteId);

        // Handle calendar event files that were removed from remote
        if (noteId.startsWith('event-')) {
            const localEvent = localEventMap.get(noteId);
            if (localEvent?.isDeleted) {
                plan.toHardDeleteLocal.push(noteId);
            } else if (localEvent) {
                plan.toDeleteLocal.push(noteId);
            }
            continue;
        }

        // Handle todo item files that were removed from remote
        if (noteId.startsWith('todo-')) {
            const localTodo = localTodoMap.get(noteId);
            if (localTodo?.isDeleted) {
                plan.toHardDeleteLocal.push(noteId);
            } else if (localTodo) {
                plan.toDeleteLocal.push(noteId);
            }
            continue;
        }

        // Handle synthesis files that were removed from remote
        if (noteId.startsWith('moment-synthesis-')) {
            // Remote synthesis was deleted — clean up local cache
            plan.toHardDeleteLocal.push(noteId);
            continue;
        }

        // Handle moments that were removed from remote
        if (noteId.startsWith('moment-')) {
            const localMoment = localMomentMap.get(noteId);
            if (localMoment?.isDeleted) {
                plan.toHardDeleteLocal.push(noteId);
            } else if (localMoment) {
                plan.toDeleteLocal.push(noteId);
            }
            continue;
        }

        const local = localMap.get(noteId);

        if (local?.isDeleted) {
            plan.toHardDeleteLocal.push(noteId);
        } else if (local) {
            plan.toDeleteLocal.push(noteId);
        }
    }

    for (const local of localMemories) {
        if (handled.has(local.id)) continue;
        if (isMemoryInFlight(local) || isMemoryFailed(local)) continue;

        if (local.isDeleted) {
            const remote = remoteMap.get(local.id);
            if (remote) {
                pushDeleteRemote(local.id, remote.id);
            }
            plan.toHardDeleteLocal.push(local.id);
            handled.add(local.id);
        } else if (local.timestamp > lastSyncTime || !previousSnapshot[local.id]) {
            // Upload if modified since last sync, or if never successfully synced (no snapshot entry)
            const remote = remoteMap.get(local.id);
            plan.toUpload.push({ noteId: local.id, memory: local, remoteFileId: remote?.id });
            handled.add(local.id);
        }
    }

    // Upload local moments that haven't been synced yet
    for (const moment of localMoments) {
        const key = `moment-${moment.id}`;
        if (handled.has(key)) continue;

        if (moment.isDeleted) {
            const remote = remoteMap.get(key);
            if (remote) {
                pushDeleteRemote(key, remote.id);
            }
            plan.toHardDeleteLocal.push(key);
            handled.add(key);
        } else if (moment.updatedAt > lastSyncTime || !previousSnapshot[key]) {
            const remote = remoteMap.get(key);
            plan.toUpload.push({ noteId: key, memory: moment, remoteFileId: remote?.id });
            handled.add(key);
        }
    }

    // Upload local calendar events that haven't been synced yet
    for (const event of localCalendarEvents) {
        const key = `event-${event.id}`;
        if (handled.has(key)) continue;

        if (event.isDeleted) {
            const remote = remoteMap.get(key);
            if (remote) {
                pushDeleteRemote(key, remote.id);
            }
            plan.toHardDeleteLocal.push(key);
            handled.add(key);
        } else if (event.updatedAt > lastSyncTime || !previousSnapshot[key]) {
            const remote = remoteMap.get(key);
            plan.toUpload.push({ noteId: key, memory: event, remoteFileId: remote?.id });
            handled.add(key);
        }
    }

    // Upload local todo items that haven't been synced yet
    for (const item of localTodoItems) {
        const key = `todo-${item.id}`;
        if (handled.has(key)) continue;

        if (item.isDeleted) {
            const remote = remoteMap.get(key);
            if (remote) {
                pushDeleteRemote(key, remote.id);
            }
            plan.toHardDeleteLocal.push(key);
            handled.add(key);
        } else if (item.updatedAt > lastSyncTime || !previousSnapshot[key]) {
            const remote = remoteMap.get(key);
            plan.toUpload.push({ noteId: key, memory: item, remoteFileId: remote?.id });
            handled.add(key);
        }
    }

    // Clean up orphaned synthesis files — synthesis exists on remote but no corresponding moment
    for (const [noteId, remoteFile] of remoteMap.entries()) {
        if (!noteId.startsWith('moment-synthesis-')) continue;
        if (handled.has(noteId)) continue;
        const momentId = noteId.replace('moment-synthesis-', '');
        const momentKey = `moment-${momentId}`;
        const hasMomentRemote = remoteMap.has(momentKey);
        const hasMomentLocal = localMomentMap.has(momentKey);
        if (!hasMomentRemote && !hasMomentLocal) {
            pushDeleteRemote(noteId, remoteFile.id);
            plan.toHardDeleteLocal.push(noteId);
            handled.add(noteId);
        }
    }

    const totalSyncItems = plan.toDownload.length + plan.toUpload.length + plan.toDeleteRemote.length;
    if (totalSyncItems > 0) {
        await startForegroundSync(totalSyncItems);
    }
    let syncedCount = 0;
    const wrappedOnProgress = totalSyncItems > 0 ? () => {
        syncedCount++;
        updateForegroundSyncProgress(syncedCount, totalSyncItems);
        callbacks?.onProgress?.();
    } : callbacks?.onProgress;

    const errors = await executeSyncPlan(plan, {
        onProgress: wrappedOnProgress,
        onMemorySynced: callbacks?.onMemorySynced,
    });

    // Rebuild snapshot from Drive's actual state, but EXCLUDE items that failed
    // to sync. This ensures failed downloads are retried on the next sync instead
    // of being permanently skipped due to a matching modifiedTime in the snapshot.
    const updatedRemoteFiles = await listAllFiles();
    if (errors.length > 0) {
        // Save snapshot excluding failed items so they're retried, but do NOT
        // advance lastSyncTime — keeps it at the previous value so failed
        // uploads remain eligible (timestamp > lastSyncTime) on the next delta sync.
        const errorSet = new Set(errors);
        const successfulFiles = updatedRemoteFiles.filter(
            f => !errorSet.has(f.name.replace('.json', ''))
        );
        await saveSnapshot(successfulFiles, false);
    } else {
        await saveSnapshot(updatedRemoteFiles);
    }

    // Wrap reconciliation in try/catch so it can't prevent snapshot save
    try {
        const reconciledMoments = await reconcileAllNoteToMomentMatches();
        if (reconciledMoments.length > 0) {
            const reconciledUploadItems = await Promise.all(
                reconciledMoments.map(async (m) => {
                    const filename = `moment-${m.id}.json`;
                    const remoteFile = await findFileByName(filename);
                    return { filename, content: m as Moment, existingFileId: remoteFile?.id };
                })
            );
            const { failures } = await uploadMultipleFiles(reconciledUploadItems);
            if (failures.length > 0) {
                console.warn(`[Sync] ${failures.length} reconciled moment upload(s) failed:`, failures);
            }
        }
    } catch (e) {
        console.error('[Sync] Reconciliation failed:', e);
    }

    if (errors.length > 0) {
        console.error(`[Sync] ${errors.length} item(s) failed:`, errors);
        throw new Error(`Failed to sync ${errors.length} items`);
    }

  }, [saveSnapshot]);

  const performSync = useCallback(async (forceFullSync = false) => {
    // CRITICAL FIX: checkIsLinked is async, must await it!
    const linked = await checkIsLinked();
    if (isSyncingRef.current || !linked) {
        return;
    }

    if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
    }

    return new Promise<void>((resolve, reject) => {
        debounceTimerRef.current = setTimeout(async () => {
            // Re-check after debounce: a single-file sync may have started
            // during the debounce window, which would cause concurrent syncs.
            if (isSyncingRef.current) {
                resolve();
                return;
            }
            setIsSyncing(true);
            setIsSyncingDownload(true);
            isSyncingRef.current = true;
            setSyncError(null);

            try {
                await getAccessToken();
                let previousSnapshot: Record<string, string> = {};
                try {
                    const snapshotJSON = await storage.get(SNAPSHOT_KEY);
                    previousSnapshot = JSON.parse(snapshotJSON || '{}');
                } catch (e) {
                    console.warn("[Sync] Snapshot corrupted, starting fresh");
                }

                if (forceFullSync && Object.keys(previousSnapshot).length > 0) {
                    // Rebuild snapshot from local data: only keep entries for items
                    // that exist locally. Items missing locally (e.g. a note that
                    // failed to download previously) will be removed from the
                    // snapshot, causing them to be re-downloaded.
                    const localMemories = await getMemories();
                    const localMoments = await getAllMomentsIncludingDeleted();
                    const localEvents = await getAllCalendarEventsIncludingDeleted();
                    const localTodos = await getAllTodoItemsIncludingDeleted();

                    const localIds = new Set<string>([
                        ...localMemories.map(m => m.id),
                        ...localMoments.map(m => `moment-${m.id}`),
                        ...localEvents.map(e => `event-${e.id}`),
                        ...localTodos.map(t => `todo-${t.id}`),
                    ]);

                    const fullSnapshot = previousSnapshot;
                    previousSnapshot = Object.fromEntries(
                        Object.entries(fullSnapshot).filter(([noteId]) =>
                            localIds.has(noteId) ||
                            // Keep synthesis entries if the parent moment exists locally —
                            // avoids N+1 individual synthesis lookups at scale.
                            (noteId.startsWith('moment-synthesis-') &&
                                localIds.has(`moment-${noteId.replace('moment-synthesis-', '')}`))
                        )
                    );
                }

                await doDeltaSync(previousSnapshot, {
                    onProgress: onSyncProgressRef.current,
                    onMemorySynced: onMemorySyncedRef.current,
                });
                reconcileEmbeddings().catch(e => console.error("[Sync] RAG Reconciliation failed:", e));
                resolve();
            } catch (e: any) {
                console.error('[Sync] Sync process failed:', e);
                let errorMessage = 'Sync failed';
                if (e.message?.includes('Unauthorized') || e.message?.includes('401')) {
                    errorMessage = 'Authentication expired. Please reconnect Drive.';
                } else if (e.message?.includes('Network')) {
                    errorMessage = 'Network error. Please check your connection.';
                }
                setSyncError(errorMessage);
                reject(e);
            } finally {
                await stopForegroundSync();
                setIsSyncing(false);
                setIsSyncingDownload(false);
                isSyncingRef.current = false;
            }
        }, SYNC_DEBOUNCE_MS);
    });
  }, [doDeltaSync, getAccessToken]);

  const performMomentSync = useCallback(async (moment: Moment) => {
      const linked = await checkIsLinked();
      if (isSyncingRef.current || !linked) return;

      // Tombstone path mirrors performSingleSync: hold the global sync mutex so
      // a manual delta sync can't run concurrently with the delete-from-Drive
      // sequence and re-download the moment from a duplicate file we haven't
      // gotten to yet. Non-deletion paths preserve the existing behavior so
      // parallel updates from removeNoteFromMoments still proceed.
      if (moment.isDeleted) {
          setIsSyncing(true);
          isSyncingRef.current = true;
      }

      try {
          await getAccessToken();

          if (moment.isDeleted) {
              // Mirror the note deletion path (performSingleSync): delete the
              // remote files directly and hard-delete locally. The previous
              // approach uploaded the tombstone and waited for the next delta
              // sync to clean up — that left a window where a remote device
              // could push a local update with a higher updatedAt and override
              // the deletion, then re-upload it (resurrecting the moment on
              // the deleting device).
              //
              // Delete EVERY Drive file matching the moment/synthesis name,
              // not just the first match. Drive permits duplicates, and
              // concurrent uploads (e.g. a fresh synthesis racing the delete,
              // or two devices both POSTing after a missed findFileByName)
              // can leave duplicates behind. If any survive, the next delta
              // sync's listAllFiles will pull one of them down and resurrect
              // the moment locally.
              await cleanupFilesByName(`moment-${moment.id}.json`);
              await cleanupFilesByName(`moment-synthesis-${moment.id}.json`);

              // Cascade-deletes the synthesis from IDB too.
              await deleteMomentHard(moment.id);

              const snapshotJSON = await storage.get(SNAPSHOT_KEY);
              if (snapshotJSON) {
                  const snapshot = JSON.parse(snapshotJSON);
                  delete snapshot[`moment-${moment.id}`];
                  delete snapshot[`moment-synthesis-${moment.id}`];
                  await storage.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
              }
              return;
          }

          await syncMomentInternal(moment);
      } catch (e: any) {
          console.error(`[Sync] Moment sync failed for ${moment.id}:`, e);
      } finally {
          if (moment.isDeleted) {
              setIsSyncing(false);
              isSyncingRef.current = false;
          }
      }
  }, [syncMomentInternal, getAccessToken]);

  const performCalendarEventsSync = useCallback(async (events: CalendarEvent[]) => {
      const linked = await checkIsLinked();
      if (!linked || events.length === 0) return;

      try {
          await getAccessToken();

          const snapshotJSON = await storage.get(SNAPSHOT_KEY);
          const snapshot = snapshotJSON ? JSON.parse(snapshotJSON) : {};

          const results = await Promise.all(
              events.map(async (event) => {
                  try {
                      const filename = `event-${event.id}.json`;
                      const remoteFile = await findFileByName(filename);
                      const uploaded = await uploadFile(filename, event, remoteFile?.id);
                      return { eventId: event.id, modifiedTime: uploaded?.modifiedTime };
                  } catch (e) {
                      console.error(`[Sync] Calendar event sync failed for ${event.id}:`, e);
                      return { eventId: event.id, modifiedTime: undefined };
                  }
              })
          );

          for (const result of results) {
              if (result.modifiedTime) {
                  snapshot[`event-${result.eventId}`] = result.modifiedTime;
              }
          }

          await storage.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
      } catch (e: any) {
          console.error(`[Sync] Calendar events sync failed:`, e);
      }
  }, [getAccessToken]);

  const performTodoItemsSync = useCallback(async (items: TodoItem[]) => {
      const linked = await checkIsLinked();
      if (!linked || items.length === 0) return;

      try {
          await getAccessToken();

          const snapshotJSON = await storage.get(SNAPSHOT_KEY);
          const snapshot = snapshotJSON ? JSON.parse(snapshotJSON) : {};

          const results = await Promise.all(
              items.map(async (item) => {
                  try {
                      const filename = `todo-${item.id}.json`;
                      const remoteFile = await findFileByName(filename);
                      const uploaded = await uploadFile(filename, item, remoteFile?.id);
                      return { itemId: item.id, modifiedTime: uploaded?.modifiedTime };
                  } catch (e) {
                      console.error(`[Sync] Todo item sync failed for ${item.id}:`, e);
                      return { itemId: item.id, modifiedTime: undefined };
                  }
              })
          );

          for (const result of results) {
              if (result.modifiedTime) {
                  snapshot[`todo-${result.itemId}`] = result.modifiedTime;
              }
          }

          await storage.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
      } catch (e: any) {
          console.error(`[Sync] Todo items sync failed:`, e);
      }
  }, [getAccessToken]);

  const performSingleSync = useCallback(async (memory: Memory) => {
      const linked = await checkIsLinked();
      if (isSyncingRef.current || !linked) return;

      updateSyncStatus(memory.id, 'syncing');
      setIsSyncing(true);
      isSyncingRef.current = true;
      try {
          await getAccessToken();

          if (memory.isDeleted) {
              // Delete every Drive file matching the name — duplicates can
              // exist when concurrent uploads race a deletion. See the
              // performMomentSync comment for the full rationale.
              await cleanupFilesByName(`${memory.id}.json`);
              await deleteMemory(memory.id);
              const snapshotJSON = await storage.get(SNAPSHOT_KEY);
              if (snapshotJSON) {
                  const snapshot = JSON.parse(snapshotJSON);
                  delete snapshot[memory.id];
                  await storage.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
              }
              // Clear sync status for deleted notes
              syncStatusMapRef.current.delete(memory.id);
              setSyncStatusVersion(v => v + 1);
          } else {
              await syncFileInternal(memory);
              updateSyncStatus(memory.id, 'synced');
          }
      } catch (e: any) {
          console.error(`[Sync] Single sync failed for ${memory.id}:`, e);
          updateSyncStatus(memory.id, 'error');
          setSyncError('Failed to save changes to Drive.');
          throw e;
      } finally {
          setIsSyncing(false);
          isSyncingRef.current = false;
      }
  }, [syncFileInternal, getAccessToken, updateSyncStatus]);

  const retrySyncFile = useCallback(async (memoryId: string) => {
      const memory = await getMemory(memoryId);
      if (!memory) {
          console.error(`[Sync] Retry failed: memory ${memoryId} not found`);
          return;
      }

      updateSyncStatus(memoryId, 'syncing');
      try {
          await getAccessToken();
          await syncFileInternal(memory);
          updateSyncStatus(memoryId, 'synced');
      } catch (e: any) {
          console.error(`[Sync] Retry sync failed for ${memoryId}:`, e);
          updateSyncStatus(memoryId, 'error');
      }
  }, [syncFileInternal, getAccessToken, updateSyncStatus]);

  // Visibility-aware periodic sync:
  // - Foreground: sync every 5 minutes (PERIODIC_SYNC_INTERVAL_MS)
  // - Background: sync every 15 minutes (BACKGROUND_SYNC_INTERVAL_MS) to save battery
  // - On return to foreground: immediate sync if data is stale (>2 min since last sync)
  useEffect(() => {
    if (authStatus !== 'linked') return;

    let intervalId: ReturnType<typeof setInterval>;

    const isStale = async (): Promise<boolean> => {
        const lastStr = await storage.get(LAST_SYNC_KEY);
        if (!lastStr) return true;
        return Date.now() - parseInt(lastStr) > STALE_SYNC_THRESHOLD_MS;
    };

    const trySyncQuietly = async () => {
        try {
            await performSync();
        } catch {
            // Periodic sync errors are non-critical; logged inside performSync
        }
    };

    const startInterval = (ms: number) => {
        if (intervalId) clearInterval(intervalId);
        intervalId = setInterval(trySyncQuietly, ms);
    };

    // Start with the appropriate interval based on current visibility
    const isVisible = document.visibilityState === 'visible';
    startInterval(isVisible ? PERIODIC_SYNC_INTERVAL_MS : BACKGROUND_SYNC_INTERVAL_MS);

    // On visibility change: adjust interval and trigger immediate sync if stale
    const handleVisibilityChange = async () => {
        if (document.visibilityState === 'visible') {
            // Returned to foreground — switch to fast interval
            startInterval(PERIODIC_SYNC_INTERVAL_MS);
            try {
                const stale = await isStale();
                if (stale) trySyncQuietly();
            } catch (err) {
                console.error('[Sync] Error checking for stale sync on visibility change:', err);
            }
        } else {
            // Moved to background — switch to slow interval to save battery
            startInterval(BACKGROUND_SYNC_INTERVAL_MS);
        }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
        clearInterval(intervalId);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authStatus, performSync]);

  // Drain the Background Sync drive queue from the foreground.
  // The service worker cannot perform Google Drive uploads (needs OAuth),
  // so it notifies us via postMessage to retry here with proper auth.
  useEffect(() => {
    if (authStatus !== 'linked') return;

    const drainDriveSyncQueue = async () => {
        try {
            const pending = await bgSyncPeekAll();
            const driveOps = pending.filter(op => op.type === 'sync-drive');
            if (driveOps.length === 0) return;

            await getAccessToken();
            for (const op of driveOps) {
                try {
                    const { filename, content, existingFileId } = op.payload;
                    if (!filename || !content) {
                        console.warn(`[Sync] BG queue: removing malformed item ${op.id}`);
                        await bgSyncRemove(op.id!);
                        continue;
                    }
                    await uploadFile(filename as string, content, existingFileId as string | undefined);
                    await bgSyncRemove(op.id!);
                } catch (e) {
                    console.warn(`[Sync] BG queue retry failed for ${op.payload?.noteId}:`, e);
                }
            }
        } catch (e) {
            console.warn('[Sync] Failed to drain drive sync queue:', e);
        }
    };

    const handleSWMessage = (event: MessageEvent) => {
        if (event.data?.type === 'DRIVE_SYNC_PENDING') {
            drainDriveSyncQueue();
        }
    };

    navigator.serviceWorker?.addEventListener('message', handleSWMessage);
    // Also drain on mount in case items were queued while app was closed
    drainDriveSyncQueue();

    return () => {
        navigator.serviceWorker?.removeEventListener('message', handleSWMessage);
    };
  }, [authStatus, getAccessToken]);

  useEffect(() => {
    return () => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        // Clean up sync status timers
        for (const timer of syncStatusTimersRef.current.values()) {
            clearTimeout(timer);
        }
    };
  }, []);

  return (
    <SyncContext.Provider value={{
        isSyncing,
        isSyncingDownload,
        syncError,
        sync: performSync,
        syncFile: performSingleSync,
        syncMoment: performMomentSync,
        syncCalendarEvents: performCalendarEventsSync,
        syncTodoItems: performTodoItemsSync,
        retrySyncFile,
        getSyncStatusMap,
        syncStatusVersion,
        pendingCount,
        setOnSyncProgress,
        setOnMemorySynced
    }}>
      {children}
    </SyncContext.Provider>
  );
};

export const useSync = () => {
  const context = useContext(SyncContext);
  if (!context) throw new Error("useSync must be used within SyncProvider");
  return context;
};
