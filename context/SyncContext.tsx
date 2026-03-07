import React, { createContext, useContext, useState, useCallback, ReactNode, useRef, useEffect } from 'react';
import { getMemories, saveMemory, deleteMemory, reconcileEmbeddings, getAllMomentsIncludingDeleted, saveMoment, deleteMomentHard, getMomentSynthesis, saveMomentSynthesis, deleteMomentSynthesis } from '../services/storageService';

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
import { Memory, Moment, MomentSynthesis } from '../types';
import { useAuth } from '../hooks/useAuth';
import { storage } from '../services/platform';

interface SyncContextType {
  isSyncing: boolean;
  syncError: string | null;
  sync: () => Promise<void>;
  syncFile: (memory: Memory) => Promise<void>;
  syncMoment: (moment: Moment) => Promise<void>;
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

    // Build upload list, including synthesis files for any moments being uploaded
    const uploadItems = plan.toUpload.map(u => ({
        filename: `${u.noteId}.json`,
        content: u.memory,
        existingFileId: u.remoteFileId
    }));

    // Collect synthesis uploads for moments in the upload batch
    const synthUploads: Array<{ momentId: string }> = [];
    for (const u of plan.toUpload) {
        if (u.noteId.startsWith('moment-') && !u.noteId.startsWith('moment-synthesis-')) {
            const momentId = u.noteId.replace('moment-', '');
            synthUploads.push({ momentId });
        }
    }

    // Fetch syntheses and add to upload batch
    for (const { momentId } of synthUploads) {
        const synthesis = await getMomentSynthesis(momentId);
        if (synthesis) {
            const synthFilename = `moment-synthesis-${momentId}.json`;
            const remoteSynthFile = await findFileByName(synthFilename);
            uploadItems.push({
                filename: synthFilename,
                content: synthesis as any,
                existingFileId: remoteSynthFile?.id
            });
        }
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
            if (id.startsWith('moment-synthesis-')) {
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

// ---- Sync Plan Types ----

interface DownloadItem {
    noteId: string;
    fileId: string;
    local?: Memory;
    localMoment?: Moment;
}

interface UploadItem {
    noteId: string;
    memory: Memory | Moment;
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
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const { authStatus, getAccessToken } = useAuth();
  const isSyncingRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const syncFileInternal = useCallback(async (memory: Memory) => {
      if (memory.isPending || memory.processingError) return;

      try {
          const filename = `${memory.id}.json`;
          const remoteFile = await findFileByName(filename);
          await uploadFile(filename, memory, remoteFile?.id);

          const updatedFile = await findFileByName(filename);
          if (updatedFile) {
              const snapshotJSON = await storage.get(SNAPSHOT_KEY);
              const snapshot = snapshotJSON ? JSON.parse(snapshotJSON) : {};
              snapshot[memory.id] = updatedFile.modifiedTime;
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
          await uploadFile(filename, moment, remoteFile?.id);

          const updatedFile = await findFileByName(filename);
          const snapshotJSON = await storage.get(SNAPSHOT_KEY);
          const snapshot = snapshotJSON ? JSON.parse(snapshotJSON) : {};

          if (updatedFile) {
              snapshot[`moment-${moment.id}`] = updatedFile.modifiedTime;
          }

          // Also sync the synthesis cache if available
          const synthesis = await getMomentSynthesis(moment.id);
          if (synthesis) {
              const synthFilename = `moment-synthesis-${moment.id}.json`;
              const remoteSynthFile = await findFileByName(synthFilename);
              await uploadFile(synthFilename, synthesis, remoteSynthFile?.id);

              const updatedSynthFile = await findFileByName(synthFilename);
              if (updatedSynthFile) {
                  snapshot[`moment-synthesis-${moment.id}`] = updatedSynthFile.modifiedTime;
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

    if (errors.length > 0) {
        console.error(`[Sync] ${errors.length} item(s) failed:`, errors);
        throw new Error(`Failed to sync ${errors.length} items`);
    }

    const updatedRemoteFiles = await listAllFiles();
    await saveSnapshot(updatedRemoteFiles);
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

  const performSingleSync = useCallback(async (memory: Memory) => {
      const linked = await checkIsLinked();
      if (isSyncingRef.current || !linked) return;

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
              // Update snapshot using storage adapter for cross-platform consistency
              const snapshotJSON = await storage.get(SNAPSHOT_KEY);
              if (snapshotJSON) {
                  const snapshot = JSON.parse(snapshotJSON);
                  delete snapshot[memory.id];
                  await storage.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
              }
          } else {
              await syncFileInternal(memory);
          }
      } catch (e: any) {
          console.error(`[Sync] Single sync failed for ${memory.id}:`, e);
          setSyncError('Failed to save changes to Drive.');
          throw e;
      } finally {
          setIsSyncing(false);
          isSyncingRef.current = false;
      }
  }, [syncFileInternal, getAccessToken]);

  useEffect(() => {
    return () => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  return (
    <SyncContext.Provider value={{
        isSyncing,
        syncError,
        sync: performSync,
        syncFile: performSingleSync,
        syncMoment: performMomentSync,
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
