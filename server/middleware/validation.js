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

export const validateEnrichInput = (req, res, next) => {
  const { text, attachments, tags, location, memoryId, requestId } = req.body;

  if (memoryId !== undefined) {
    if (typeof memoryId !== 'string' || !UUID_REGEX.test(memoryId)) {
      return res.status(400).json({ error: 'memoryId must be a valid UUID' });
    }
  }

  if (requestId !== undefined && requestId !== null) {
    if (typeof requestId !== 'string' || !UUID_REGEX.test(requestId)) {
      return res.status(400).json({ error: 'requestId must be a valid UUID' });
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

// --- Assistant ---

export const MAX_ASSISTANT_HISTORY_TURNS = 12;
export const MAX_ASSISTANT_TURN_LENGTH = 6000;
export const MAX_ASSISTANT_QUESTION_LENGTH = 2000;
export const MAX_ASSISTANT_TOOL_RESULTS = 12;
export const MAX_ASSISTANT_RESULT_LENGTH = 40_000;
export const MAX_ASSISTANT_RESULTS_TOTAL = 160_000;
const MAX_ASSISTANT_ARGS_LENGTH = 400;
const ASSISTANT_TOOL_NAMES = ['search_notes', 'get_notes', 'list_notes', 'read_attachment'];
const ASSISTANT_MAX_STEPS = 4;

export const validateAssistantStepInput = (req, res, next) => {
  const { question, history, toolResults, step, context } = req.body || {};
  const fail = (error) => res.status(400).json({ error });

  if (typeof question !== 'string' || !question.trim()) return fail('question is required and must be a string');
  if (question.length > MAX_ASSISTANT_QUESTION_LENGTH)
    return fail(`question too long (max ${MAX_ASSISTANT_QUESTION_LENGTH} chars)`);

  if (step !== undefined && (!Number.isInteger(step) || step < 1 || step > ASSISTANT_MAX_STEPS))
    return fail(`step must be an integer from 1 to ${ASSISTANT_MAX_STEPS}`);

  if (history !== undefined) {
    if (!Array.isArray(history)) return fail('history must be an array');
    if (history.length > MAX_ASSISTANT_HISTORY_TURNS)
      return fail(`Too many history turns (max ${MAX_ASSISTANT_HISTORY_TURNS})`);
    for (const turn of history) {
      if (!turn || !['user', 'model'].includes(turn.role))
        return fail('Each history turn must have role "user" or "model"');
      if (typeof turn.text !== 'string' || !turn.text)
        return fail('Each history turn must have a text string');
      if (turn.text.length > MAX_ASSISTANT_TURN_LENGTH)
        return fail(`History turn text too long (max ${MAX_ASSISTANT_TURN_LENGTH} chars)`);
    }
  }

  if (toolResults !== undefined) {
    if (!Array.isArray(toolResults)) return fail('toolResults must be an array');
    if (toolResults.length > MAX_ASSISTANT_TOOL_RESULTS)
      return fail(`Too many tool results (max ${MAX_ASSISTANT_TOOL_RESULTS})`);
    let total = 0;
    for (const r of toolResults) {
      if (!r || !ASSISTANT_TOOL_NAMES.includes(r.tool)) return fail('Each tool result must name a known tool');
      if (typeof r.args !== 'string' || r.args.length > MAX_ASSISTANT_ARGS_LENGTH)
        return fail(`Each tool result must have an args string (max ${MAX_ASSISTANT_ARGS_LENGTH} chars)`);
      if (typeof r.result !== 'string') return fail('Each tool result must have a result string');
      if (r.result.length > MAX_ASSISTANT_RESULT_LENGTH)
        return fail(`Tool result too long (max ${MAX_ASSISTANT_RESULT_LENGTH} chars)`);
      total += r.result.length;
    }
    if (total > MAX_ASSISTANT_RESULTS_TOTAL)
      return fail(`Tool results too long in total (max ${MAX_ASSISTANT_RESULTS_TOTAL} chars)`);
  }

  if (context !== undefined) {
    if (!context || typeof context !== 'object' || Array.isArray(context)) return fail('context must be an object');
    if (context.today !== undefined && (typeof context.today !== 'string' || context.today.length > 60))
      return fail('context.today must be a short string');
    if (context.noteCount !== undefined && (!Number.isInteger(context.noteCount) || context.noteCount < 0))
      return fail('context.noteCount must be a non-negative integer');
  }

  next();
};

const ASSISTANT_NOTE_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
/** Inline attachment data above this must be pre-uploaded and sent as a fileUri. */
export const MAX_ASSISTANT_INLINE_ATTACHMENT_CHARS = 1_200_000;

/**
 * /api/assistant/attachment. With only noteId + attachmentId the server reads
 * the file from the user's Drive. The app-upload fallback adds mimeType and
 * either a pre-uploaded Gemini file (fileUri + fileName) or small inline data.
 */
export const validateAssistantAttachmentInput = (req, res, next) => {
  const { noteId, attachmentId, name, question, mimeType, fileUri, fileName, data } = req.body || {};
  const fail = (error) => res.status(400).json({ error });

  if (typeof noteId !== 'string' || !ASSISTANT_NOTE_ID_RE.test(noteId)) return fail('noteId is required');
  if (typeof attachmentId !== 'string' || !attachmentId || attachmentId.length > 100)
    return fail('attachmentId is required (max 100 chars)');
  if (typeof question !== 'string' || !question.trim() || question.length > 500)
    return fail('question is required (max 500 chars)');
  if (name !== undefined && (typeof name !== 'string' || name.length > 256))
    return fail('name must be a string (max 256 chars)');

  const hasFile = fileUri !== undefined || fileName !== undefined;
  const hasData = data !== undefined;
  if (hasFile && hasData) return fail('Send either fileUri or data, not both');

  if (hasFile) {
    if (typeof fileUri !== 'string' || !GEMINI_FILE_URI_RE.test(fileUri))
      return fail('fileUri must be a valid Gemini File API URI');
    if (typeof fileName !== 'string' || !/^files\/[A-Za-z0-9_-]+$/.test(fileName))
      return fail('fileName must be a valid Gemini File API name (e.g. "files/abc123")');
  }
  if (hasData) {
    if (typeof data !== 'string' || !data) return fail('data must be a base64 string');
    if (data.length > MAX_ASSISTANT_INLINE_ATTACHMENT_CHARS)
      return fail(`data too long (max ${MAX_ASSISTANT_INLINE_ATTACHMENT_CHARS} chars); upload the file instead`);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return fail('data must be base64');
  }
  if (hasFile || hasData) {
    if (typeof mimeType !== 'string' || !ALLOWED_MIME_TYPES.includes(mimeType))
      return fail(`Unsupported mimeType. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`);
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

/** Limits for /api/moment/sections. Mirrored client-side in utils/momentAiSections.ts. */
export const MAX_SECTION_NOTES = 60;
export const MAX_EXISTING_SECTIONS = 6;
const MAX_SECTION_ID_LENGTH = 64;

const isShortString = (v, max) => typeof v === 'string' && v.length <= max;

export const validateMomentSectionsInput = (req, res, next) => {
  const { title, notes, existing } = req.body;

  if (typeof title !== 'string' || !title.trim() || title.length > 2200)
    return res.status(400).json({ error: 'title must be a non-empty string' });
  if (!Array.isArray(notes) || notes.length === 0)
    return res.status(400).json({ error: 'notes must be a non-empty array' });
  if (notes.length > MAX_SECTION_NOTES)
    return res.status(400).json({ error: `Too many notes (max ${MAX_SECTION_NOTES})` });

  const ids = new Set();
  for (const n of notes) {
    if (!n || typeof n !== 'object')
      return res.status(400).json({ error: 'Each note must be an object' });
    if (typeof n.id !== 'string' || !n.id || n.id.length > MAX_SECTION_ID_LENGTH || ids.has(n.id))
      return res.status(400).json({ error: 'Each note needs a unique id' });
    ids.add(n.id);
    if (!isShortString(n.title, 500) || !n.title.trim())
      return res.status(400).json({ error: 'Each note needs a title (max 500 chars)' });
    if (n.summary !== undefined && !isShortString(n.summary, 1000))
      return res.status(400).json({ error: 'Note summary too long (max 1000 chars)' });
    if (n.type !== undefined && !isShortString(n.type, 200))
      return res.status(400).json({ error: 'Note type too long (max 200 chars)' });
    if (n.tags !== undefined && (!Array.isArray(n.tags) || n.tags.length > 20 || !n.tags.every((t) => isShortString(t, 100))))
      return res.status(400).json({ error: 'Note tags must be up to 20 short strings' });
  }

  if (existing !== undefined) {
    if (!Array.isArray(existing) || existing.length > MAX_EXISTING_SECTIONS)
      return res.status(400).json({ error: `existing must be an array of up to ${MAX_EXISTING_SECTIONS} sections` });
    const sectionIds = new Set();
    for (const s of existing) {
      if (!s || typeof s !== 'object')
        return res.status(400).json({ error: 'Each existing section must be an object' });
      if (typeof s.id !== 'string' || !s.id || s.id.length > MAX_SECTION_ID_LENGTH || sectionIds.has(s.id))
        return res.status(400).json({ error: 'Each existing section needs a unique id' });
      sectionIds.add(s.id);
      if (!isShortString(s.label, 100) || !s.label.trim())
        return res.status(400).json({ error: 'Each existing section needs a label (max 100 chars)' });
      if (s.description !== undefined && !isShortString(s.description, 500))
        return res.status(400).json({ error: 'Section description too long (max 500 chars)' });
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
