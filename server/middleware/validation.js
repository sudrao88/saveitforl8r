/**
 * Input validation middleware for all API endpoints.
 */

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/markdown',
];

/** Must match MAX_ATTACHMENTS in utils/attachmentUtils.ts. */
export const MAX_ATTACHMENTS = 20;

/** l8rgram enriches photos only — restrict to the image subset. */
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gemini File API URIs follow this pattern. */
export const GEMINI_FILE_URI_RE = /^https:\/\/generativelanguage\.googleapis\.com\//;

/** Gemini File API names look like "files/abc123" — used for ai.files.delete. */
const GEMINI_FILE_NAME_RE = /^files\/[A-Za-z0-9_-]+$/;

/**
 * Validates an optional pair (fileUri, fileName) referencing a Gemini File
 * API upload — used by /api/query, /api/create-moment, /api/synthesize when
 * the inline notes/memories payload exceeds the 1.2 MB threshold.
 *
 * Returns null when valid (or both fields absent), or an error string.
 */
export const validateContextFileRef = (fileUri, fileName) => {
  if (fileUri === undefined && fileName === undefined) return null;
  if (typeof fileUri !== 'string' || !GEMINI_FILE_URI_RE.test(fileUri)) {
    return 'fileUri must be a valid Gemini File API URI';
  }
  if (typeof fileName !== 'string' || !GEMINI_FILE_NAME_RE.test(fileName)) {
    return 'fileName must be a valid Gemini File API name (e.g. "files/abc123")';
  }
  return null;
};

