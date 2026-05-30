// services/googleDriveService.ts
import { getAuthorizedFetch, getValidToken, initiateLogin, handleAuthCallback } from '@l8r/shared/auth';
import { clearTokens } from '@l8r/shared/auth';
import { storage } from '@l8r/shared/platform';

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  parents?: string[];
  trashed?: boolean;
}

const BATCH_CONCURRENCY = 6;
const DOWNLOAD_CONCURRENCY = 50;

export const loginToDrive = initiateLogin;
export const processAuthCallback = handleAuthCallback;

export const isLinked = async () => {
  const linked = await storage.get('gdrive_linked');
  return linked === 'true';
};

export const unlinkDrive = async () => {
  await clearTokens();
  await storage.remove('gdrive_linked');
  await storage.remove('gdrive_email');
};

const driveFetch = async (url: string, options: RequestInit = {}) => {
  try {
      const response = await getAuthorizedFetch(url, options);
      if (!response.ok) {
         const errorText = await response.text();
         console.error(`Drive API Error (${response.status}):`, errorText);
         if (response.status === 401) {
            throw new Error('Unauthorized');
         }
         throw new Error(`Drive API Failed: ${errorText}`);
      }
      return response;
  } catch (e) {
      console.error("Drive fetch error", e);
      throw e;
  }
};

export const findFileByName = async (filename: string): Promise<DriveFile | null> => {
  const safeFilename = filename.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const query = `name = '${safeFilename}' and 'appDataFolder' in parents and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(query)}&fields=files(id, name, modifiedTime)`;
  const res = await driveFetch(url);
  const data = await res.json();
  return data.files?.[0] || null;
};

// Returns every Drive file matching `filename` in appDataFolder. Drive permits
// duplicate filenames, and concurrent uploads (e.g. moment metadata + synthesis
// re-uploads racing across devices, or against a deletion) can create them.
// Deletion paths must remove all duplicates or the surviving copy resurrects
// the entity on the next sync. Paginates so duplicates beyond the default
// page size are not silently dropped.
export const findAllFilesByName = async (filename: string): Promise<DriveFile[]> => {
  const safeFilename = filename.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const query = `name = '${safeFilename}' and 'appDataFolder' in parents and trashed = false`;

  let allFiles: DriveFile[] = [];
  let pageToken: string | undefined = undefined;

  do {
    let url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=1000&q=${encodeURIComponent(query)}&fields=nextPageToken,files(id, name, modifiedTime)`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const res = await driveFetch(url);
    const data = await res.json();

    if (data.files) allFiles = allFiles.concat(data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFiles;
};

// Delete every Drive file matching `filename`, optionally keeping a single id.
// Centralizes the find-then-delete loop used by deletion paths and post-upload
// duplicate cleanup. Errors on individual deletes are warned and swallowed so
// one stuck file doesn't abort the rest.
export const cleanupFilesByName = async (
  filename: string,
  keepId?: string,
): Promise<void> => {
  const files = await findAllFilesByName(filename);
  for (const file of files) {
    if (keepId && file.id === keepId) continue;
    try {
      await deleteFileById(file.id);
    } catch (e) {
      console.warn(`[Drive] Failed to delete duplicate ${file.id} (${filename}):`, e);
    }
  }
};

export const downloadFileContent = async (fileId: string) => {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await driveFetch(url);
  return await res.json();
};

// Robust Multipart Upload Implementation
export const uploadFile = async (filename: string, content: any, existingFileId?: string) => {
  const metadata = {
    name: filename,
    parents: !existingFileId ? ['appDataFolder'] : undefined,
    mimeType: 'application/json'
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const body = delimiter +
    'Content-Type: application/json\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    JSON.stringify(content) +
    closeDelim;

  // `fields` is required: by default Drive v3 returns only id/name/mimeType
  // on files.create and files.update. Without modifiedTime in the response,
  // every caller that updates the snapshot from `uploaded.modifiedTime`
  // (syncFileInternal, performMomentSync, performCalendarEventsSync,
  // performTodoItemsSync, executeSyncPlan's batch path) silently no-ops,
  // leaving the snapshot stale and triggering a re-download next launch.
  let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime';
  let method = 'POST';

  if (existingFileId) {
    url = `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id,name,modifiedTime`;
    method = 'PATCH';
  }

  const token = await getValidToken();
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });

  if (!res.ok) {
    throw new Error(`Upload failed: ${await res.text()}`);
  }

  return await res.json();
};

// Paginate a single `files.list` query (q is already URL-encoded) to completion.
const listFilesByQuery = async (encodedQuery: string): Promise<DriveFile[]> => {
    const files: DriveFile[] = [];
    let pageToken: string | undefined = undefined;

    do {
        let url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=1000&q=${encodedQuery}&fields=nextPageToken,files(id, name, modifiedTime)`;
        if (pageToken) url += `&pageToken=${pageToken}`;

        const res = await driveFetch(url);
        const data = await res.json();

        if (data.files) files.push(...data.files);
        pageToken = data.nextPageToken;
    } while (pageToken);

    return files;
};

