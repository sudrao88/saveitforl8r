import React, { createContext, useContext, useState, useCallback, ReactNode, useRef, useEffect } from 'react';
import { getMemories, getMemory, saveMemory, deleteMemory, reconcileEmbeddings, getAllMomentsIncludingDeleted, saveMoment, deleteMomentHard, getMomentSynthesis, saveMomentSynthesis, deleteMomentSynthesis, getAllCalendarEventsIncludingDeleted, saveCalendarEvent, deleteCalendarEventHard } from '../services/storageService';

import {
    listAllFiles,
    downloadMultipleFiles,
    uploadFile,
    uploadMultipleFiles,
    findFileByName,
    deleteFileById,
    isLinked as checkIsLinked,
    deleteRemoteNote
} from '../services/googleDriveService';
import { Memory, Moment, MomentSynthesis, CalendarEvent } from '../types';
import { useAuth } from '../hooks/useAuth';
import { storage } from '../services/platform';

type SyncStatus = 'syncing' | 'synced' | 'error';

interface SyncContextType {
  isSyncing: boolean;
  isSyncingDownload: boolean;
  syncError: string | null;
  sync: () => Promise<void>;
  syncFile: (memory: Memory) => Promise<void>;
  syncMoment: (moment: Moment) => Promise<void>;
  syncCalendarEvents: (events: CalendarEvent[]) => Promise<void>;
  retrySyncFile: (memoryId: string) => Promise<void>;
  getSyncStatusMap: () => Map<string, SyncStatus>;
  syncStatusVersion: number;
  pendingCount: number;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

const SNAPSHOT_KEY = 'gdrive_remote_snapshot';
const LAST_SYNC_KEY = 'gdrive_last_sync_time';
const SYNC_DEBOUNCE_MS = 2000;

// ---- Shared Execution Logic ----

const executeSyncPlan = async (plan: SyncPlan): Promise<string[]> => {
    const errors: string[] = [];

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
                    await saveMomentSynthesis(safeSynthesis);
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
                            await deleteCalendarEventHard(verifiedEventId);
                        } else {
                            await saveCalendarEvent(safeEvent);
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
                        await deleteCalendarEventHard(verifiedEventId);
                    } else {
                        await saveCalendarEvent(safeEvent);
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
                            await deleteMomentHard(verifiedMomentId);
                        } else {
                            await saveMoment(safeMoment);
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
                        await deleteMomentHard(verifiedMomentId);
                    } else {
                        await saveMoment(safeMoment);
                    }
                }
                continue;
            }

            // Validate timestamp before saving — invalid timestamps cause "Invalid Date" in UI
            if (typeof content.timestamp !== 'number' || !isFinite(content.timestamp) || content.timestamp <= 0) {
                console.warn(`[Sync] Skipping memory ${item.noteId}: invalid timestamp`, content.timestamp);
                errors.push(item.noteId);
                continue;
            }

            if (item.local) {
                if (content.timestamp > item.local.timestamp) {
                    if (content.isDeleted) await deleteMemory(item.noteId);
                    else await saveMemory(content);
                } else if (item.local.timestamp > content.timestamp) {
                    plan.toUpload.push({
                        noteId: item.noteId,
                        memory: item.local,
                        remoteFileId: item.fileId
                    });
                }
            } else {
                if (!content.isDeleted) await saveMemory(content);
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
        if (item.noteId.startsWith('moment-') || item.noteId.startsWith('event-')) continue;
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
    const uploadItems: Array<{ filename: string; content: Memory | Moment | MomentSynthesis | CalendarEvent; existingFileId?: string }> = plan.toUpload.map(u => ({
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
            if (id.startsWith('event-')) {
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
}

interface UploadItem {
    noteId: string;
    memory: Memory | Moment | CalendarEvent;
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

  const saveSnapshot = useCallback(async (remoteFiles: any[]) => {
      const snapshot = Object.fromEntries(remoteFiles.map((f: any) => [f.name.replace('.json', ''), f.modifiedTime]));
      await storage.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
      await storage.set(LAST_SYNC_KEY, Date.now().toString());
  }, []);

  const doDeltaSync = useCallback(async (previousSnapshot: Record<string, string>) => {
    const localMemories = await getMemories();
    const localMap = new Map(localMemories.map(m => [m.id, m]));

    // Load local moments for sync
    const localMoments = await getAllMomentsIncludingDeleted();
    const localMomentMap = new Map(localMoments.map(m => [`moment-${m.id}`, m]));

    // Load local calendar events for sync
    const localCalendarEvents = await getAllCalendarEventsIncludingDeleted();
    const localEventMap = new Map(localCalendarEvents.map(e => [`event-${e.id}`, e]));

    const remoteFiles = await listAllFiles();
    const remoteMap = new Map(remoteFiles.map((f: any) => [f.name.replace('.json', ''), f]));

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
        } else if (local.timestamp > lastSyncTime) {
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
        } else if (moment.updatedAt > lastSyncTime) {
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
        } else if (event.updatedAt > lastSyncTime) {
            const remote = remoteMap.get(key);
            plan.toUpload.push({ noteId: key, memory: event, remoteFileId: remote?.id });
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

    const errors = await executeSyncPlan(plan);

    // ALWAYS rebuild snapshot from Drive's actual state, even on partial failure.
    // This ensures successfully synced files keep their snapshot entry even when
    // other uploads fail.
    const updatedRemoteFiles = await listAllFiles();
    await saveSnapshot(updatedRemoteFiles);

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

  const performSync = useCallback(async () => {
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

                console.log(`--- [Sync] Starting DELTA Sync ---`);
                await doDeltaSync(previousSnapshot);
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
        retrySyncFile,
        getSyncStatusMap,
        syncStatusVersion,
        pendingCount
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
