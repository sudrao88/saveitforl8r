
import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { getMemories, saveMemory, deleteMemory } from '../services/storageService';
import { 
    listAllFiles, 
    downloadFileContent, 
    uploadFile, 
    findFileByName,
    initializeGoogleAuth, 
    loginToDrive, 
    isLinked as checkIsLinked, 
    unlinkDrive,
    getAccessToken
} from '../services/googleDriveService';
import { Memory } from '../types';

interface SyncContextType {
  isSyncing: boolean;
  sync: (forceFull?: boolean) => Promise<void>;
  syncFile: (memory: Memory) => Promise<void>;
  initialize: (cb?: () => void) => void;
  login: () => Promise<void>;
  isLinked: () => boolean;
  unlink: () => void;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

const SNAPSHOT_KEY = 'gdrive_remote_snapshot';
const LAST_SYNC_KEY = 'gdrive_last_sync_time';

export const SyncProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isSyncing, setIsSyncing] = useState(false);

  // Internal helper to sync a single file without state checks (for use inside sync loop)
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
          // We don't throw here to avoid stopping the entire batch
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
      }
  }, []);

  const doFullSync = useCallback(async () => {
    const localMemories = await getMemories();
    const localMap = new Map(localMemories.map(m => [m.id, m]));
    
    const remoteFiles = await listAllFiles();
    const remoteMap = new Map(remoteFiles.map(f => [f.name.replace('.json', ''), f]));

    const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);
    
    for (const id of allIds) {
        await reconcileItem(id, localMap.get(id), remoteMap.get(id));
    }

    saveSnapshot(remoteFiles);
    console.log('--- [Sync] Full Sync Complete ---');
  }, [reconcileItem, saveSnapshot]);

  const doDeltaSync = useCallback(async (previousSnapshot: Record<string, string>) => {
    // 1. Get current remote state
    const currentRemoteFiles = await listAllFiles();
    const currentRemoteMap = new Map(currentRemoteFiles.map(f => [f.name.replace('.json', ''), f]));

    // 2. Find remote changes (New, Updated, Deleted)
    // New or Updated
    for (const [noteId, remoteFile] of currentRemoteMap.entries()) {
        if (!previousSnapshot[noteId] || previousSnapshot[noteId] !== remoteFile.modifiedTime) {
            console.log(`[Sync-Delta] Remote change detected for ${noteId}`);
            const local = await getMemories().then(m => m.find(mem => mem.id === noteId));
            await reconcileItem(noteId, local, remoteFile);
        }
    }
    // Deleted
    for (const noteId in previousSnapshot) {
        if (!currentRemoteMap.has(noteId)) {
            console.log(`[Sync-Delta] Remote deletion detected for ${noteId}`);
            const local = await getMemories().then(m => m.find(mem => mem.id === noteId));
            if (local) await deleteMemory(noteId);
        }
    }

    // 3. Find and sync local changes (offline work)
    const lastSyncTime = parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0');
    const localMemories = await getMemories();
    const unsyncedLocals = localMemories.filter(m => m.timestamp > lastSyncTime);
    
    if (unsyncedLocals.length > 0) {
        console.log(`[Sync-Delta] Found ${unsyncedLocals.length} potentially unsynced local changes.`);
        for (const local of unsyncedLocals) {
            await syncFileInternal(local);
        }
    }

    // 4. Save new state
    saveSnapshot(currentRemoteFiles);
    console.log('--- [Sync] Delta Sync Complete ---');
  }, [reconcileItem, syncFileInternal, saveSnapshot]);

  const performSync = useCallback(async (forceFull = false) => {
    if (isSyncing || !checkIsLinked()) return;
    setIsSyncing(true);
    
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
        
    } catch (e) {
        console.error('[Sync] Sync process failed:', e);
        throw e;
    } finally {
        setIsSyncing(false);
    }
  }, [isSyncing, doFullSync, doDeltaSync]);

  // External trigger for single file sync (guards against parallel sync)
  const performSingleSync = useCallback(async (memory: Memory) => {
      if (isSyncing || !checkIsLinked()) return;
      setIsSyncing(true); 
      try {
          await getAccessToken();
          await syncFileInternal(memory);
      } catch (e) {
          console.error(`[Sync] Single sync failed for ${memory.id}:`, e);
          throw e;
      } finally {
          setIsSyncing(false);
      }
  }, [isSyncing, syncFileInternal]);
  
  const handleInitialize = useCallback((cb?: () => void) => {
    initializeGoogleAuth(cb);
  }, []);

  const handleLogin = useCallback(async () => {
    await loginToDrive();
  }, []);

  const handleIsLinked = useCallback(() => {
    return checkIsLinked();
  }, []);

  const handleUnlink = useCallback(() => {
    unlinkDrive();
  }, []);

  return (
    <SyncContext.Provider value={{
        isSyncing,
        sync: performSync,
        syncFile: performSingleSync, 
        initialize: handleInitialize,
        login: handleLogin,
        isLinked: handleIsLinked,
        unlink: handleUnlink
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
