import React, { createContext, useContext, useState, useCallback, ReactNode, useRef, useEffect } from 'react';
import { getMemories, getMemory, saveMemory, deleteMemory, reconcileEmbeddings, getAllMomentsIncludingDeleted, saveMoment, deleteMomentHard, getMomentSynthesis, saveMomentSynthesis, deleteMomentSynthesis, getAllCalendarEventsIncludingDeleted, saveCalendarEvent, deleteCalendarEventHard, getAllTodoItemsIncludingDeleted, updateTodoItem, deleteTodoItemHard } from '../services/storageService';

import {
    listAllFiles,
    downloadMultipleFiles,
    uploadFile,
    uploadMultipleFiles,
    findFileByName,
    deleteFileById,
    isLinked as checkIsLinked,
    deleteRemoteNote,
    type DriveFile,
} from '../services/googleDriveService';
import { Memory, Moment, MomentSynthesis, CalendarEvent, TodoItem } from '../types';
import { useAuth } from '../hooks/useAuth';
import { storage } from '../services/platform';
import { enqueue as bgSyncEnqueue } from '../services/backgroundSyncQueue';

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
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

const SNAPSHOT_KEY = 'gdrive_remote_snapshot';
const LAST_SYNC_KEY = 'gdrive_last_sync_time';
const SYNC_DEBOUNCE_MS = 2000;
const PERIODIC_SYNC_INTERVAL_MS = 5 * 60 * 1000;      // 5 minutes (foreground)
const BACKGROUND_SYNC_INTERVAL_MS = 15 * 60 * 1000;   // 15 minutes (backgrounded tab)
const STALE_SYNC_THRESHOLD_MS = 2 * 60 * 1000;        // 2 minutes

// ---- Shared Execution Logic ----

