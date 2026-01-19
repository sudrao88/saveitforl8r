
import { getMemories, saveMemory, deleteMemory } from '../services/storageService';
import { syncNote, deleteRemoteNote, listChanges, getStartPageToken, downloadFileContent, initializeGoogleAuth, requestAccessToken, isLinked, unlinkDrive } from '../services/googleDriveService';

export const useSync = () => {
  const performSync = async () => {
    if (!isLinked()) return;
    
    // Ensure we have a token
    requestAccessToken();

    // 1. Get all local memories
    const localMemories = await getMemories();
    const localMap = new Map(localMemories.map(m => [m.id, m]));

    // 2. Get remote file list (Initial simple sync: List all)
    // Optimization: In real app, store a 'syncPageToken' in localStorage and use listChanges(token)
    // For this MVP, we will list all files to ensure consistency.
    const { files } = await listChanges(); 

    if (!files) return;

    for (const file of files) {
      if (!file.name.endsWith('.json')) continue;
      const id = file.name.replace('.json', '');
      const local = localMap.get(id);

      // If remote file exists...
      if (file.trashed) {
        if (local) {
           // Remote deleted, delete local? Or re-upload?
           // Strategy: If local is newer than file.modifiedTime, re-upload. Else delete.
           // Since we can't see content of trashed file easily, let's assume valid delete for now.
           // await deleteMemory(id); 
        }
        continue;
      }

      const remoteContent = await downloadFileContent(file.id);
      
      if (!local) {
        // Download new note
        await saveMemory(remoteContent);
      } else {
        // Conflict resolution
        if (remoteContent.timestamp > local.timestamp) {
          await saveMemory(remoteContent);
        } else if (remoteContent.timestamp < local.timestamp) {
           // We will handle uploads in the next loop, so skip here
        }
      }
      
      // Remove from map so we know what's left to upload
      localMap.delete(id);
    }

    // 3. Upload remaining local files (New ones) or Updates
    // The previous loop removed items that were processed (either updated local or skipped because local was newer)
    // Wait, if local was newer, we didn't do anything in the loop.
    // Actually, we should iterate ALL local files to check if they need upload.
    
    // Let's refine:
    // We processed Downloads and Updates FROM Server.
    // Now we need to process Uploads TO Server.
    
    const allLocal = await getMemories();
    for (const mem of allLocal) {
        await syncNote(mem);
    }
  };

  return {
    sync: performSync,
    initialize: initializeGoogleAuth,
    isLinked,
    unlink: unlinkDrive
  };
};
