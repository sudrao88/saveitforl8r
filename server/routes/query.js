/**
 * Query route — AI-powered memory search/recall.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateRequest } from '../middleware/auth.js';
import { validateQueryInput } from '../middleware/validation.js';
import { sanitizeUserInput, sanitizeString } from '../lib/sanitize.js';
import {
  queryResponseSchema,
  QUERY_SYSTEM_PROMPT,
  normalizeHistory,
} from '../services/gemini.js';

/** Sanitize parsed LLM query response to strip any injected HTML. */
const sanitizeQueryResponse = (parsed) => {
  if (parsed.answer) parsed.answer = sanitizeString(parsed.answer);
  if (Array.isArray(parsed.sources)) {
    parsed.sources = parsed.sources.map((s) =>
      typeof s === 'string' ? sanitizeString(s) : s
    );
  }
  return parsed;
};

const normalizeForAnchor = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// Long enough to be distinctive across a 200-memory corpus, short enough to
// survive minor paraphrasing or truncation by the model.
const ANCHOR_LEN = 40;
const MIN_ANCHOR_LEN = 12;

/**
 * Re-anchor source IDs when the model returns a preview snippet that doesn't
 * appear in the memory it cites. Gemini occasionally swaps IDs between
 * similar-looking entries (e.g. notes saved on the same day), which leaves
 * the client opening the wrong memory when a user taps a source.
 *
 * Strategy: if the preview text isn't a substring of the claimed memory's
 * content/summary but uniquely matches another memory, rewrite the id.
 */
const reanchorSources = (parsed, memories, requestId) => {
  if (!parsed || !Array.isArray(parsed.sources) || !Array.isArray(memories)) {
    return parsed;
  }

  const haystacks = new Map();
  for (const m of memories) {
    if (m && typeof m.id === 'string') {
      haystacks.set(
        m.id,
        normalizeForAnchor(`${m.content || ''} ${m.enrichment?.summary || ''}`)
      );
    }
  }

  parsed.sources = parsed.sources.map((s) => {
    if (!s || typeof s !== 'object') return s;
    const id = typeof s.id === 'string' ? s.id : '';
    const preview = typeof s.preview === 'string' ? s.preview : '';
    if (!preview) return s;

    const anchor = normalizeForAnchor(preview).slice(0, ANCHOR_LEN);
    if (anchor.length < MIN_ANCHOR_LEN) return s;

    const claimed = haystacks.get(id);
    if (claimed && claimed.includes(anchor)) return s;

    let match = null;
    let ambiguous = false;
    for (const [mid, hay] of haystacks) {
      if (hay.includes(anchor)) {
        if (match) {
          ambiguous = true;
          break;
        }
        match = mid;
      }
    }

    if (match && !ambiguous && match !== id) {
      console.warn(
        `[Query] [${requestId}] Re-anchored source ${id} -> ${match} (preview did not match claimed memory)`
      );
      return { ...s, id: match };
    }
    return s;
  });

  return parsed;
};

