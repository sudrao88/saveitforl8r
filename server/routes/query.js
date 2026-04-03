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
import { fetchAllNotes } from '../services/googleDrive.js';

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
        const { query, history = [] } = req.body;

        let memories;
        try {
          memories = await fetchAllNotes(req.accessToken);
        } catch (driveError) {
          console.error(`[Query] [${req.requestId}] Drive fetch failed:`, driveError.message);
          const status = driveError.status === 401 ? 401 : 503;
          return res.status(status).json({ error: 'Failed to fetch notes from Google Drive' });
        }

        if (!memories || memories.length === 0) {
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
          res.json(sanitizeQueryResponse(JSON.parse(responseText)));
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
            return res.json(sanitizeQueryResponse(JSON.parse(fbText)));
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
