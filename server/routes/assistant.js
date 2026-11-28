/**
 * Assistant route — one step of the notes assistant.
 *
 * POST /api/assistant/step is stateless: the client sends the question, the
 * conversation so far and the results of every tool it has run for this
 * question. The response is either more tool requests (which the client runs
 * against its local notes) or the final answer.
 *
 * Each step is a single synchronous Gemini call kept well inside Firebase
 * Hosting's 60s request limit.
 *
 * POST /api/assistant/attachment runs the read_attachment tool: it gets one
 * file of a note (from the user's Drive, or from the app as a fallback), asks
 * Gemini what it says about a question, and returns that text.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateRequest } from '../middleware/auth.js';
import { validateAssistantStepInput, validateAssistantAttachmentInput, ALLOWED_MIME_TYPES } from '../middleware/validation.js';
import { parseJsonResponse } from '../lib/sanitize.js';
import { embedTexts } from '../lib/embedding.js';
import { createConcurrencyLimiter } from '../lib/concurrency.js';
import { AttachmentError, fetchNoteAttachment, MAX_ASSISTANT_ATTACHMENT_BYTES } from '../lib/driveNotes.js';
import {
  ASSISTANT_SYSTEM_PROMPT,
  assistantStepSchema,
  buildAssistantContents,
  normalizeAssistantStep,
  ATTACHMENT_SYSTEM_PROMPT,
  buildAttachmentContents,
  normalizeAttachmentText,
} from '../lib/assistant.js';

// Primary + fallback + query embedding must fit inside the 60s hosting limit.
const PRIMARY_TIMEOUT_MS = 28_000;
const FALLBACK_TIMEOUT_MS = 18_000;
const EMBED_TIMEOUT_MS = 6_000;

// Attachment reads: Drive download + File API upload + one Gemini call, again
// inside the 60s hosting limit.
const DRIVE_TIMEOUT_MS = 15_000;
const ATTACHMENT_READ_TIMEOUT_MS = 35_000;
/** Base64 above this goes through the Gemini File API instead of inline (as in enrich.js). */
const FILE_API_THRESHOLD = 1_200_000;
export const ASSISTANT_ATTACHMENTS_PER_MIN = 10;
// A Drive-fetched note is held in memory (tens of MB), so bound how many
// reads run at once on one instance.
const MAX_CONCURRENT_ATTACHMENT_READS = 4;

/** Questions per minute (a question is its first step). */
export const ASSISTANT_QUESTIONS_PER_MIN = 10;
/** Steps per minute across all questions (questions × steps, with headroom). */
export const ASSISTANT_STEPS_PER_MIN = 50;