// Drive's `files.list` uses opaque pageTokens, so a single result set can't be
// paginated in parallel. Instead, shard the *query* by filename prefix and run
// the shards in parallel — each one paginates independently (usually in one
// page), cutting the pre-download check from N sequential round trips down to
// roughly one. Shards are mutually exclusive and exhaustive across the
// filename namespaces used by the app (see SyncContext.tsx note-id handling),
// so the merged result is identical to a single unfiltered list call.
export const listAllFiles = async (): Promise<DriveFile[]> => {
    const shardQueries = [
        `trashed=false and name contains 'moment-'`,
        `trashed=false and name contains 'event-'`,
        `trashed=false and name contains 'todo-'`,
        `trashed=false and not name contains 'moment-' and not name contains 'event-' and not name contains 'todo-'`,
    ];

    const shardResults = await Promise.all(
        shardQueries.map(q => listFilesByQuery(encodeURIComponent(q)))
    );

    return shardResults.flat();
};

export const deleteFileById = async (fileId: string) => {
    await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE' });
};

export const deleteRemoteNote = async (noteId: string) => {
    const file = await findFileByName(`${noteId}.json`);
    if (file) {
        await deleteFileById(file.id);
    }
};

export const downloadMultipleFiles = async (
    fileIds: string[],
    onFileDownloaded?: () => void
): Promise<{ contents: Map<string, any>; failures: string[] }> => {
    const contents = new Map<string, any>();
    const failures: string[] = [];
    if (fileIds.length === 0) return { contents, failures };

    // Sliding-window concurrency: keep DOWNLOAD_CONCURRENCY requests in
    // flight at all times instead of waiting for fixed-size batches.
    let nextIndex = 0;

    const processNext = async (): Promise<void> => {
        while (nextIndex < fileIds.length) {
            const idx = nextIndex++;
            const fileId = fileIds[idx];
            try {
                const content = await downloadFileContent(fileId);
                contents.set(fileId, content);
            } catch (e) {
                console.error(`[Drive] Download failed for ${fileId}:`, e);
                failures.push(fileId);
            }
            onFileDownloaded?.();
        }
    };

    const workers = Array.from(
        { length: Math.min(DOWNLOAD_CONCURRENCY, fileIds.length) },
        () => processNext()
    );
    await Promise.all(workers);

    return { contents, failures };
};

/**
 * Stream-download files and process each one as it arrives. Downloads run
 * with full sliding-window concurrency (DOWNLOAD_CONCURRENCY). Processing
 * is serialized via a queue to avoid race conditions on shared state while
 * still rendering cards to the UI as soon as each download completes.
 *
 * Files are processed in download-completion order (fastest first), which
 * means lighter text-only memories appear before heavier attachment files.
 */
