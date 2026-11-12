/**
 * Moment route — embeds a new moment's terms.
 *
 * Moments are matched to notes entirely on the client: each note already
 * carries a synced similarity vector, and the moment carries an intent vector
 * (the terms read together, expanded into a note-shaped description) plus one
 * vector per term. This endpoint is only called when a moment is created (or
 * re-embedded after a matching upgrade) to produce those vectors (same model
 * as notes) and pick an emoji from the emoji dictionary. Nothing is persisted
 * server-side.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateRequest } from '../middleware/auth.js';
import { validateMomentEmbedInput } from '../middleware/validation.js';
import { EMBEDDING_MODEL } from '../lib/embedding.js';
import { embedMomentTerms } from '../lib/momentEmbedding.js';

export const createMomentRouter = ({ ai, MODEL_NAME, FALLBACK_MODEL_NAME, GEMINI_TIMEOUT_MS = 60_000 }) => {
  const router = Router();

  const momentLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    keyGenerator: (req) => req.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Try again later.' },
  });

  // POST /api/moment/embed { terms: string[] } → { vectors, intentVector, emoji, model }
  router.post('/embed', authenticateRequest, validateMomentEmbedInput, momentLimiter, async (req, res) => {
    const terms = req.body.terms.map((t) => t.trim());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    req.on('close', () => controller.abort());

    try {
      const { vectors, intentVector, emoji, intentSource } = await embedMomentTerms(ai, terms, {
        signal: controller.signal,
        model: MODEL_NAME,
        fallbackModel: FALLBACK_MODEL_NAME,
      });
      clearTimeout(timeout);
      console.log(`[MomentEmbed] [${req.requestId}] Embedded ${terms.length} term(s), intent from ${intentSource}`);
      res.json({ vectors, intentVector, emoji, model: EMBEDDING_MODEL });
    } catch (err) {
      clearTimeout(timeout);
      console.error(`[MomentEmbed] [${req.requestId}] Embedding failed:`, err.message);
      res.status(502).json({ error: 'Moment embedding failed' });
    }
  });

  return router;
};
