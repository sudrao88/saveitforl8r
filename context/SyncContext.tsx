
import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { getMemories, saveMemory, deleteMemory } from '../services/storageService';
import { 
    listAllFiles, 
    downloadFileContent, 
    uploadFile, 
    findFileByName,
    initializeGoogleAuth, 
    loginToDrive, 
    isLinked, 
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

  const performSync = useCallback(async (forceFull = false) => {
    if (isSyncing || !isLinked()) return;
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
  }, [isSyncing]);

  const doFullSync = async () => {
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
  };

  const doDeltaSync = async (previousSnapshot: Record<string, string>) => {
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
            await performSingleSync(local);
        }
    }

    // 4. Save new state
    saveSnapshot(currentRemoteFiles);
    console.log('--- [Sync] Delta Sync Complete ---');
  };

  const reconcileItem = async (id: string, local: Memory | undefined, remoteFile: any | undefined) => {
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
  };
  
  const saveSnapshot = (remoteFiles: any[]) => {
      const snapshot = Object.fromEntries(remoteFiles.map(f => [f.name.replace('.json', ''), f.modifiedTime]));
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
      localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
  };

  const performSingleSync = useCallback(async (memory: Memory) => {
      if (isSyncing || !isLinked()) return;
      if (memory.isSample || memory.isPending || memory.processingError) return;
      setIsSyncing(true); 
      try {
          await getAccessToken();
          const filename = `${memory.id}.json`;
          const remoteFile = await findFileByName(filename);
          await uploadFile(filename, memory, remoteFile?.id);
          // After a single sync, we need to update the snapshot to include this file
          // to avoid delta sync thinking it's a new remote file next time.
          const updatedFile = await findFileByName(filename);
          if (updatedFile) {
              const snapshot = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '{}');
              snapshot[memory.id] = updatedFile.modifiedTime;
              localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
          }
      } catch (e) {
          console.error(`[Sync] Single sync failed for ${memory.id}:`, e);
          throw e;
      } finally {
          setIsSyncing(false);
      }
  }, [isSyncing]);

  return (
    <SyncContext.Provider value={{
        isSyncing,
        sync: performSync,
        syncFile: performSingleSync, 
        initialize: initializeGoogleAuth,
        login: loginToDrive,
        isLinked,
        unlink: unlinkDrive
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
