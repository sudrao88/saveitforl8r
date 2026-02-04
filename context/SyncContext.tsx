import React, { createContext, useContext, useState, useCallback, ReactNode, useRef, useEffect } from 'react';
import { getMemories, saveMemory, deleteMemory, reconcileEmbeddings } from '../services/storageService';

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
import { Memory } from '../types';
import { useAuth } from '../hooks/useAuth';
import { storage } from '../services/platform';

interface SyncContextType {
  isSyncing: boolean;
  syncError: string | null;
  sync: () => Promise<void>;
  syncFile: (memory: Memory) => Promise<void>;
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

    const { failures: upFailures } = await uploadMultipleFiles(
        plan.toUpload.map(u => ({
            filename: `${u.noteId}.json`,
            content: u.memory,
            existingFileId: u.remoteFileId
        }))
    );
    errors.push(...upFailures.map(f => f.replace('.json', '')));

    for (const item of plan.toDeleteRemote) {
        try {
            await deleteFileById(item.fileId);
        } catch (e) {
            console.error(`[Sync] Failed to delete remote file for ${item.noteId}:`, e);
            errors.push(item.noteId);
        }
    }

    for (const id of plan.toHardDeleteLocal) {
        try { await deleteMemory(id); } catch (e) { errors.push(id); }
    }
    for (const id of plan.toDeleteLocal) {
        try { await deleteMemory(id); } catch (e) { errors.push(id); }
    }

    return errors;
};

// ---- Sync Plan Types ----

interface DownloadItem {
    noteId: string;
    fileId: string;
    local?: Memory;
}

interface UploadItem {
    noteId: string;
    memory: Memory;
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
      if (memory.isSample || memory.isPending || memory.processingError) return;

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

  const saveSnapshot = useCallback((remoteFiles: any[]) => {
      const snapshot = Object.fromEntries(remoteFiles.map((f: any) => [f.name.replace('.json', ''), f.modifiedTime]));
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
      localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
  }, []);

  const doDeltaSync = useCallback(async (previousSnapshot: Record<string, string>) => {
    const localMemories = await getMemories();
    const localMap = new Map(localMemories.map(m => [m.id, m]));

    const remoteFiles = await listAllFiles();
    const remoteMap = new Map(remoteFiles.map((f: any) => [f.name.replace('.json', ''), f]));

    const lastSyncTime = parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0');

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
        const local = localMap.get(noteId);

        if (local?.isSample || noteId.startsWith('sample-')) continue;

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
        const local = localMap.get(noteId);

        if (local?.isDeleted) {
            plan.toHardDeleteLocal.push(noteId);
        } else if (local) {
            plan.toDeleteLocal.push(noteId);
        }
    }

    for (const local of localMemories) {
        if (handled.has(local.id)) continue;
        if (local.isSample || local.isPending || local.processingError) continue;

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

    console.log(`[Sync] Delta sync plan: download=${plan.toDownload.length} upload=${plan.toUpload.length} deleteRemote=${plan.toDeleteRemote.length}`);

    const errors = await executeSyncPlan(plan);

    if (errors.length > 0) {
        console.error(`[Sync] ${errors.length} item(s) failed:`, errors);
        throw new Error(`Failed to sync ${errors.length} items`);
    }

    const updatedRemoteFiles = await listAllFiles();
    saveSnapshot(updatedRemoteFiles);
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
                    previousSnapshot = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '{}');
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
              const snapshotJSON = localStorage.getItem(SNAPSHOT_KEY);
              if (snapshotJSON) {
                  const snapshot = JSON.parse(snapshotJSON);
                  delete snapshot[memory.id];
                  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
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
