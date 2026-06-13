/**
 * Embedding route — generates similarity vectors for the client's
 * Related Memories feature. Used to backfill notes that were enriched before
 * embeddings existed (newly enriched notes get their vector inline in
 * /api/enrich). Batched so a large backfill needs few round-trips.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateRequest } from '../middleware/auth.js';
import { validateEmbedInput } from '../middleware/validation.js';
import { embedTexts, EMBEDDING_MODEL } from '../lib/embedding.js';

export const createEmbedRouter = ({ ai, GEMINI_TIMEOUT_MS = 60_000 }) => {
  const router = Router();

  const embedLimiter = rateLimit({
    windowMs: 60_000,
    max: 30, // 30 batches/min × up to 50 texts = 1500 notes/min
    keyGenerator: (req) => req.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Try again later.' },
  });

  router.post('/', authenticateRequest, validateEmbedInput, embedLimiter, async (req, res) => {
    const { texts } = req.body;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    try {
      const embeddings = await embedTexts(ai, texts, { signal: controller.signal });
      clearTimeout(timeout);
      res.json({ embeddings, model: EMBEDDING_MODEL });
    } catch (err) {
      clearTimeout(timeout);
      console.error(`[Embed] [${req.requestId}] Embedding failed:`, err.message);
      res.status(502).json({ error: 'Embedding generation failed' });
    }
  });

  return router;
};
