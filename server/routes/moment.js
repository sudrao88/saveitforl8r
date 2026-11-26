/**
 * Moment routes — embed a new moment's terms, and split a moment's notes into
 * named sections.
 *
 * Moments are matched to notes entirely on the client: each note already
 * carries a synced similarity vector, and the moment carries an intent vector
 * (the terms read together, expanded into a note-shaped description) plus one
 * vector per term, and the keyword concepts a note must match. This endpoint is only called when a moment is created (or
 * re-embedded after a matching upgrade) to produce those vectors (same model
 * as notes) and pick an emoji from the emoji dictionary. Nothing is persisted
 * server-side.
 *
 * /sections is called when a moment is opened and has no sections yet, or has
 * gathered notes that fit none of them. It receives a short card per note and
 * returns sections of note ids; the client stores them on the moment.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateRequest } from '../middleware/auth.js';
import { validateMomentEmbedInput, validateMomentSectionsInput } from '../middleware/validation.js';
import { EMBEDDING_MODEL } from '../lib/embedding.js';
import { embedMomentTerms } from '../lib/momentEmbedding.js';
import { generateMomentSections } from '../lib/momentSections.js';

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

  // POST /api/moment/embed { terms: string[] } → { vectors, intentVector, concepts, emoji, model }
  router.post('/embed', authenticateRequest, validateMomentEmbedInput, momentLimiter, async (req, res) => {
    const terms = req.body.terms.map((t) => t.trim());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    req.on('close', () => controller.abort());

    try {
      const { vectors, intentVector, concepts, emoji, intentSource } = await embedMomentTerms(ai, terms, {
        signal: controller.signal,
        model: MODEL_NAME,
        fallbackModel: FALLBACK_MODEL_NAME,
      });
      clearTimeout(timeout);
      console.log(
        `[MomentEmbed] [${req.requestId}] Embedded ${terms.length} term(s), intent from ${intentSource}, ` +
          `${concepts.length} concept(s)`,
      );
      res.json({ vectors, intentVector, concepts, emoji, model: EMBEDDING_MODEL });
    } catch (err) {
      clearTimeout(timeout);
      console.error(`[MomentEmbed] [${req.requestId}] Embedding failed:`, err.message);
      res.status(502).json({ error: 'Moment embedding failed' });
    }
  });

  const sectionsLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    keyGenerator: (req) => req.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Try again later.' },
  });

  // POST /api/moment/sections { title, notes: [{ id, title, summary?, type?, tags? }], existing?: [{ id, label, description? }] }
  //   → { sections: [{ id?, label, description, noteIds }] }
  // Synchronous: the model gets one 30 second budget, well inside the 60
  // second hosting limit.
  router.post('/sections', authenticateRequest, validateMomentSectionsInput, sectionsLimiter, async (req, res) => {
    const { title, notes, existing = [] } = req.body;

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      const { sections } = await generateMomentSections(ai, { title, notes, existing }, {
        signal: controller.signal,
        model: MODEL_NAME,
        fallbackModel: FALLBACK_MODEL_NAME,
      });
      console.log(
        `[MomentSections] [${req.requestId}] ${notes.length} note(s), ${existing.length} existing → ` +
          `${sections.length} section(s)`,
      );
      res.json({ sections });
    } catch (err) {
      console.error(`[MomentSections] [${req.requestId}] Sectioning failed:`, err.message);
      res.status(502).json({ error: 'Moment sectioning failed' });
    }
  });

  return router;
};