export const createQueryRouter = ({ ai, MODEL_NAME, FALLBACK_MODEL_NAME, GEMINI_TIMEOUT_MS }) => {
  const router = Router();

  const queryLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    keyGenerator: (req) => req.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Try again later.' },
  });

  router.post(
    '/',
    authenticateRequest,
    validateQueryInput,
    queryLimiter,
    async (req, res) => {
      try {
        const { query, memories, history = [] } = req.body;

        if (!memories || !Array.isArray(memories) || memories.length === 0) {
          return res.json({
            answer: "I don't have any memories to search through yet. Try adding some memories first!",
            sources: [],
          });
        }

        const context = memories
          .map(
            (m) =>
              `[ID: ${sanitizeUserInput(String(m.id))}] [DATE: ${new Date(m.timestamp).toLocaleDateString()}]
[CONTENT]: ${sanitizeUserInput(m.content)}
[SUMMARY]: ${sanitizeUserInput(m.enrichment?.summary || 'N/A')}
[TAGS]: ${sanitizeUserInput((m.tags || []).join(', '))}
[PLACE]: ${sanitizeUserInput(m.enrichment?.locationContext?.name || 'N/A')}
[ENTITY]: ${sanitizeUserInput(m.enrichment?.entityContext?.title || 'N/A')} (${sanitizeUserInput(m.enrichment?.entityContext?.type || '')})
[SUBTITLE]: ${sanitizeUserInput(m.enrichment?.entityContext?.subtitle || 'N/A')}
[DESCRIPTION]: ${sanitizeUserInput(m.enrichment?.entityContext?.description || 'N/A')}
[ATTACHMENTS]: ${sanitizeUserInput((m.attachments || []).map((a) => a.name).join(', '))}
[KEY_POINTS]: ${sanitizeUserInput((m.enrichment?.keyPoints || []).join('; ') || 'N/A')}
[ACTION_ITEMS]: ${sanitizeUserInput((m.enrichment?.actionItems || []).join('; ') || 'N/A')}
[THEMES]: ${sanitizeUserInput((m.enrichment?.themes || []).join(', ') || 'N/A')}`
          )
          .join('\n---\n');

        const normalizedHistory = normalizeHistory(history);
        const contents = [];
        const sanitizedQuery = sanitizeUserInput(query);

        if (normalizedHistory.length > 0) {
          let firstUserHandled = false;
          for (const turn of normalizedHistory) {
            const sanitizedText = sanitizeUserInput(turn.text);
            if (turn.role === 'user' && !firstUserHandled) {
              contents.push({
                role: 'user',
                parts: [{ text: `MEMORIES:\n${context}\n\nQUERY:\n${sanitizedText}` }],
              });
              firstUserHandled = true;
            } else if (turn.role === 'model') {
              contents.push({
                role: 'model',
                parts: [{ text: JSON.stringify({ answer: sanitizedText, sources: [] }) }],
              });
            } else {
              contents.push({
                role: 'user',
                parts: [{ text: `QUERY:\n${sanitizedText}` }],
              });
            }
          }

          const lastEntry = contents[contents.length - 1];
          if (lastEntry && lastEntry.role === 'user') {
            lastEntry.parts[0].text += `\n\nFOLLOW-UP QUERY:\n${sanitizedQuery}`;
          } else {
            contents.push({
              role: 'user',
              parts: [{ text: `FOLLOW-UP QUERY:\n${sanitizedQuery}` }],
            });
          }
        } else {
          contents.push({
            role: 'user',
            parts: [{ text: `MEMORIES:\n${context}\n\nQUERY:\n${sanitizedQuery}` }],
          });
        }

        console.log(`[Query] [${req.requestId}] user=${req.userId} query="${query?.substring(0, 50)}" memories=${memories.length} history=${normalizedHistory.length}`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

        try {
          const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents,
            config: {
              systemInstruction: QUERY_SYSTEM_PROMPT,
              responseMimeType: 'application/json',
              responseSchema: queryResponseSchema,
              thinkingConfig: { thinkingBudget: 0 },
            },
            requestOptions: { signal: controller.signal },
          });
          clearTimeout(timeout);

          const responseText = response.text || '{}';
          console.log(`[Query] [${req.requestId}] Response length: ${responseText.length}`);
          const parsed = sanitizeQueryResponse(JSON.parse(responseText));
          res.json(reanchorSources(parsed, memories, req.requestId));
        } catch (apiError) {
          clearTimeout(timeout);

          // Fallback with alternate model
          console.warn(`[Query] [${req.requestId}] Primary model failed: ${apiError.message}. Trying fallback…`);
          const fbController = new AbortController();
          const fbTimeout = setTimeout(() => fbController.abort(), GEMINI_TIMEOUT_MS);

          try {
            const fbResponse = await ai.models.generateContent({
              model: FALLBACK_MODEL_NAME,
              contents,
              config: {
                systemInstruction: QUERY_SYSTEM_PROMPT,
                responseMimeType: 'application/json',
                responseSchema: queryResponseSchema,
                thinkingConfig: { thinkingBudget: 0 },
              },
              requestOptions: { signal: fbController.signal },
            });
            clearTimeout(fbTimeout);

            const fbText = fbResponse.text || '{}';
            console.log(`[Query] [${req.requestId}] Fallback response length: ${fbText.length}`);
            const fbParsed = sanitizeQueryResponse(JSON.parse(fbText));
            return res.json(reanchorSources(fbParsed, memories, req.requestId));
          } catch (fbError) {
            clearTimeout(fbTimeout);
            throw fbError;
          }
        }
      } catch (error) {
        console.error(`[Query] [${req.requestId}] Failed:`, error.message);
        res.status(500).json({ error: 'Query failed' });
      }
    }
  );

  return router;
};
