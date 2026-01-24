
import React, { createContext, useContext, useState, useCallback, ReactNode, useRef, useEffect } from 'react';
import { getMemories, saveMemory, deleteMemory } from '../services/storageService';
import { 
    listAllFiles, 
    downloadFileContent, 
    uploadFile, 
    findFileByName,
    isLinked as checkIsLinked
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

export const SyncProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  
  const { authStatus, getAccessToken } = useAuth();
  
  // Use refs for values that shouldn't trigger re-renders in dependency arrays
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSyncingRef = useRef(false);

  // Internal helper to sync a single file without state checks
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
      const snapshot = Object.fromEntries(remoteFiles.map(f => [f.name.replace('.json', ''), f.modifiedTime]));
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
      localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
  }, []);

  const reconcileItem = useCallback(async (id: string, local: Memory | undefined, remoteFile: any | undefined) => {
      if (local?.isSample || (!local && id.startsWith('sample-')) || (local && (local.isPending || local.processingError))) return;
      try {
        if (local && !remoteFile) {
            await uploadFile(`${id}.json`, local);
        } else if (!local && remoteFile) {
            const content = await downloadFileContent(remoteFile.id);
            if (!content.isDeleted) await saveMemory(content);
        } else if (local && remoteFile) {
            const remoteContent = await downloadFileContent(remoteFile.id);
            if (remoteContent.timestamp > local.timestamp) {
                if (remoteContent.isDeleted) await deleteMemory(id);
                else await saveMemory(remoteContent);
            } else if (local.timestamp > remoteContent.timestamp) {
                await uploadFile(`${id}.json`, local, remoteFile.id);
            }
        }
      } catch (e) {
          console.error(`[Sync] Error reconciling ${id}`, e);
          throw e;
      }
  }, []);

  const doFullSync = useCallback(async () => {
    const localMemories = await getMemories();
    const localMap = new Map(localMemories.map(m => [m.id, m]));
    
    const remoteFiles = await listAllFiles();
    const remoteMap = new Map(remoteFiles.map(f => [f.name.replace('.json', ''), f]));

    const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);
    
    const errors: string[] = [];
    
    for (const id of allIds) {
        try {
            await reconcileItem(id, localMap.get(id), remoteMap.get(id));
        } catch (e) {
            errors.push(id);
        }
    }

    if (errors.length > 0) {
        throw new Error(`Failed to reconcile ${errors.length} items`);
    }

    saveSnapshot(remoteFiles);
    console.log('--- [Sync] Full Sync Complete ---');
  }, [reconcileItem, saveSnapshot]);

  const doDeltaSync = useCallback(async (previousSnapshot: Record<string, string>) => {
    const currentRemoteFiles = await listAllFiles();
    const currentRemoteMap = new Map(currentRemoteFiles.map(f => [f.name.replace('.json', ''), f]));

    const errors: string[] = [];

    // 1. Remote changes
    for (const [noteId, remoteFile] of currentRemoteMap.entries()) {
        if (!previousSnapshot[noteId] || previousSnapshot[noteId] !== remoteFile.modifiedTime) {
            try {
                console.log(`[Sync-Delta] Remote change detected for ${noteId}`);
                const local = await getMemories().then(m => m.find(mem => mem.id === noteId));
                await reconcileItem(noteId, local, remoteFile);
            } catch (e) {
                errors.push(noteId);
            }
        }
    }
    // 2. Remote deletions
    for (const noteId in previousSnapshot) {
        if (!currentRemoteMap.has(noteId)) {
            try {
                console.log(`[Sync-Delta] Remote deletion detected for ${noteId}`);
                const local = await getMemories().then(m => m.find(mem => mem.id === noteId));
                if (local) await deleteMemory(noteId);
            } catch (e) {
                errors.push(noteId);
            }
        }
    }

    // 3. Local changes
    const lastSyncTime = parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0');
    const localMemories = await getMemories();
    const unsyncedLocals = localMemories.filter(m => m.timestamp > lastSyncTime);
    
    if (unsyncedLocals.length > 0) {
        console.log(`[Sync-Delta] Found ${unsyncedLocals.length} potentially unsynced local changes.`);
        for (const local of unsyncedLocals) {
            try {
                await syncFileInternal(local);
            } catch (e) {
                 errors.push(local.id);
            }
        }
    }

    if (errors.length > 0) {
        throw new Error(`Failed to sync ${errors.length} items`);
    }

    saveSnapshot(currentRemoteFiles);
    console.log('--- [Sync] Delta Sync Complete ---');
  }, [reconcileItem, syncFileInternal, saveSnapshot]);

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

  const performSingleSync = useCallback(async (memory: Memory) => {
      if (isSyncingRef.current || !checkIsLinked()) return;
      
      // We don't debounce single file syncs as strictly, but prevent overlap
      setIsSyncing(true);
      isSyncingRef.current = true; 
      try {
          await getAccessToken();
          await syncFileInternal(memory);
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
