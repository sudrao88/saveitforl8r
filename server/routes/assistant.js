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
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateRequest } from '../middleware/auth.js';
import { validateAssistantStepInput } from '../middleware/validation.js';
import { parseJsonResponse } from '../lib/sanitize.js';
import { embedTexts } from '../lib/embedding.js';
import {
  ASSISTANT_SYSTEM_PROMPT,
  assistantStepSchema,
  buildAssistantContents,
  normalizeAssistantStep,
} from '../lib/assistant.js';

// Primary + fallback + query embedding must fit inside the 60s hosting limit.
const PRIMARY_TIMEOUT_MS = 28_000;
const FALLBACK_TIMEOUT_MS = 18_000;
const EMBED_TIMEOUT_MS = 6_000;

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

  return router;
};