export const createAssistantRouter = ({ ai, MODEL_NAME, FALLBACK_MODEL_NAME }) => {
  const router = Router();

  const limiterOptions = {
    windowMs: 60_000,
    keyGenerator: (req) => req.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Try again later.' },
  };
  // Users think in questions, not steps: only a question's first step counts
  // against the per-question limit. The step limit bounds total model calls.
  const questionLimiter = rateLimit({
    ...limiterOptions,
    max: ASSISTANT_QUESTIONS_PER_MIN,
    skip: (req) => req.body?.step > 1,
  });
  const stepLimiter = rateLimit({ ...limiterOptions, max: ASSISTANT_STEPS_PER_MIN });

  const generate = async (model, contents, timeoutMs, parentSignal) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onParentAbort = () => controller.abort();
    parentSignal.addEventListener('abort', onParentAbort);
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: ASSISTANT_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: assistantStepSchema,
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: controller.signal,
        },
      });
      return parseJsonResponse(response.text);
    } finally {
      clearTimeout(timeout);
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  };

  /** Attach a query vector to each search call so the client can rank by meaning. */
  const embedSearchCalls = async (calls, requestId, parentSignal) => {
    const searches = calls.filter((c) => c.tool === 'search_notes');
    if (searches.length === 0) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
    const onParentAbort = () => controller.abort();
    parentSignal.addEventListener('abort', onParentAbort);
    try {
      const vectors = await embedTexts(ai, searches.map((c) => c.query), { signal: controller.signal });
      searches.forEach((c, i) => { c.queryVector = vectors[i]; });
    } catch (err) {
      // Best-effort: without a vector the client falls back to keyword search.
      console.warn(`[Assistant] [${requestId}] Query embedding failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  };

  router.post(
    '/step',
    authenticateRequest,
    validateAssistantStepInput,
    questionLimiter,
    stepLimiter,
    async (req, res) => {
      const { question, history = [], toolResults = [], step = 1, context = {} } = req.body;

      // Stop spending Gemini quota once the client has gone away.
      const clientGone = new AbortController();
      res.on('close', () => { if (!res.writableEnded) clientGone.abort(); });

      const contents = buildAssistantContents({ question, history, toolResults, step, context });
      console.log(`[Assistant] [${req.requestId}] user=${req.userId} step=${step} history=${history.length} results=${toolResults.length}`);

      try {
        let parsed;
        try {
          parsed = await generate(MODEL_NAME, contents, PRIMARY_TIMEOUT_MS, clientGone.signal);
        } catch (primaryError) {
          if (clientGone.signal.aborted) return;
          console.warn(`[Assistant] [${req.requestId}] Primary model failed: ${primaryError.message}. Trying fallback…`);
          parsed = await generate(FALLBACK_MODEL_NAME, contents, FALLBACK_TIMEOUT_MS, clientGone.signal);
        }

        const result = normalizeAssistantStep(parsed, { step });
        if (result.type === 'tools') await embedSearchCalls(result.calls, req.requestId, clientGone.signal);
        if (clientGone.signal.aborted) return;
        res.json(result);
      } catch (error) {
        if (clientGone.signal.aborted) return;
        console.error(`[Assistant] [${req.requestId}] Step failed:`, error.message);
        res.status(502).json({ error: 'Assistant step failed' });
      }
    },
  );

  const attachmentLimiter = rateLimit({ ...limiterOptions, max: ASSISTANT_ATTACHMENTS_PER_MIN });
  const attachmentSlots = createConcurrencyLimiter(MAX_CONCURRENT_ATTACHMENT_READS, 20);

  router.post(
    '/attachment',
    authenticateRequest,
    validateAssistantAttachmentInput,
    attachmentLimiter,
    async (req, res) => {
      const { noteId, attachmentId, question, name, mimeType, fileUri, fileName, data } = req.body;
      // Gemini File API uploads to delete once the request is done (best-effort).
      const uploadedFileNames = [];
      if (fileName) uploadedFileNames.push(fileName);

      const clientGone = new AbortController();
      res.on('close', () => { if (!res.writableEnded) clientGone.abort(); });
      const withTimeout = (ms) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ms);
        const onParentAbort = () => controller.abort();
        clientGone.signal.addEventListener('abort', onParentAbort);
        return {
          signal: controller.signal,
          done: () => { clearTimeout(timer); clientGone.signal.removeEventListener('abort', onParentAbort); },
        };
      };

      try {
        const text = await attachmentSlots.run(async () => {
          let filePart;
          let displayName = name || 'attachment';
          let source;

          if (fileUri) {
            source = 'app-upload';
            // The app enforces the size cap before uploading; check it here too.
            const uploaded = await ai.files.get({ name: fileName });
            if (Number(uploaded?.sizeBytes) > MAX_ASSISTANT_ATTACHMENT_BYTES) {
              throw new AttachmentError('too_large', 'Attachment is larger than the assistant can read', 413);
            }
            filePart = { fileData: { fileUri, mimeType } };
          } else if (data) {
            source = 'app-inline';
            filePart = { inlineData: { data, mimeType } };
          } else {
            source = 'drive';
            const drive = withTimeout(DRIVE_TIMEOUT_MS);
            let attachment;
            try {
              attachment = await fetchNoteAttachment({
                accessToken: req.accessToken, noteId, attachmentId, signal: drive.signal,
              });
            } finally {
              drive.done();
            }
            if (!ALLOWED_MIME_TYPES.includes(attachment.mimeType)) {
              throw new AttachmentError('unsupported', 'This file type cannot be read', 415);
            }
            displayName = name || attachment.name;
            if (attachment.base64.length > FILE_API_THRESHOLD) {
              const blob = new Blob([Buffer.from(attachment.base64, 'base64')], { type: attachment.mimeType });
              const uploaded = await ai.files.upload({ file: blob, config: { mimeType: attachment.mimeType } });
              uploadedFileNames.push(uploaded.name);
              filePart = { fileData: { fileUri: uploaded.uri, mimeType: attachment.mimeType } };
            } else {
              filePart = { inlineData: { data: attachment.base64, mimeType: attachment.mimeType } };
            }
          }

          console.log(`[Assistant] [${req.requestId}] user=${req.userId} attachment source=${source}`);
          const read = withTimeout(ATTACHMENT_READ_TIMEOUT_MS);
          try {
            const response = await ai.models.generateContent({
              model: MODEL_NAME,
              contents: buildAttachmentContents({ filePart, fileName: displayName, question }),
              config: {
                systemInstruction: ATTACHMENT_SYSTEM_PROMPT,
                thinkingConfig: { thinkingBudget: 0 },
                abortSignal: read.signal,
              },
            });
            return normalizeAttachmentText(response.text);
          } finally {
            read.done();
          }
        });
        if (clientGone.signal.aborted) return;
        res.json({ text });
      } catch (error) {
        if (clientGone.signal.aborted) return;
        if (error instanceof AttachmentError) {
          console.warn(`[Assistant] [${req.requestId}] Attachment unavailable: ${error.code}`);
          return res.status(error.status).json({ error: error.message, code: error.code });
        }
        console.error(`[Assistant] [${req.requestId}] Attachment read failed:`, error.message);
        res.status(502).json({ error: 'Attachment read failed', code: 'read_failed' });
      } finally {
        for (const uploaded of uploadedFileNames) {
          ai.files.delete({ name: uploaded }).catch(() => {});
        }
      }
    },
  );

  return router;
};