export const downloadFilesStreaming = async (
    fileIds: string[],
    onFile: (fileId: string, content: any) => Promise<void>,
): Promise<{ failures: string[] }> => {
    const failures: string[] = [];
    if (fileIds.length === 0) return { failures };

    // Queue of downloaded files waiting to be processed, plus a resolver
    // that the processing loop awaits when the queue is empty.
    const queue: Array<{ fileId: string; content: any }> = [];
    // Shared state object so TS doesn't narrow the callback away.
    const state = { wake: null as (() => void) | null, done: false };

    // Signal the processing loop that a new item is available.
    const enqueue = (fileId: string, content: any) => {
        queue.push({ fileId, content });
        if (state.wake) {
            state.wake();
            state.wake = null;
        }
    };

    // Processing loop: runs sequentially, draining items as they arrive.
    const processLoop = async () => {
        while (true) {
            if (queue.length === 0) {
                if (state.done) break;
                // Wait until a download finishes or all downloads are done.
                await new Promise<void>(resolve => { state.wake = resolve; });
                continue;
            }
            const { fileId, content } = queue.shift()!;
            try {
                await onFile(fileId, content);
            } catch (e) {
                console.error(`[Drive] Stream process failed for ${fileId}:`, e);
                failures.push(fileId);
            }
        }
    };

    // Download workers: run in parallel with sliding-window concurrency.
    let nextIndex = 0;
    const downloadNext = async (): Promise<void> => {
        while (nextIndex < fileIds.length) {
            const idx = nextIndex++;
            const fileId = fileIds[idx];
            try {
                const content = await downloadFileContent(fileId);
                enqueue(fileId, content);
            } catch (e) {
                console.error(`[Drive] Stream download failed for ${fileId}:`, e);
                failures.push(fileId);
            }
        }
    };

    const downloadWorkers = Array.from(
        { length: Math.min(DOWNLOAD_CONCURRENCY, fileIds.length) },
        () => downloadNext()
    );

    // Start processing loop alongside the download workers.
    const processingDone = processLoop();
    await Promise.all(downloadWorkers);
    state.done = true;
    // Wake the processor in case it's waiting on an empty queue.
    state.wake?.();
    await processingDone;

    return { failures };
};

export const uploadMultipleFiles = async (
    items: Array<{ filename: string; content: any; existingFileId?: string }>
): Promise<{ failures: string[]; succeeded: Array<{ filename: string; modifiedTime: string }> }> => {
    const failures: string[] = [];
    const succeeded: Array<{ filename: string; modifiedTime: string }> = [];
    if (items.length === 0) return { failures, succeeded };

    for (let i = 0; i < items.length; i += BATCH_CONCURRENCY) {
        const batch = items.slice(i, i + BATCH_CONCURRENCY);
        const results = await Promise.all(
            batch.map(async (item) => {
                try {
                    const uploaded = await uploadFile(item.filename, item.content, item.existingFileId);
                    return { filename: item.filename, ok: true as const, modifiedTime: uploaded?.modifiedTime as string | undefined };
                } catch (e) {
                    console.error(`[Drive] Upload failed for ${item.filename}:`, e);
                    return { filename: item.filename, ok: false as const, modifiedTime: undefined };
                }
            })
        );
        for (const r of results) {
            if (!r.ok) {
                failures.push(r.filename);
            } else if (r.modifiedTime) {
                succeeded.push({ filename: r.filename, modifiedTime: r.modifiedTime });
            }
            // r.ok but no modifiedTime: upload succeeded but Drive didn't return
            // a usable timestamp — caller will rebuild snapshot for this entry
            // from a fresh listAllFiles next sync. Don't fail the item.
        }
    }
    return { failures, succeeded };
};

export const initializeGoogleAuth = (cb?: () => void) => { if(cb) cb(); };
export const getAccessToken = getValidToken;
