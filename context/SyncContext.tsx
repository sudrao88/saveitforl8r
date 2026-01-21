
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
  sync: () => Promise<void>;
  syncFile: (memory: Memory) => Promise<void>;
  initialize: (cb?: () => void) => void;
  login: () => Promise<void>;
  isLinked: () => boolean;
  unlink: () => void;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export const SyncProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isSyncing, setIsSyncing] = useState(false);

  // Full Sync
  const performFullSync = useCallback(async () => {
    if (!isLinked()) return;
    setIsSyncing(true);
    
    try {
        console.log('--- [Sync] Starting Full Sync ---');
        const token = await getAccessToken();
        if (!token) throw new Error("No token");

        const localMemories = await getMemories();
        const localMap = new Map(localMemories.map(m => [m.id, m]));
        
        const remoteFiles = await listAllFiles();
        const jsonFiles = remoteFiles.filter(f => f.name.endsWith('.json') && !f.trashed);
        const remoteMap = new Map(jsonFiles.map(f => [f.name.replace('.json', ''), f]));

        const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);
        
        for (const id of allIds) {
            const local = localMap.get(id);
            const remoteFile = remoteMap.get(id);

            if (local?.isSample) continue;
            if (!local && id.startsWith('sample-')) continue;
            if (local && (local.isPending || local.processingError)) continue;

            try {
                if (local && !remoteFile) {
                    await uploadFile(`${id}.json`, local);
                } else if (!local && remoteFile) {
                    const content = await downloadFileContent(remoteFile.id);
                    if (!content.isDeleted) await saveMemory(content);
                } else if (local && remoteFile) {
                    const remoteContent = await downloadFileContent(remoteFile.id);
                    const remoteTime = remoteContent.timestamp || 0;
                    const localTime = local.timestamp;

                    if (remoteTime > localTime) {
                        if (remoteContent.isDeleted) await deleteMemory(id);
                        else await saveMemory(remoteContent);
                    } else if (localTime > remoteTime) {
                        await uploadFile(`${id}.json`, local, remoteFile.id);
                    }
                }
            } catch (e) {
                console.error(`[Sync] Error on ${id}`, e);
            }
        }
        console.log('--- [Sync] Full Sync Complete ---');
    } catch (e) {
        console.error('[Sync] Failed:', e);
    } finally {
        setIsSyncing(false);
    }
  }, []);

  // Single File Sync (Optimized)
  const performSingleSync = useCallback(async (memory: Memory) => {
      if (!isLinked()) return;
      
      // Do not sync pending/error/sample notes
      if (memory.isSample || memory.isPending || memory.processingError) return;

      setIsSyncing(true); 
      
      try {
          console.log(`[Sync] Syncing single file: ${memory.id}`);
          const token = await getAccessToken();
          if (!token) throw new Error("No token");

          const filename = `${memory.id}.json`;
          const remoteFile = await findFileByName(filename);

          if (remoteFile) {
              // Remote exists, check conflict? 
              // For a single file push (local update), we generally assume local is newest 
              // unless we want to be very safe.
              // Given this is triggered by "Enrichment Done" or "User Edit", local IS newer.
              // We just overwrite remote.
              await uploadFile(filename, memory, remoteFile.id);
          } else {
              // New upload
              await uploadFile(filename, memory);
          }
          console.log(`[Sync] Single file sync success: ${memory.id}`);
      } catch (e) {
          console.error(`[Sync] Single sync failed for ${memory.id}`, e);
      } finally {
          setIsSyncing(false);
      }
  }, []);

  return (
    <SyncContext.Provider value={{
        isSyncing,
        sync: performFullSync,
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
