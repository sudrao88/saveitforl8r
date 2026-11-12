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

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gemini File API URIs follow this pattern. */
export const GEMINI_FILE_URI_RE = /^https:\/\/generativelanguage\.googleapis\.com\//;

/** Gemini File API names look like "files/abc123" — used for ai.files.delete. */
const GEMINI_FILE_NAME_RE = /^files\/[A-Za-z0-9_-]+$/;

/**
 * Validates an optional pair (fileUri, fileName) referencing a Gemini File
 * API upload — used by /api/query when the inline memories payload exceeds
 * the 1.2 MB threshold.
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

const MAX_EMBED_BATCH = 50;
const MAX_EMBED_TEXT_LENGTH = 8000;

export const validateEmbedInput = (req, res, next) => {
  const { texts } = req.body;

  if (!Array.isArray(texts))
    return res.status(400).json({ error: 'texts is required and must be an array' });
  if (texts.length === 0)
    return res.status(400).json({ error: 'texts must not be empty' });
  if (texts.length > MAX_EMBED_BATCH)
    return res.status(400).json({ error: `Too many texts (max ${MAX_EMBED_BATCH})` });

  for (const t of texts) {
    if (typeof t !== 'string')
      return res.status(400).json({ error: 'Each text must be a string' });
    if (t.length > MAX_EMBED_TEXT_LENGTH)
      return res.status(400).json({ error: `Text too long (max ${MAX_EMBED_TEXT_LENGTH} chars)` });
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

/** Max terms per moment, and max length of one term. Mirrored client-side in utils/momentMatching.ts. */
export const MAX_MOMENT_TERMS = 10;
export const MAX_MOMENT_TERM_LENGTH = 200;

export const validateMomentEmbedInput = (req, res, next) => {
  const { terms } = req.body;

  if (!Array.isArray(terms) || terms.length === 0)
    return res.status(400).json({ error: 'terms must be a non-empty array' });
  if (terms.length > MAX_MOMENT_TERMS)
    return res.status(400).json({ error: `Too many terms (max ${MAX_MOMENT_TERMS})` });
  for (const t of terms) {
    if (typeof t !== 'string' || !t.trim())
      return res.status(400).json({ error: 'Each term must be a non-empty string' });
    if (t.length > MAX_MOMENT_TERM_LENGTH)
      return res.status(400).json({ error: `Term too long (max ${MAX_MOMENT_TERM_LENGTH} chars)` });
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
