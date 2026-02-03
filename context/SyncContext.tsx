
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

interface SyncContextType {
  isSyncing: boolean;
  syncError: string | null;
  sync: (forceFull?: boolean) => Promise<void>;
  syncFile: (memory: Memory) => Promise<void>;
  pendingCount: number;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

const SNAPSHOT_KEY = 'gdrive_remote_snapshot';
const LAST_SYNC_KEY = 'gdrive_last_sync_time';
const SYNC_DEBOUNCE_MS = 2000;

// ---- Sync Plan Types ----

interface DownloadItem {
    noteId: string;
    fileId: string;   // Drive file ID
    local?: Memory;   // Present when both exist and we need content comparison
}

interface UploadItem {
    noteId: string;
    memory: Memory;
    remoteFileId?: string;  // Drive file ID for PATCH (update), absent for POST (create)
}

interface DeleteRemoteItem {
    noteId: string;
    fileId: string;  // Drive file ID
}

interface SyncPlan {
    toDownload: DownloadItem[];
    toUpload: UploadItem[];
    toDeleteLocal: string[];         // Note IDs to hard-delete locally (remote was deleted by another device)
    toDeleteRemote: DeleteRemoteItem[];  // Remote files to delete (local tombstone)
    toHardDeleteLocal: string[];     // Tombstones to hard-delete after remote cleanup
}

// ---- Shared Execution Logic ----
// Processes a classified SyncPlan: batch downloads, processes content,
// batch uploads, then handles deletions. Returns array of note IDs that failed.

const executeSyncPlan = async (plan: SyncPlan): Promise<string[]> => {
    const errors: string[] = [];

    // --- Phase 1: Batch download all needed remote files ---
    const fileIdsToDownload = plan.toDownload.map(d => d.fileId);
    const { contents: downloadedContents, failures: dlFailures } =
        await downloadMultipleFiles(fileIdsToDownload);

    // Map download failures back to note IDs
    const dlFailureSet = new Set(dlFailures);
    for (const item of plan.toDownload) {
        if (dlFailureSet.has(item.fileId)) {
            errors.push(item.noteId);
        }
    }

    // --- Phase 2: Process downloaded content ---
    for (const item of plan.toDownload) {
        if (dlFailureSet.has(item.fileId)) continue;

        const content = downloadedContents.get(item.fileId);
        if (!content) { errors.push(item.noteId); continue; }

        try {
            if (item.local) {
                // Both exist — compare internal timestamps for conflict resolution
                if (content.timestamp > item.local.timestamp) {
                    // Remote is newer
                    if (content.isDeleted) await deleteMemory(item.noteId);
                    else await saveMemory(content);
                } else if (item.local.timestamp > content.timestamp) {
                    // Local is newer — schedule upload (will be included in Phase 3)
                    plan.toUpload.push({
                        noteId: item.noteId,
                        memory: item.local,
                        remoteFileId: item.fileId
                    });
                }
                // Equal timestamps → no action needed
            } else {
                // Remote-only file — save locally unless it's a tombstone
                if (!content.isDeleted) await saveMemory(content);
            }
        } catch (e) {
            console.error(`[Sync] Process download failed for ${item.noteId}:`, e);
            errors.push(item.noteId);
        }
    }

    // --- Phase 3: Batch upload ---
    const { failures: upFailures } = await uploadMultipleFiles(
        plan.toUpload.map(u => ({
            filename: `${u.noteId}.json`,
            content: u.memory,
            existingFileId: u.remoteFileId
        }))
    );
    errors.push(...upFailures.map(f => f.replace('.json', '')));

    // --- Phase 4: Delete remote files for local tombstones ---
    for (const item of plan.toDeleteRemote) {
        try {
            await deleteFileById(item.fileId);
        } catch (e) {
            console.error(`[Sync] Failed to delete remote file for ${item.noteId}:`, e);
            errors.push(item.noteId);
        }
    }

    // --- Phase 5: Local deletions ---
    // Hard-delete tombstones (after their remote counterparts have been removed)
    for (const id of plan.toHardDeleteLocal) {
        try { await deleteMemory(id); } catch (e) { errors.push(id); }
    }
    // Delete local copies that were deleted remotely by another device
    for (const id of plan.toDeleteLocal) {
        try { await deleteMemory(id); } catch (e) { errors.push(id); }
    }

    return errors;
};

// ---- Provider Component ----

export const SyncProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const { authStatus, getAccessToken } = useAuth();

  // Use refs for values that shouldn't trigger re-renders in dependency arrays
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSyncingRef = useRef(false);

