/**
 * Input validation middleware for all API endpoints.
 */

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
];

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    if (attachments.length > 5)
      return res.status(400).json({ error: 'Maximum 5 attachments allowed' });

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
        return res.status(400).json({ error: 'Attachment too large (max 50MB)' });
      }
      if (att.fileUri && typeof att.fileUri !== 'string') {
        return res.status(400).json({ error: 'fileUri must be a string' });
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
  const { query, memories, history } = req.body;

  if (!query || typeof query !== 'string')
    return res.status(400).json({ error: 'query is required and must be a string' });
  if (query.length > 2_000)
    return res.status(400).json({ error: 'query too long (max 2000 chars)' });

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

export const validateSynthesizeInput = (req, res, next) => {
  const { notes, momentType, momentTitle, objective, momentId } = req.body;

  if (!notes || !Array.isArray(notes))
    return res.status(400).json({ error: 'notes is required and must be an array' });
  if (notes.length > 500)
    return res.status(400).json({ error: 'Too many notes (max 500)' });
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