const executeSyncPlan = async (plan: SyncPlan, onProgress?: () => void): Promise<string[]> => {
    const errors: string[] = [];

    /** Call onProgress after awaiting the given promise. */
    const withProgress = async <T,>(promise: Promise<T>): Promise<T> => {
        const result = await promise;
        onProgress?.();
        return result;
    };

    const fileIdsToDownload = plan.toDownload.map(d => d.fileId);
    const { contents: downloadedContents, failures: dlFailures } =
        await downloadMultipleFiles(fileIdsToDownload);

    const dlFailureSet = new Set(dlFailures);
    for (const item of plan.toDownload) {
        if (dlFailureSet.has(item.fileId)) {
            errors.push(item.noteId);
        }
    }

    for (const item of plan.toDownload) {
        if (dlFailureSet.has(item.fileId)) continue;

        const content = downloadedContents.get(item.fileId);
        if (!content) { errors.push(item.noteId); continue; }

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
                continue;
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
                continue;
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
                continue;
            }

            // Handle moment files with proper conflict resolution
            if (item.noteId.startsWith('moment-')) {
                const momentContent = content as unknown as Moment;
                // Use the verified ID from the filename, not the untrusted JSON content
                const verifiedMomentId = item.noteId.replace('moment-', '');
                const safeMoment: Moment = { ...momentContent, id: verifiedMomentId };
                if (item.localMoment) {
                    // Both local and remote exist — compare updatedAt timestamps
                    if (safeMoment.updatedAt > item.localMoment.updatedAt) {
                        if (safeMoment.isDeleted) {
                            await withProgress(deleteMomentHard(verifiedMomentId));
                        } else {
                            await withProgress(saveMoment(safeMoment));
                        }
                    } else if (item.localMoment.updatedAt > safeMoment.updatedAt) {
                        // Local is newer — push to upload instead
                        plan.toUpload.push({
                            noteId: item.noteId,
                            memory: item.localMoment,
                            remoteFileId: item.fileId
                        });
                    }
                    // Equal timestamps — no action needed
                } else {
                    // Remote-only moment
                    if (safeMoment.isDeleted) {
                        await withProgress(deleteMomentHard(verifiedMomentId));
                    } else {
                        await withProgress(saveMoment(safeMoment));
                    }
                }
                continue;
            }

            // Self-heal invalid timestamps — use local copy's timestamp or fall back to now
            if (typeof content.timestamp !== 'number' || !isFinite(content.timestamp) || content.timestamp <= 0) {
                let healed = item.local?.timestamp;
                if (typeof healed !== 'number' || !isFinite(healed) || healed <= 0) {
                    healed = Date.now();
                }
                console.warn(`[Sync] Healing memory ${item.noteId}: invalid timestamp ${content.timestamp} → ${healed}`);
                content.timestamp = healed;
                // Re-upload the healed version to fix remote
                plan.toUpload.push({ noteId: item.noteId, memory: content, remoteFileId: item.fileId });
            }

            if (item.local) {
                if (content.timestamp > item.local.timestamp) {
                    if (content.isDeleted) await withProgress(deleteMemory(item.noteId));
                    else await withProgress(saveMemory(content));
                } else if (item.local.timestamp > content.timestamp) {
                    plan.toUpload.push({
                        noteId: item.noteId,
                        memory: item.local,
                        remoteFileId: item.fileId
                    });
                }
            } else {
                if (!content.isDeleted) await withProgress(saveMemory(content));
            }
        } catch (e) {
            console.error(`[Sync] Process download failed for ${item.noteId}:`, e);
            errors.push(item.noteId);
        }
    }

    // --- Reconcile note-to-moment matches for downloaded notes ---
    // When a note is enriched on Device A, its enrichment.matchedMomentIds is set.
    // Device A also updates the moment's noteIds and syncs it. But if the moment
    // sync hasn't propagated yet (race condition, offline, etc.), Device B needs
    // to apply these matches locally when it downloads the note.
    const downloadedNotes: Array<{ id: string; enrichment?: { matchedMomentIds?: string[] } }> = [];
    for (const item of plan.toDownload) {
        if (dlFailureSet.has(item.fileId)) continue;
        if (item.noteId.startsWith('moment-') || item.noteId.startsWith('event-') || item.noteId.startsWith('todo-')) continue;
        const content = downloadedContents.get(item.fileId);
        if (content) downloadedNotes.push({ id: item.noteId, enrichment: (content as Memory).enrichment });
    }

    const matchesToApply = collectMatchedMomentIds(downloadedNotes);
    if (matchesToApply.size > 0) {
        const allMoments = await getAllMomentsIncludingDeleted();
        const updatedMoments = await applyNoteToMomentMatches(matchesToApply, allMoments, 'Sync:Download');

        // Queue updated moments for upload so changes propagate to other devices.
        // If a moment is already queued, update it in-place to avoid data loss.
        for (const updated of updatedMoments) {
            const key = `moment-${updated.id}`;
            const existingIdx = plan.toUpload.findIndex(u => u.noteId === key);
            if (existingIdx >= 0) {
                plan.toUpload[existingIdx] = { ...plan.toUpload[existingIdx], memory: updated };
            } else {
                plan.toUpload.push({ noteId: key, memory: updated });
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
    errors.push(...upFailures.map(f => f.replace('.json', '')));

    // Queue failed uploads for Background Sync retry (best-effort)
    for (const failedFilename of upFailures) {
        try {
            const noteId = failedFilename.replace('.json', '');
            await bgSyncEnqueue({ type: 'sync-drive', payload: { noteId } });
        } catch {
            // Background Sync queue is best-effort, don't fail the sync
        }
    }

    for (const item of plan.toDeleteRemote) {
        try {
            await deleteFileById(item.fileId);
            // When deleting a moment, also delete its synthesis file from remote
            if (item.noteId.startsWith('moment-') && !item.noteId.startsWith('moment-synthesis-')) {
                const momentId = item.noteId.replace('moment-', '');
                try {
                    const synthFile = await findFileByName(`moment-synthesis-${momentId}.json`);
                    if (synthFile) await deleteFileById(synthFile.id);
                } catch (e) {
                    console.warn(`[Sync] Failed to delete remote synthesis for ${momentId}:`, e);
                }
            }
        } catch (e) {
            console.error(`[Sync] Failed to delete remote file for ${item.noteId}:`, e);
            errors.push(item.noteId);
        }
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
        console.log(`[${logPrefix}] Moment ${momentId}: added ${newNoteIds.length} note(s)`);
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

  const setOnSyncProgress = useCallback((cb: (() => void) | undefined) => {
    onSyncProgressRef.current = cb;
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
      if (memory.isPending || memory.processingError) return;

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
          const filename = `moment-${moment.id}.json`;
          const remoteFile = await findFileByName(filename);
          const uploadedMoment = await uploadFile(filename, moment, remoteFile?.id);

          const snapshotJSON = await storage.get(SNAPSHOT_KEY);
          const snapshot = snapshotJSON ? JSON.parse(snapshotJSON) : {};

          if (uploadedMoment?.modifiedTime) {
              snapshot[`moment-${moment.id}`] = uploadedMoment.modifiedTime;
          }

          // Also sync the synthesis cache if available
          const synthesis = await getMomentSynthesis(moment.id);
          if (synthesis) {
              const synthFilename = `moment-synthesis-${moment.id}.json`;
              const remoteSynthFile = await findFileByName(synthFilename);
              const uploadedSynth = await uploadFile(synthFilename, synthesis, remoteSynthFile?.id);

              if (uploadedSynth?.modifiedTime) {
                  snapshot[`moment-synthesis-${moment.id}`] = uploadedSynth.modifiedTime;
              }
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

  const doDeltaSync = useCallback(async (previousSnapshot: Record<string, string>, onProgress?: () => void) => {
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
    const remoteMap = new Map(remoteFiles.map(f => [f.name.replace('.json', ''), f]));

    const lastSyncTimeStr = await storage.get(LAST_SYNC_KEY);
    const lastSyncTime = parseInt(lastSyncTimeStr || '0');

    const plan: SyncPlan = {
        toDownload: [],
        toUpload: [],
        toDeleteLocal: [],
        toDeleteRemote: [],
        toHardDeleteLocal: [],
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
                plan.toDeleteRemote.push({ noteId, fileId: remoteFile.id });
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
                plan.toDeleteRemote.push({ noteId, fileId: remoteFile.id });
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
                plan.toDeleteRemote.push({ noteId, fileId: remoteFile.id });
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
                plan.toDeleteRemote.push({ noteId, fileId: remoteFile.id });
                plan.toHardDeleteLocal.push(noteId);
            } else {
                plan.toDownload.push({ noteId, fileId: remoteFile.id, localMoment: localMoment });
            }
            continue;
        }

        const local = localMap.get(noteId);

        if (local?.isDeleted) {
            plan.toDeleteRemote.push({ noteId, fileId: remoteFile.id });
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
        if (local.isPending || local.processingError) continue;

        if (local.isDeleted) {
            const remote = remoteMap.get(local.id);
            if (remote) {
                plan.toDeleteRemote.push({ noteId: local.id, fileId: remote.id });
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
                plan.toDeleteRemote.push({ noteId: key, fileId: remote.id });
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
                plan.toDeleteRemote.push({ noteId: key, fileId: remote.id });
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
                plan.toDeleteRemote.push({ noteId: key, fileId: remote.id });
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
            plan.toDeleteRemote.push({ noteId, fileId: remoteFile.id });
            plan.toHardDeleteLocal.push(noteId);
            handled.add(noteId);
        }
    }

    console.log(`[Sync] Delta sync plan: download=${plan.toDownload.length} upload=${plan.toUpload.length} deleteRemote=${plan.toDeleteRemote.length}`);

    const errors = await executeSyncPlan(plan, onProgress);

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

    console.log('--- [Sync] Delta Sync Complete ---');
  }, [saveSnapshot]);

  const performSync = useCallback(async (forceFullSync = false) => {
    // CRITICAL FIX: checkIsLinked is async, must await it!
    const linked = await checkIsLinked();
    if (isSyncingRef.current || !linked) {
        console.log(`[Sync] Skip sync: isSyncing=${isSyncingRef.current}, linked=${linked}`);
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
                console.log('[Sync] Skip sync: another sync started during debounce');
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
                    console.log(`[Sync] Force full sync: rebuilt snapshot from local data (${Object.keys(previousSnapshot).length}/${Object.keys(fullSnapshot).length} items matched)`);
                }

                console.log(`--- [Sync] Starting ${forceFullSync ? 'FULL' : 'DELTA'} Sync ---`);
                await doDeltaSync(previousSnapshot, onSyncProgressRef.current);
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

      try {
          await getAccessToken();
          await syncMomentInternal(moment);
      } catch (e: any) {
          console.error(`[Sync] Moment sync failed for ${moment.id}:`, e);
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
              const remoteFile = await findFileByName(`${memory.id}.json`);
              if (remoteFile) {
                  await deleteFileById(remoteFile.id);
              }
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
        setOnSyncProgress
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
