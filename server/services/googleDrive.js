/**
 * Google Drive service — fetches user notes from Google Drive's appDataFolder
 * using the user's OAuth access token.
 */

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DOWNLOAD_CONCURRENCY = 100;
const MAX_PAGE_SIZE = 1000;

// Non-note file prefixes in appDataFolder. Used to build the Drive query
// filter so that the API only returns note files, avoiding unnecessary
// data transfer for moments, events, todos, syntheses, and key backups.
const NON_NOTE_PREFIXES = ['moment-', 'event-', 'todo-', 'saveitforl8r-key-'];

// Drive `q` filter that excludes all non-note files server-side.
// Drive files API applies this before returning results, so we never
// receive metadata for files we don't need.
const NOTE_FILES_QUERY = NON_NOTE_PREFIXES
  .map((p) => `not name contains '${p}'`)
  .join(' and ')
  + " and name contains '.json'";

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
 * List note files in appDataFolder, handling pagination.
 * Uses Drive's `q` parameter to filter server-side so only note JSON files
 * are returned — no moments, events, todos, or key backups.
 *
 * @param {string} accessToken
 * @param {string} [extraQuery] - Additional `q` clause to append (e.g. name filters).
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
const listNoteFiles = async (accessToken, extraQuery) => {
  const allFiles = [];
  let pageToken = null;

  const q = extraQuery
    ? `${NOTE_FILES_QUERY} and ${extraQuery}`
    : NOTE_FILES_QUERY;

  do {
    let url = `${DRIVE_API_BASE}/files?spaces=appDataFolder&fields=files(id,name)&pageSize=${MAX_PAGE_SIZE}&q=${encodeURIComponent(q)}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

    const res = await driveFetch(url, accessToken);
    const data = await res.json();

    allFiles.push(...(data.files || []));

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
  let skipped = 0;
  let index = 0;

  const next = async () => {
    const i = index++;
    if (i >= files.length) return;
    try {
      const data = await downloadFile(files[i].id, accessToken);
      if (data) results.push(data);
    } catch (err) {
      skipped++;
      console.warn(`[Drive] Failed to download file ${files[i].name} (${files[i].id}): ${err.message}`);
    }
    await next();
  };

  const workers = Array.from(
    { length: Math.min(concurrency, files.length) },
    () => next()
  );
  await Promise.all(workers);

  if (skipped > 0) {
    console.warn(`[Drive] ${skipped}/${files.length} file downloads failed, ${results.length} succeeded`);
  }

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

// Drive `q` clauses have a practical length limit. We chunk name-based
// queries into groups to stay well under it.
const NAME_QUERY_CHUNK_SIZE = 50;

/**
 * Fetch specific notes by their IDs from Google Drive.
 * Builds a Drive `q` filter like `(name = 'a.json' or name = 'b.json')`
 * so Drive only returns the files we need — no full listing required.
 */
export const fetchNotesByIds = async (accessToken, noteIds) => {
  if (!noteIds || noteIds.length === 0) return [];

  // Chunk noteIds into groups and query Drive for each chunk
  const matchingFiles = [];
  for (let i = 0; i < noteIds.length; i += NAME_QUERY_CHUNK_SIZE) {
    const chunk = noteIds.slice(i, i + NAME_QUERY_CHUNK_SIZE);
    const nameFilter = '(' + chunk.map((id) => `name = '${id}.json'`).join(' or ') + ')';
    const files = await listNoteFiles(accessToken, nameFilter);
    matchingFiles.push(...files);
  }

  if (matchingFiles.length === 0) return [];

  const memories = await downloadFilesWithConcurrency(matchingFiles, accessToken);

  return memories
    .filter((m) => m && m.id && m.content)
    .map(toLightMemory);
};
