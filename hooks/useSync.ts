
import { getMemories, saveMemory, deleteMemory } from '../services/storageService';
import { 
    listAllFiles, 
    downloadFileContent, 
    uploadFile, 
    initializeGoogleAuth, 
    loginToDrive, 
    isLinked, 
    unlinkDrive,
    getAccessToken
} from '../services/googleDriveService';

export const useSync = () => {
  const performSync = async () => {
    if (!isLinked()) {
        console.log('[Sync] Not linked, skipping.');
        return;
    }

    try {
        console.log('--- [Sync] Starting Sync Process ---');
        
        // 0. Ensure we have a valid token
        const token = await getAccessToken();
        if (!token) throw new Error("Could not acquire access token");

        // 1. Fetch ALL Local Data
        const localMemories = await getMemories();
        const localMap = new Map(localMemories.map(m => [m.id, m]));
        console.log(`[Sync] Local memories count: ${localMemories.length}`);

        // 2. Fetch ALL Remote Data Metadata
        console.log('[Sync] Fetching remote file list...');
        const remoteFiles = await listAllFiles();
        const jsonFiles = remoteFiles.filter(f => f.name.endsWith('.json') && !f.trashed);
        const remoteMap = new Map(jsonFiles.map(f => [f.name.replace('.json', ''), f]));
        console.log(`[Sync] Remote notes found: ${jsonFiles.length}`);

        // 3. Create a unified set of IDs
        const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);
        
        let stats = { uploaded: 0, downloaded: 0, updatedLocal: 0, updatedRemote: 0, skipped: 0, errors: 0 };

        // 4. Iterate and Sync File-by-File
        for (const id of allIds) {
            const local = localMap.get(id);
            const remoteFile = remoteMap.get(id);

            // SKIP SAMPLES
            if (local?.isSample) continue;
            if (!local && id.startsWith('sample-')) continue;

            // SKIP PENDING / FAILED ENRICHMENT
            // We only sync "complete" memories to avoid overwriting enriched data with base data
            // or syncing partial states.
            if (local && (local.isPending || local.processingError)) {
                console.log(`[Sync] Skipping pending/failed memory: ${id}`);
                continue;
            }

            try {
                // Case A: Exists only Locally -> Upload
                // This covers: New Notes AND Local Deletions (Tombstones)
                if (local && !remoteFile) {
                    console.log(`[Sync] Action: Uploading new note to Drive (${id})`);
                    await uploadFile(`${id}.json`, local);
                    stats.uploaded++;
                }
                
                // Case B: Exists only Remotely -> Download
                // This covers: New Remote Notes AND Remote Deletions (Tombstones)
                else if (!local && remoteFile) {
                    console.log(`[Sync] Action: Downloading new note from Drive (${id})`);
                    const content = await downloadFileContent(remoteFile.id);
                    
                    if (content.isDeleted) {
                        console.log(`[Sync] Ignored remote tombstone for ${id}`);
                    } else {
                        // Normal new note
                        await saveMemory(content);
                        stats.downloaded++;
                    }
                }

                // Case C: Exists on Both -> Conflict Resolution
                else if (local && remoteFile) {
                    const remoteContent = await downloadFileContent(remoteFile.id);
                    const remoteInternalTime = remoteContent.timestamp || 0;
                    const localModTime = local.timestamp;

                    if (remoteInternalTime > localModTime) {
                         console.log(`[Sync] Action: Updating local (Remote is newer) (${id})`);
                         
                         if (remoteContent.isDeleted) {
                             await deleteMemory(id);
                             console.log(`[Sync] Deleted local note ${id} based on remote tombstone`);
                         } else {
                             await saveMemory(remoteContent);
                         }
                         stats.updatedLocal++;

                    } else if (localModTime > remoteInternalTime) {
                         console.log(`[Sync] Action: Updating remote (Local is newer) (${id})`);
                         await uploadFile(`${id}.json`, local, remoteFile.id);
                         stats.updatedRemote++;
                    } else {
                        // Equal timestamps
                        stats.skipped++;
                    }
                }
            } catch (innerError) {
                console.error(`[Sync] Error processing note ${id}:`, innerError);
                stats.errors++;
            }
        }
        
        console.log('--- [Sync] Completed ---');
        console.log(`[Sync] Stats: Uploads: ${stats.uploaded}, Downloads: ${stats.downloaded}, Local Updates: ${stats.updatedLocal}, Remote Updates: ${stats.updatedRemote}, Errors: ${stats.errors}`);

    } catch (error) {
        console.error('[Sync] Fatal Error:', error);
        throw error;
    }
  };

  return {
    sync: performSync,
    initialize: initializeGoogleAuth,
    login: loginToDrive, 
    isLinked,
    unlink: unlinkDrive
  };
};