  // Internal helper to sync a single file without state checks (upload only, no tombstone)
  const syncFileInternal = useCallback(async (memory: Memory) => {
      if (memory.isSample || memory.isPending || memory.processingError) return;

      try {
          const filename = `${memory.id}.json`;
          const remoteFile = await findFileByName(filename);
          await uploadFile(filename, memory, remoteFile?.id);

          // Update snapshot immediately
          const updatedFile = await findFileByName(filename);
          if (updatedFile) {
              const snapshot = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '{}');
              snapshot[memory.id] = updatedFile.modifiedTime;
              localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
          }
      } catch (e) {
          console.error(`[Sync] Internal sync failed for ${memory.id}:`, e);
          throw e; // Propagate error for handling in caller
      }
  }, []);

  const saveSnapshot = useCallback((remoteFiles: any[]) => {
      const snapshot = Object.fromEntries(remoteFiles.map((f: any) => [f.name.replace('.json', ''), f.modifiedTime]));
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
      localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
  }, []);

  // ---- Full Sync ----
  // Classifies every note into download/upload/delete/skip, then executes
  // the plan using batch parallel operations.

  const doFullSync = useCallback(async () => {
    const localMemories = await getMemories();
    const localMap = new Map(localMemories.map(m => [m.id, m]));

    const remoteFiles = await listAllFiles();
    const remoteMap = new Map(remoteFiles.map((f: any) => [f.name.replace('.json', ''), f]));

    // Load previous snapshot to detect which remote files have actually changed
    const snapshot: Record<string, string> = JSON.parse(
        localStorage.getItem(SNAPSHOT_KEY) || '{}'
    );
    const hasSnapshot = Object.keys(snapshot).length > 0;
    const lastSyncTime = parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0');

    console.log(`[Sync-Debug] localMap.size=${localMap.size} remoteMap.size=${remoteMap.size} hasSnapshot=${hasSnapshot} snapshotKeys=${Object.keys(snapshot).length} lastSyncTime=${lastSyncTime}`);

    // --- Classification ---
    const plan: SyncPlan = {
        toDownload: [],
        toUpload: [],
        toDeleteLocal: [],
        toDeleteRemote: [],
        toHardDeleteLocal: [],
    };

    const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);
    let skippedSample = 0, skippedPending = 0, skippedTombstone = 0, skippedUnchanged = 0;
    let classRemoteOnly = 0, classBothSnapshotMismatch = 0, classLocalOnly = 0;

    for (const id of allIds) {
        const local = localMap.get(id);
        const remote = remoteMap.get(id);

        // Skip sample memories and memories still being processed by AI
        if (local?.isSample || (!local && id.startsWith('sample-'))) { skippedSample++; continue; }
        if (local && (local.isPending || local.processingError)) { skippedPending++; continue; }

        // Local tombstone — delete remote, then hard-delete local
        if (local?.isDeleted) {
            if (remote) {
                plan.toDeleteRemote.push({ noteId: id, fileId: remote.id });
            }
            plan.toHardDeleteLocal.push(id);
            skippedTombstone++;
            continue;
        }

        if (local && !remote) {
            classLocalOnly++;
            // Local-only, no remote counterpart
            if (hasSnapshot && snapshot[id]) {
                // Was in snapshot but gone from remote → another device deleted it
                plan.toDeleteLocal.push(id);
            } else {
                // New local note (not in snapshot) → upload
                plan.toUpload.push({ noteId: id, memory: local });
            }
        } else if (!local && remote) {
            classRemoteOnly++;
            // Remote-only → download
            plan.toDownload.push({ noteId: id, fileId: remote.id });
        } else if (local && remote) {
            // Both exist — use snapshot to skip unchanged files
            if (hasSnapshot && snapshot[id] === remote.modifiedTime) {
                // Remote hasn't changed since last sync
                if (local.timestamp > lastSyncTime) {
                    // But local was modified → upload
                    plan.toUpload.push({ noteId: id, memory: local, remoteFileId: remote.id });
                } else {
                    skippedUnchanged++;
                }
                // Otherwise both unchanged → skip entirely (no network call)
            } else {
                classBothSnapshotMismatch++;
                // Remote changed (or first sync without snapshot) → download for comparison
                plan.toDownload.push({ noteId: id, fileId: remote.id, local });
            }
        }
    }

    console.log(`[Sync-Debug] Classification: remoteOnly=${classRemoteOnly} bothSnapshotMismatch=${classBothSnapshotMismatch} localOnly=${classLocalOnly} skipped(sample=${skippedSample} pending=${skippedPending} tombstone=${skippedTombstone} unchanged=${skippedUnchanged})`);
    console.log(`[Sync] Full sync plan: download=${plan.toDownload.length} upload=${plan.toUpload.length} deleteRemote=${plan.toDeleteRemote.length} deleteLocal=${plan.toDeleteLocal.length} tombstones=${plan.toHardDeleteLocal.length}`);

    const errors = await executeSyncPlan(plan);

    if (errors.length > 0) {
        console.error(`[Sync] ${errors.length} item(s) failed:`, errors);
        throw new Error(`Failed to reconcile ${errors.length} items`);
    }

    // Re-fetch remote file listing AFTER plan execution so the snapshot
    // reflects updated modifiedTime values for any files we uploaded/created.
    // Without this, the snapshot is stale and the next sync re-downloads
    // every file that was uploaded during this sync.
    const updatedRemoteFiles = await listAllFiles();
    saveSnapshot(updatedRemoteFiles);
    console.log('--- [Sync] Full Sync Complete ---');
  }, [saveSnapshot]);

  // ---- Delta Sync ----
  // Only processes notes that changed since the last snapshot.
  // Uses the same batch download/upload pattern as full sync.

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

    // 1. Remote changes — files whose modifiedTime differs from snapshot
    for (const [noteId, remoteFile] of remoteMap.entries()) {
        if (previousSnapshot[noteId] && previousSnapshot[noteId] === remoteFile.modifiedTime) {
            continue; // Unchanged remote file — skip
        }

        handled.add(noteId);
        const local = localMap.get(noteId);

        if (local?.isSample || noteId.startsWith('sample-')) continue;

        if (local?.isDeleted) {
            // Local tombstone wins over remote change — delete remote
            plan.toDeleteRemote.push({ noteId, fileId: remoteFile.id });
            plan.toHardDeleteLocal.push(noteId);
        } else if (!local) {
            // New remote file — download
            plan.toDownload.push({ noteId, fileId: remoteFile.id });
        } else {
            // Both exist, remote changed — download for timestamp comparison
            plan.toDownload.push({ noteId, fileId: remoteFile.id, local });
        }
    }

    // 2. Remote deletions — files in snapshot that are no longer on Drive
    for (const noteId of Object.keys(previousSnapshot)) {
        if (remoteMap.has(noteId)) continue; // Still exists remotely
        if (handled.has(noteId)) continue;

        handled.add(noteId);
        const local = localMap.get(noteId);

        if (local?.isDeleted) {
            // Both sides agree it's deleted — just clean up the local tombstone
            plan.toHardDeleteLocal.push(noteId);
        } else if (local) {
            // Remote was deleted by another device — remove local copy
            plan.toDeleteLocal.push(noteId);
        }
        // If no local copy either, nothing to do
    }

    // 3. Local changes — notes modified after last sync or local tombstones not yet handled
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

    console.log(`[Sync] Delta sync plan: download=${plan.toDownload.length} upload=${plan.toUpload.length} deleteRemote=${plan.toDeleteRemote.length} deleteLocal=${plan.toDeleteLocal.length} tombstones=${plan.toHardDeleteLocal.length}`);

    const errors = await executeSyncPlan(plan);

    if (errors.length > 0) {
        console.error(`[Sync] ${errors.length} item(s) failed:`, errors);
        throw new Error(`Failed to sync ${errors.length} items`);
    }

    // Re-fetch remote files for an accurate snapshot (same reasoning as doFullSync).
    const updatedRemoteFiles = await listAllFiles();
    saveSnapshot(updatedRemoteFiles);
    console.log('--- [Sync] Delta Sync Complete ---');
  }, [saveSnapshot]);

  // ---- Sync Dispatch ----

  const performSync = useCallback(async (forceFull = false) => {
    if (isSyncingRef.current || !checkIsLinked()) return;

    // Debounce check
    if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
    }

    return new Promise<void>((resolve, reject) => {
        debounceTimerRef.current = setTimeout(async () => {
            setIsSyncing(true);
            isSyncingRef.current = true;
            setSyncError(null);

            try {
                await getAccessToken(); // Ensure token is valid
                const previousSnapshotJSON = localStorage.getItem(SNAPSHOT_KEY);

                if (forceFull || !previousSnapshotJSON) {
                    console.log('--- [Sync] Mode: FULL ---');
                    await doFullSync();
                } else {
                    console.log('--- [Sync] Mode: DELTA (Snapshot Diff) ---');
                    await doDeltaSync(JSON.parse(previousSnapshotJSON));
                }

                // Trigger RAG reconciliation after any successful sync
                reconcileEmbeddings().catch(e => console.error("[Sync] RAG Reconciliation failed:", e));

                resolve();
            } catch (e: any) {
                console.error('[Sync] Sync process failed:', e);
                let errorMessage = 'Sync failed';
                if (e.message.includes('Unauthorized') || e.message.includes('401')) {
                    errorMessage = 'Authentication expired. Please reconnect Drive.';
                } else if (e.message.includes('Network')) {
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
  }, [doFullSync, doDeltaSync, getAccessToken]);

  // ---- Single File Sync ----
  // Used for individual note save/delete operations (file-by-file as requested).

  const performSingleSync = useCallback(async (memory: Memory) => {
      if (isSyncingRef.current || !checkIsLinked()) return;

      // We don't debounce single file syncs as strictly, but prevent overlap
      setIsSyncing(true);
      isSyncingRef.current = true;
      try {
          await getAccessToken();

          if (memory.isDeleted) {
              // Tombstone: delete from Drive (if present) then hard-delete locally
              const remoteFile = await findFileByName(`${memory.id}.json`);
              if (remoteFile) {
                  await deleteFileById(remoteFile.id);
              }
              await deleteMemory(memory.id);
              // Remove from snapshot so delta sync doesn't treat it as a remote deletion
              const snapshot = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '{}');
              delete snapshot[memory.id];
              localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
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

  // Clean up timer on unmount
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
