/**
 * Enrichment routes — handles memory enrichment submission
 * and result polling endpoints.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateRequest } from '../middleware/auth.js';
import { validateEnrichInput, validateResultsInput } from '../middleware/validation.js';
import { parseJsonResponse } from '../lib/sanitize.js';
import {
  extractUrls,
  buildEnrichmentUserContent,
  buildEnrichmentSystemPrompt,
  buildUrlEnrichmentSystemPrompt,
  buildSmartEnrichmentPrompt,
  selectEnrichmentTools,
  classificationSchema,
  CLASSIFICATION_SYSTEM_PROMPT,
  URL_CLASSIFICATION_SYSTEM_PROMPT,
  sanitizeEnrichmentResult,
} from '../services/gemini.js';

export const createEnrichRouter = ({ ai, db, MODEL_NAME, FALLBACK_MODEL_NAME, GEMINI_TIMEOUT_MS, ENRICHMENT_COLLECTION, ENRICHMENT_TTL_MS, ENRICHMENT_FAILED_TTL_MS }) => {
  const router = Router();

  const persistEnrichmentResult = (memoryId, userId, status, result) => {
    if (!db || !memoryId) return;
    const doc = {
      userId,
      status,
      createdAt: Date.now(),
      expireAt: new Date(Date.now() + (status === 'completed' ? ENRICHMENT_TTL_MS : ENRICHMENT_FAILED_TTL_MS)),
    };
    if (result) doc.result = result;
    db.collection(ENRICHMENT_COLLECTION)
      .doc(memoryId)
      .set(doc)
      .catch((err) => console.error(`[Firestore] Failed to persist result for ${memoryId}:`, err.message));
  };

  const enrichLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    keyGenerator: (req) => req.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Try again later.' },
  });

  const resultsLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    keyGenerator: (req) => req.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Try again later.' },
  });

  // --- POST /api/enrich ---
  router.post(
    '/',
    authenticateRequest,
    validateEnrichInput,
    enrichLimiter,
    async (req, res) => {
      const { text, attachments, location, tags, memoryId } = req.body;

      // Persist "processing" status
      if (db && memoryId) {
        try {
          const existingDoc = await db.collection(ENRICHMENT_COLLECTION).doc(memoryId).get();
          if (existingDoc.exists && existingDoc.data().userId !== req.userId) {
            console.warn(`[Enrich] [${req.requestId}] Ownership mismatch for memoryId=${memoryId}, user=${req.userId}`);
            return res.status(403).json({ error: 'Forbidden' });
          }
          await db.collection(ENRICHMENT_COLLECTION).doc(memoryId).set({
            userId: req.userId,
            status: 'processing',
            createdAt: Date.now(),
            expireAt: new Date(Date.now() + ENRICHMENT_TTL_MS),
          });
        } catch (err) {
          console.error(`[Enrich] [${req.requestId}] Failed to persist processing status:`, err.message);
        }
      }

      // Acknowledge receipt immediately
      res.json({ status: 'accepted' });

      // --- Background enrichment processing ---
      const startTime = Date.now();
      const parts = [];

      if (attachments && Array.isArray(attachments)) {
        for (const att of attachments) {
          if (!att.data) continue;
          const base64Data = att.data.includes(',') ? att.data.split(',')[1] : att.data;
          if (base64Data) {
            parts.push({ inlineData: { data: base64Data, mimeType: att.mimeType } });
          }
        }
      }

      const detectedUrls = extractUrls(text);
      const hasUrls = detectedUrls.length > 0;
      const userContent = buildEnrichmentUserContent(text, tags);
      if (userContent) parts.push({ text: userContent });

      try {
        // --- Phase 1: Classification ---
        let classification = null;

        if (hasUrls) {
          try {
            console.log(`[Classify] [${req.requestId}] Starting URL classification...`);
            const classifyController = new AbortController();
            const classifyTimeout = setTimeout(() => classifyController.abort(), 25_000);
            const classifyResponse = await ai.models.generateContent({
              model: MODEL_NAME,
              contents: [{ role: 'user', parts }],
              config: {
                systemInstruction: URL_CLASSIFICATION_SYSTEM_PROMPT,
                tools: [{ urlContext: {} }, { googleSearch: {} }],
                responseMimeType: 'application/json',
                responseSchema: classificationSchema,
                thinkingConfig: { thinkingBudget: 0 },
              },
              requestOptions: { signal: classifyController.signal },
            });
            clearTimeout(classifyTimeout);
            classification = JSON.parse(classifyResponse.text || '{}');
            console.log(`[Classify] [${req.requestId}] URL type=${classification.contentType} search=${classification.searchRecommendation?.value} (${Date.now() - startTime}ms)`);
          } catch (classifyError) {
            console.error(`[Classify] [${req.requestId}] URL classification failed:`, classifyError.message);
          }
        } else {
          try {
            console.log(`[Classify] [${req.requestId}] Starting classification...`);
            const classifyController = new AbortController();
            const classifyTimeout = setTimeout(() => classifyController.abort(), 15_000);
            const classifyResponse = await ai.models.generateContent({
              model: MODEL_NAME,
              contents: [{ role: 'user', parts }],
              config: {
                systemInstruction: CLASSIFICATION_SYSTEM_PROMPT,
                responseMimeType: 'application/json',
                responseSchema: classificationSchema,
                thinkingConfig: { thinkingBudget: 0 },
              },
              requestOptions: { signal: classifyController.signal },
            });
            clearTimeout(classifyTimeout);
            classification = JSON.parse(classifyResponse.text || '{}');
            console.log(`[Classify] [${req.requestId}] type=${classification.contentType} search=${classification.searchRecommendation?.value} (${Date.now() - startTime}ms)`);
          } catch (classifyError) {
            console.error(`[Classify] [${req.requestId}] Classification failed:`, classifyError.message);
          }
        }

        // --- Phase 2: Enrichment ---
        let systemPrompt;
        let tools;

        if (classification) {
          systemPrompt = buildSmartEnrichmentPrompt(classification, tags, location, text, hasUrls ? detectedUrls : undefined);
          tools = selectEnrichmentTools(classification, hasUrls);
        } else if (hasUrls) {
          systemPrompt = buildUrlEnrichmentSystemPrompt(tags, location, detectedUrls);
          tools = [{ urlContext: {} }, { googleSearch: {} }];
        } else {
          systemPrompt = buildEnrichmentSystemPrompt(tags, location, text);
          tools = [{ googleSearch: {} }];
        }

        const enrichmentStrategy = hasUrls ? 'url'
          : (classification && classification.searchRecommendation?.value !== 'high' && classification.searchRecommendation?.value !== 'medium') ? 'summarize' : 'search';

        console.log(`[Enrich] [${req.requestId}] user=${req.userId} strategy=${enrichmentStrategy} text="${text?.substring(0, 50)}" urls=${detectedUrls.length}`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

        try {
          const config = { systemInstruction: systemPrompt, thinkingConfig: { thinkingBudget: 0 } };
          if (tools.length > 0) config.tools = tools;

          const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts }],
            config,
            requestOptions: { signal: controller.signal },
          });
          clearTimeout(timeout);

          const responseText = response.text || '{}';
          console.log(`[Enrich] [${req.requestId}] Completed in ${Date.now() - startTime}ms. Response length: ${responseText.length}`);

          const parsed = parseJsonResponse(responseText);
          if (classification) parsed.contentType = classification.contentType;
          parsed.enrichmentStrategy = enrichmentStrategy;

          const sanitized = sanitizeEnrichmentResult(parsed);
          persistEnrichmentResult(memoryId, req.userId, 'completed', sanitized);
        } catch (primaryError) {
          clearTimeout(timeout);
          throw primaryError;
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`[Enrich] [${req.requestId}] Primary failed after ${duration}ms:`, error.message);

        // Fallback with stable model
        try {
          const fallbackController = new AbortController();
          const fallbackTimeout = setTimeout(() => fallbackController.abort(), GEMINI_TIMEOUT_MS);
          const fallbackSystemPrompt = hasUrls
            ? buildUrlEnrichmentSystemPrompt(tags, location, detectedUrls)
            : buildEnrichmentSystemPrompt(tags, location, text);
          const fallbackConfig = { systemInstruction: fallbackSystemPrompt, thinkingConfig: { thinkingBudget: 0 } };
          if (hasUrls) fallbackConfig.tools = [{ urlContext: {} }, { googleSearch: {} }];

          const response = await ai.models.generateContent({
            model: FALLBACK_MODEL_NAME,
            contents: [{ role: 'user', parts }],
            config: fallbackConfig,
            requestOptions: { signal: fallbackController.signal },
          });
          clearTimeout(fallbackTimeout);

          const parsed = parseJsonResponse(response.text || '{}');
          parsed.enrichmentStrategy = 'search';
          const sanitizedFallback = sanitizeEnrichmentResult(parsed);
          persistEnrichmentResult(memoryId, req.userId, 'completed', sanitizedFallback);
        } catch (fallbackError) {
          console.error(`[Enrich] [${req.requestId}] Fallback also failed:`, fallbackError.message);
          persistEnrichmentResult(memoryId, req.userId, 'failed', null);
        }
      }
    }
  );

  // --- POST /api/enrich/results ---
  router.post(
    '/results',
    authenticateRequest,
    validateResultsInput,
    resultsLimiter,
    async (req, res) => {
      const { memoryIds } = req.body;

      if (!db) return res.status(503).json({ error: 'Result recovery unavailable' });

      try {
        console.log(`[Results] [${req.requestId}] user=${req.userId} memoryIds=${memoryIds.length}`);
        const docRefs = memoryIds.map((id) => db.collection(ENRICHMENT_COLLECTION).doc(id));
        const snapshots = await db.getAll(...docRefs);

        const results = {};
        for (let i = 0; i < memoryIds.length; i++) {
          const snap = snapshots[i];
          if (!snap.exists) { results[memoryIds[i]] = { status: 'not_found' }; continue; }

          const data = snap.data();
          if (data.userId !== req.userId) { results[memoryIds[i]] = { status: 'not_found' }; continue; }

          if (data.status === 'completed' && data.result) {
            results[memoryIds[i]] = { status: 'completed', data: data.result };
          } else if (data.status === 'failed') {
            results[memoryIds[i]] = { status: 'failed' };
          } else {
            results[memoryIds[i]] = { status: data.status || 'unknown' };
          }
        }

        res.json({ results });
      } catch (error) {
        console.error(`[Results] [${req.requestId}] Failed:`, error.message);
        res.status(500).json({ error: 'Failed to fetch enrichment results' });
      }
    }
  );

  return router;
};