export const validateEnrichInput = (req, res, next) => {
  const { text, attachments, tags, location, memoryId } = req.body;

  if (memoryId !== undefined) {
    if (typeof memoryId !== 'string' || !UUID_REGEX.test(memoryId)) {
      return res.status(400).json({ error: 'memoryId must be a valid UUID' });
    }
  }

  if (text !== undefined && text !== null) {
    if (typeof text !== 'string')
      return res.status(400).json({ error: 'text must be a string' });
    if (text.length > 10_000)
      return res.status(400).json({ error: 'text exceeds maximum length (10000 chars)' });
  }

  if (attachments !== undefined) {
    if (!Array.isArray(attachments))
      return res.status(400).json({ error: 'attachments must be an array' });
    if (attachments.length > MAX_ATTACHMENTS)
      return res.status(400).json({ error: `Maximum ${MAX_ATTACHMENTS} attachments allowed` });

    for (const att of attachments) {
      if (!att.mimeType || !ALLOWED_MIME_TYPES.includes(att.mimeType)) {
        return res.status(400).json({
          error: `Unsupported attachment type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
        });
      }
      // Attachment must have either inline data or a fileUri from chunked upload
      if (!att.data && !att.fileUri) {
        return res.status(400).json({ error: 'Attachment must have either data or fileUri' });
      }
      if (att.data && att.data.length > 70_000_000) {
        return res.status(400).json({ error: 'Attachment data too large (max ~52MB base64)' });
      }
      if (att.fileUri) {
        if (typeof att.fileUri !== 'string') {
          return res.status(400).json({ error: 'fileUri must be a string' });
        }
        if (!GEMINI_FILE_URI_RE.test(att.fileUri)) {
          return res.status(400).json({ error: 'fileUri must be a valid Gemini File API URI' });
        }
      }
    }
  }

  if (tags !== undefined) {
    if (!Array.isArray(tags))
      return res.status(400).json({ error: 'tags must be an array' });
    if (tags.length > 20)
      return res.status(400).json({ error: 'Maximum 20 tags allowed' });
    if (tags.some((t) => typeof t !== 'string' || t.length > 100)) {
      return res.status(400).json({ error: 'Invalid tag format' });
    }
  }

  if (location !== undefined && location !== null) {
    const { latitude, longitude } = location;
    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return res.status(400).json({ error: 'Invalid location coordinates' });
    }
  }

  const { moments } = req.body;
  if (moments !== undefined) {
    if (!Array.isArray(moments))
      return res.status(400).json({ error: 'moments must be an array' });
    if (moments.length > 50)
      return res.status(400).json({ error: 'Too many moments (max 50)' });
  }

  next();
};

const MAX_HISTORY_TURNS = 10;
const MAX_TURN_TEXT_LENGTH = 4000;

export const validateQueryInput = (req, res, next) => {
  const { query, memories, history, memoriesFileUri, memoriesFileName } = req.body;

  if (!query || typeof query !== 'string')
    return res.status(400).json({ error: 'query is required and must be a string' });
  if (query.length > 2_000)
    return res.status(400).json({ error: 'query too long (max 2000 chars)' });

  const fileRefError = validateContextFileRef(memoriesFileUri, memoriesFileName);
  if (fileRefError) return res.status(400).json({ error: `memoriesFileUri/Name: ${fileRefError}` });

  // When memoriesFileUri is provided, the memories array is optional —
  // the LLM reads the context from the uploaded Gemini File.
  if (memories !== undefined) {
    if (!Array.isArray(memories))
      return res.status(400).json({ error: 'memories must be an array' });
    if (memories.length > 200)
      return res.status(400).json({ error: 'Too many memories (max 200)' });
  }

  if (history !== undefined) {
    if (!Array.isArray(history))
      return res.status(400).json({ error: 'history must be an array' });
    if (history.length > MAX_HISTORY_TURNS)
      return res.status(400).json({ error: `Too many history turns (max ${MAX_HISTORY_TURNS})` });
    for (const turn of history) {
      if (!turn.role || !['user', 'model'].includes(turn.role))
        return res.status(400).json({ error: 'Each history turn must have role "user" or "model"' });
      if (!turn.text || typeof turn.text !== 'string')
        return res.status(400).json({ error: 'Each history turn must have a text string' });
      if (turn.text.length > MAX_TURN_TEXT_LENGTH)
        return res.status(400).json({ error: `History turn text too long (max ${MAX_TURN_TEXT_LENGTH} chars)` });
    }
  }

  next();
};

export const validateResultsInput = (req, res, next) => {
  const { memoryIds } = req.body;

  if (!memoryIds || !Array.isArray(memoryIds)) {
    return res.status(400).json({ error: 'memoryIds must be an array' });
  }
  if (memoryIds.length === 0) {
    return res.status(400).json({ error: 'memoryIds must not be empty' });
  }
  if (memoryIds.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 memoryIds allowed' });
  }
  for (const id of memoryIds) {
    if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
      return res.status(400).json({ error: `Invalid memoryId: ${id}` });
    }
  }

  next();
};

// ─── l8rgram: photo enrichment + gallery search ─────────────────────────────

/** Max photo contexts the client may send in one gallery search request. */
const MAX_PHOTO_CONTEXTS = 1000;

/**
 * Validates POST /api/enrich-photo: a single image (inline base64 or a
 * pre-uploaded Gemini fileUri) plus a client-generated jobId used to key the
 * durable result. Mirrors the attachment caps in validateEnrichInput but is
 * restricted to image MIME types.
 */
export const validateEnrichPhoto = (req, res, next) => {
  const { jobId, image } = req.body;

  if (typeof jobId !== 'string' || !UUID_REGEX.test(jobId)) {
    return res.status(400).json({ error: 'jobId must be a valid UUID' });
  }

  if (!image || typeof image !== 'object' || Array.isArray(image)) {
    return res.status(400).json({ error: 'image is required and must be an object' });
  }
  if (!image.mimeType || !ALLOWED_IMAGE_MIME_TYPES.includes(image.mimeType)) {
    return res.status(400).json({
      error: `Unsupported image type. Allowed: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}`,
    });
  }
  if (!image.data && !image.fileUri) {
    return res.status(400).json({ error: 'image must have either data or fileUri' });
  }
  if (image.data !== undefined) {
    if (typeof image.data !== 'string') {
      return res.status(400).json({ error: 'image.data must be a string' });
    }
    if (image.data.length > 70_000_000) {
      return res.status(400).json({ error: 'image data too large (max ~52MB base64)' });
    }
  }
  if (image.fileUri !== undefined) {
    if (typeof image.fileUri !== 'string' || !GEMINI_FILE_URI_RE.test(image.fileUri)) {
      return res.status(400).json({ error: 'image.fileUri must be a valid Gemini File API URI' });
    }
  }

  next();
};

/** Validates POST /api/enrich-photo/results: an array of client jobIds. */
export const validatePhotoResultsInput = (req, res, next) => {
  const { jobIds } = req.body;

  if (!jobIds || !Array.isArray(jobIds)) {
    return res.status(400).json({ error: 'jobIds must be an array' });
  }
  if (jobIds.length === 0) {
    return res.status(400).json({ error: 'jobIds must not be empty' });
  }
  if (jobIds.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 jobIds allowed' });
  }
  for (const id of jobIds) {
    if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
      return res.status(400).json({ error: `Invalid jobId: ${id}` });
    }
  }

  next();
};

/**
 * Validates POST /api/query-gallery: a natural-language query plus a compact
 * per-photo context array the model searches over. Each context is small
 * (id + caption + tags + capturedAt + albumTitles) so the array cap is higher
 * than the memory-recall query's.
 */
export const validateQueryGallery = (req, res, next) => {
  const { query, photoContexts } = req.body;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required and must be a string' });
  }
  if (query.length > 2_000) {
    return res.status(400).json({ error: 'query too long (max 2000 chars)' });
  }

  if (!photoContexts || !Array.isArray(photoContexts)) {
    return res.status(400).json({ error: 'photoContexts must be an array' });
  }
  if (photoContexts.length > MAX_PHOTO_CONTEXTS) {
    return res.status(400).json({ error: `Too many photoContexts (max ${MAX_PHOTO_CONTEXTS})` });
  }
  for (const ctx of photoContexts) {
    if (!ctx || typeof ctx !== 'object' || typeof ctx.id !== 'string') {
      return res.status(400).json({ error: 'Each photoContext must have a string id' });
    }
    if (ctx.tags !== undefined && !Array.isArray(ctx.tags)) {
      return res.status(400).json({ error: 'photoContext.tags must be an array' });
    }
    if (ctx.albumTitles !== undefined && !Array.isArray(ctx.albumTitles)) {
      return res.status(400).json({ error: 'photoContext.albumTitles must be an array' });
    }
  }

  next();
};

export const validateSynthesizeInput = (req, res, next) => {
  const { notes, momentType, momentTitle, objective, momentId, notesFileUri, notesFileName, noteCount, inputHash } = req.body;

  const fileRefError = validateContextFileRef(notesFileUri, notesFileName);
  if (fileRefError) return res.status(400).json({ error: `notesFileUri/Name: ${fileRefError}` });

  // When notesFileUri is supplied, notes may be omitted (LLM reads from the file).
  if (notesFileUri) {
    if (notes !== undefined) {
      return res.status(400).json({ error: 'notes must not be provided when notesFileUri is set' });
    }
    if (noteCount !== undefined && (typeof noteCount !== 'number' || !Number.isInteger(noteCount) || noteCount < 0 || noteCount > 5_000)) {
      return res.status(400).json({ error: 'noteCount must be a non-negative integer (max 5000)' });
    }
  } else {
    if (!notes || !Array.isArray(notes))
      return res.status(400).json({ error: 'notes is required and must be an array' });
    if (notes.length > 500)
      return res.status(400).json({ error: 'Too many notes (max 500)' });
  }
  if (!momentType || typeof momentType !== 'string')
    return res.status(400).json({ error: 'momentType is required and must be a string' });
  if (!momentTitle || typeof momentTitle !== 'string')
    return res.status(400).json({ error: 'momentTitle is required and must be a string' });
  if (objective !== undefined && typeof objective !== 'string')
    return res.status(400).json({ error: 'objective must be a string' });
  if (!momentId || typeof momentId !== 'string')
    return res.status(400).json({ error: 'momentId is required and must be a string' });
  if (!UUID_REGEX.test(momentId))
    return res.status(400).json({ error: 'momentId must be a valid UUID' });
  if (inputHash !== undefined) {
    if (typeof inputHash !== 'string')
      return res.status(400).json({ error: 'inputHash must be a string' });
    if (inputHash.length > 64)
      return res.status(400).json({ error: 'inputHash too long (max 64 chars)' });
  }

  next();
};

export const validateSynthesizeResultsInput = (req, res, next) => {
  const { momentIds } = req.body;

  if (!momentIds || !Array.isArray(momentIds))
    return res.status(400).json({ error: 'momentIds must be an array' });
  if (momentIds.length === 0)
    return res.status(400).json({ error: 'momentIds must not be empty' });
  if (momentIds.length > 10)
    return res.status(400).json({ error: 'Maximum 10 momentIds per request' });
  for (const id of momentIds) {
    if (typeof id !== 'string' || !UUID_REGEX.test(id))
      return res.status(400).json({ error: `Invalid momentId: ${id}` });
  }

  next();
};

/** RFC3339 timestamp, e.g. 2024-01-01T00:00:00Z or 2024-01-01T00:00:00.000+05:30 */
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** One year in ms (366 days to allow leap years at the boundary). */
const MAX_CALENDAR_SPAN_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * Validates GET /api/calendar/events query params:
 *   - timeMin, timeMax: required RFC3339 timestamps; timeMax must be after
 *     timeMin and the span must not exceed one year.
 *   - pageToken: optional opaque continuation string.
 */
export const validateCalendarQuery = (req, res, next) => {
  const { timeMin, timeMax, pageToken } = req.query;

  if (!timeMin || !timeMax) {
    return res.status(400).json({ error: 'timeMin and timeMax are required' });
  }
  if (typeof timeMin !== 'string' || !RFC3339_RE.test(timeMin) ||
      typeof timeMax !== 'string' || !RFC3339_RE.test(timeMax)) {
    return res.status(400).json({ error: 'timeMin and timeMax must be RFC3339 timestamps' });
  }

  const min = Date.parse(timeMin);
  const max = Date.parse(timeMax);
  if (Number.isNaN(min) || Number.isNaN(max)) {
    return res.status(400).json({ error: 'timeMin and timeMax must be valid timestamps' });
  }
  if (max <= min) {
    return res.status(400).json({ error: 'timeMax must be after timeMin' });
  }
  if (max - min > MAX_CALENDAR_SPAN_MS) {
    return res.status(400).json({ error: 'time span must not exceed 1 year' });
  }

  if (pageToken !== undefined) {
    if (typeof pageToken !== 'string' || pageToken.length > 4096) {
      return res.status(400).json({ error: 'pageToken must be a string (max 4096 chars)' });
    }
  }

  next();
};

export const validateUploadInit = (req, res, next) => {
  const { fileName, fileSize, mimeType, totalChunks, memoryId } = req.body;

  if (!fileName || typeof fileName !== 'string' || fileName.length > 256)
    return res.status(400).json({ error: 'fileName is required (max 256 chars)' });
  if (typeof fileSize !== 'number' || fileSize <= 0 || fileSize > 55_000_000)
    return res.status(400).json({ error: 'fileSize must be between 1 and 55000000 bytes' });
  if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType))
    return res.status(400).json({ error: `Unsupported mimeType. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` });
  if (typeof totalChunks !== 'number' || totalChunks < 1 || totalChunks > 60 || !Number.isInteger(totalChunks))
    return res.status(400).json({ error: 'totalChunks must be an integer between 1 and 60' });

  // Cross-validate: totalChunks must be plausible for the given fileSize.
  // 900KB chunk size on client → expect ceil(fileSize / 921600) chunks.
  const EXPECTED_CHUNK_SIZE = 900 * 1024;
  const expectedChunks = Math.ceil(fileSize / EXPECTED_CHUNK_SIZE);
  if (totalChunks < expectedChunks || totalChunks > expectedChunks + 1)
    return res.status(400).json({ error: `totalChunks (${totalChunks}) is inconsistent with fileSize (${fileSize})` });

  if (!memoryId || typeof memoryId !== 'string' || !UUID_REGEX.test(memoryId))
    return res.status(400).json({ error: 'memoryId must be a valid UUID' });

  next();
};

export const validateUploadChunk = (req, res, next) => {
  const { sessionId, chunkIndex } = req.params;

  if (!sessionId || !UUID_REGEX.test(sessionId))
    return res.status(400).json({ error: 'Invalid sessionId' });

  const idx = parseInt(chunkIndex, 10);
  if (isNaN(idx) || idx < 0 || idx > 59)
    return res.status(400).json({ error: 'chunkIndex must be an integer between 0 and 59' });

  req.chunkIndex = idx;
  next();
};
