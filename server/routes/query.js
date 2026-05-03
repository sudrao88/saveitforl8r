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
      // Track Gemini File API uploads from the client so we can delete them
      // after the request completes (mirrors enrich.js cleanup pattern).
      const uploadedFileNames = [];

      try {
        const { query, memories, history = [], memoriesFileUri, memoriesFileName } = req.body;

        const hasFileRef = Boolean(memoriesFileUri);
        const hasInlineMemories = Array.isArray(memories) && memories.length > 0;

        if (!hasFileRef && !hasInlineMemories) {
          return res.json({
            answer: "I don't have any memories to search through yet. Try adding some memories first!",
            sources: [],
          });
        }

        if (hasFileRef && memoriesFileName) uploadedFileNames.push(memoriesFileName);

        // When memories are inlined, build the [ID]/[CONTENT]/... context here.
        // When a fileUri is supplied, the client built the same string and
        // uploaded it as text/plain — the LLM reads it via the fileData part.
        const context = hasFileRef
          ? null
          : memories
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

        // Builds the parts array for a "user" turn that owns the memory
        // context. When a fileUri is present, the file part precedes the text
        // part so the model encounters memories before the query.
        const buildUserPartsWithMemories = (text) => {
          if (hasFileRef) {
            return [
              { fileData: { fileUri: memoriesFileUri, mimeType: 'text/plain' } },
              { text: `MEMORIES: (see attached file)\n\n${text}` },
            ];
          }
          return [{ text: `MEMORIES:\n${context}\n\n${text}` }];
        };

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
                parts: buildUserPartsWithMemories(`QUERY:\n${sanitizedText}`),
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
            // Append the follow-up query to the last text part of the last user turn.
            // (parts may begin with a fileData part, so locate the text part by type.)
            const lastTextPart = [...lastEntry.parts].reverse().find((p) => typeof p.text === 'string');
            if (lastTextPart) {
              lastTextPart.text += `\n\nFOLLOW-UP QUERY:\n${sanitizedQuery}`;
            } else {
              lastEntry.parts.push({ text: `FOLLOW-UP QUERY:\n${sanitizedQuery}` });
            }
          } else {
            contents.push({
              role: 'user',
              parts: [{ text: `FOLLOW-UP QUERY:\n${sanitizedQuery}` }],
            });
          }
        } else {
          contents.push({
            role: 'user',
            parts: buildUserPartsWithMemories(`QUERY:\n${sanitizedQuery}`),
          });
        }

        console.log(`[Query] [${req.requestId}] user=${req.userId} query="${query?.substring(0, 50)}" memories=${hasFileRef ? 'via-file-uri' : memories.length} history=${normalizedHistory.length}`);

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
      } finally {
        // Clean up Gemini File API uploads (best-effort, mirrors enrich.js).
        for (const name of uploadedFileNames) {
          ai.files.delete({ name }).catch(() => {});
        }
      }
    }
  );

  return router;
};
