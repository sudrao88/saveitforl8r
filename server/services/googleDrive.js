/**
 * Google Drive service — fetches user notes from Google Drive's appDataFolder
 * using the user's OAuth access token.
 */

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DOWNLOAD_CONCURRENCY = 100;
const MAX_PAGE_SIZE = 1000;

// Prefixes used by non-note files in appDataFolder
const NON_NOTE_PREFIXES = ['moment-', 'event-', 'todo-'];

/**
 * Make an authenticated request to the Google Drive API.
 */
const driveFetch = async (url, accessToken) => {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    const err = new Error(`Drive API error ${res.status}: ${errorText}`);
    err.status = res.status;
    throw err;
  }
  return res;
};

/**
 * List all note files in appDataFolder, handling pagination.
 * Returns array of { id, name } objects (Drive file metadata).
 */
const listNoteFiles = async (accessToken) => {
  const allFiles = [];
  let pageToken = null;

  do {
    let url = `${DRIVE_API_BASE}/files?spaces=appDataFolder&fields=files(id,name)&pageSize=${MAX_PAGE_SIZE}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

    const res = await driveFetch(url, accessToken);
    const data = await res.json();

    const noteFiles = (data.files || []).filter(
      (f) => f.name.endsWith('.json') && !NON_NOTE_PREFIXES.some((p) => f.name.startsWith(p))
    );
    allFiles.push(...noteFiles);

    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return allFiles;
};

/**
 * Download a single file's content from Drive.
 */
const downloadFile = async (fileId, accessToken) => {
  const url = `${DRIVE_API_BASE}/files/${fileId}?alt=media`;
  const res = await driveFetch(url, accessToken);
  return res.json();
};

/**
 * Download multiple files with a sliding-window concurrency pool.
 * Unlike batch-and-wait, this starts a new download as soon as any slot
 * frees up, keeping all `concurrency` slots busy at all times.
 */
const downloadFilesWithConcurrency = async (files, accessToken, concurrency = DOWNLOAD_CONCURRENCY) => {
  const results = [];
  let index = 0;

  const next = async () => {
    const i = index++;
    if (i >= files.length) return;
    try {
      const data = await downloadFile(files[i].id, accessToken);
      if (data) results.push(data);
    } catch {
      // Individual download failures are silently skipped
    }
    await next();
  };

  const workers = Array.from(
    { length: Math.min(concurrency, files.length) },
    () => next()
  );
  await Promise.all(workers);

  return results;
};

/**
 * Map a full Memory object to the light format used by query/moment endpoints.
 */
const toLightMemory = (m) => ({
  id: m.id,
  timestamp: m.timestamp,
  content: m.content,
  tags: m.tags || [],
  enrichment: m.enrichment
    ? {
        summary: m.enrichment.summary,
        locationContext: m.enrichment.locationContext,
        entityContext: m.enrichment.entityContext,
        keyPoints: m.enrichment.keyPoints,
        actionItems: m.enrichment.actionItems,
        themes: m.enrichment.themes,
      }
    : undefined,
  attachments: (m.attachments || []).map((a) => ({ name: a.name })),
});

/**
 * Fetch all notes from the user's Google Drive appDataFolder.
 * Returns an array of light memory objects, filtered and ready for AI processing.
 */
export const fetchAllNotes = async (accessToken) => {
  const files = await listNoteFiles(accessToken);

  if (files.length === 0) return [];

  const memories = await downloadFilesWithConcurrency(files, accessToken);

  return memories
    .filter((m) => m && m.id && m.content && !m.isDeleted && !m.isPending)
    .map(toLightMemory);
};

/**
 * Fetch specific notes by their IDs from Google Drive.
 * Looks up each noteId as `{noteId}.json` in appDataFolder.
 */
export const fetchNotesByIds = async (accessToken, noteIds) => {
  if (!noteIds || noteIds.length === 0) return [];

  // List all files and filter to matching IDs
  const allFiles = await listNoteFiles(accessToken);
  const targetFilenames = new Set(noteIds.map((id) => `${id}.json`));
  const matchingFiles = allFiles.filter((f) => targetFilenames.has(f.name));

  if (matchingFiles.length === 0) return [];

  const memories = await downloadFilesWithConcurrency(matchingFiles, accessToken);

  return memories
    .filter((m) => m && m.id && m.content)
    .map(toLightMemory);
};
