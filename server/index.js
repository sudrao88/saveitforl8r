import express from 'express';
import cors from 'cors';
import { GoogleGenAI, Type } from '@google/genai';

const app = express();
const PORT = process.env.PORT || 8081;

// --- Configuration ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('FATAL: GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Google OAuth token info endpoint for validating client tokens
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// =========================================================================
// SECURITY MIDDLEWARE
// =========================================================================

// --- CORS: strict origin checking, no wildcard in production ---
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:9000'];

app.use(cors({
  origin: (origin, callback) => {
    // SECURITY: Reject requests with no Origin header.
    // Mobile native apps send the configured origin via the client.
    // Allowing no-origin would let curl/bots bypass CORS entirely.
    if (!origin) {
      return callback(new Error('Missing Origin header'));
    }
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  }
}));

// --- Body size limit: 10MB is generous for enrichment payloads ---
app.use(express.json({ limit: '10mb' }));

// --- Request ID for log correlation ---
app.use((req, _res, next) => {
  req.requestId = crypto.randomUUID();
  next();
});

// =========================================================================
// AUTHENTICATION: Validate Google OAuth access token
// =========================================================================
// The client already has a Google OAuth token (for Drive sync).
// We require it on every proxy request to:
//   1. Verify the caller is a real, authenticated user
//   2. Extract a stable account identifier for future rate limiting
//   3. Prevent anonymous abuse of the Gemini API key
//
// The token is validated against Google's tokeninfo endpoint.
// In production, consider caching validated tokens briefly (e.g. 60s)
// to reduce latency on every request.

const authenticateRequest = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const accessToken = authHeader.slice(7);
  if (!accessToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const response = await fetch(`${GOOGLE_TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`);
    if (!response.ok) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const tokenInfo = await response.json();

    // Verify the token was issued for our app's client ID
    const expectedClientId = process.env.GOOGLE_CLIENT_ID;
    if (expectedClientId && tokenInfo.aud !== expectedClientId) {
      console.warn(`[Auth] Token audience mismatch: expected ${expectedClientId}, got ${tokenInfo.aud}`);
      return res.status(403).json({ error: 'Token not issued for this application' });
    }

    // Attach user info for logging and future rate limiting
    req.userId = tokenInfo.sub || tokenInfo.email || 'unknown';
    next();
  } catch (err) {
    console.error(`[Auth] Token validation failed:`, err.message);
    return res.status(401).json({ error: 'Token validation failed' });
  }
};

// =========================================================================
// RATE LIMITING: basic in-memory per-user sliding window
// =========================================================================
// This is a v1 in-memory limiter. For production at scale, replace with
// Redis-backed rate limiting (e.g. express-rate-limit + rate-limit-redis).

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX || '30', 10);

const rateLimitMap = new Map(); // userId -> { timestamps: number[] }

const rateLimiter = (req, res, next) => {
  const userId = req.userId || 'anonymous';
  const now = Date.now();

  let entry = rateLimitMap.get(userId);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitMap.set(userId, entry);
  }

  // Evict timestamps outside the window
  entry.timestamps = entry.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);

  if (entry.timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    console.warn(`[RateLimit] User ${userId} exceeded ${RATE_LIMIT_MAX_REQUESTS} req/min`);
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  entry.timestamps.push(now);
  next();
};

// Periodic cleanup of stale rate limit entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of rateLimitMap) {
    entry.timestamps = entry.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (entry.timestamps.length === 0) {
      rateLimitMap.delete(userId);
    }
  }
}, 5 * 60 * 1000);

// =========================================================================
// INPUT VALIDATION
// =========================================================================

const MAX_TEXT_LENGTH = 50_000;        // 50K chars
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE = 5_000_000; // ~5MB base64
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 100;
const MAX_MEMORIES_IN_QUERY = 500;
const MAX_QUERY_LENGTH = 2_000;

const validateEnrichInput = (req, res, next) => {
  const { text, attachments, location, tags } = req.body;

  if (text !== undefined && text !== null) {
    if (typeof text !== 'string') {
      return res.status(400).json({ error: 'text must be a string' });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: `text exceeds maximum length of ${MAX_TEXT_LENGTH}` });
    }
  }

  if (attachments !== undefined && attachments !== null) {
    if (!Array.isArray(attachments)) {
      return res.status(400).json({ error: 'attachments must be an array' });
    }
    if (attachments.length > MAX_ATTACHMENTS) {
      return res.status(400).json({ error: `Maximum ${MAX_ATTACHMENTS} attachments allowed` });
    }
    for (const att of attachments) {
      if (att.data && typeof att.data === 'string' && att.data.length > MAX_ATTACHMENT_SIZE) {
        return res.status(400).json({ error: `Attachment exceeds maximum size` });
      }
    }
  }

  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: 'tags must be an array' });
    }
    if (tags.length > MAX_TAGS) {
      return res.status(400).json({ error: `Maximum ${MAX_TAGS} tags allowed` });
    }
    for (const tag of tags) {
      if (typeof tag !== 'string' || tag.length > MAX_TAG_LENGTH) {
        return res.status(400).json({ error: 'Invalid tag' });
      }
    }
  }

  if (location !== undefined && location !== null) {
    if (typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
      return res.status(400).json({ error: 'location must have numeric latitude and longitude' });
    }
    if (location.latitude < -90 || location.latitude > 90 || location.longitude < -180 || location.longitude > 180) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }
  }

  next();
};

const validateQueryInput = (req, res, next) => {
  const { query, memories } = req.body;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required and must be a string' });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({ error: `query exceeds maximum length of ${MAX_QUERY_LENGTH}` });
  }

  if (!memories || !Array.isArray(memories)) {
    return res.status(400).json({ error: 'memories is required and must be an array' });
  }
  if (memories.length > MAX_MEMORIES_IN_QUERY) {
    return res.status(400).json({ error: `Maximum ${MAX_MEMORIES_IN_QUERY} memories allowed per query` });
  }

  next();
};

// =========================================================================
// SAFE ERROR RESPONSE
// =========================================================================
// SECURITY: Never return raw error.message to the client.
// Gemini SDK errors can contain the API key, internal URLs, or request IDs
// that help attackers.

const safeErrorResponse = (res, statusCode, publicMessage, internalError) => {
  // Log full error server-side for debugging
  console.error(`[Error] ${publicMessage}:`, internalError?.message || internalError);
  // Return only a generic message to the client
  res.status(statusCode).json({ error: publicMessage });
};

// =========================================================================
// ROUTES
// =========================================================================

// --- Health Check (unauthenticated, but no sensitive info) ---
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// --- Enrichment Schema ---
const enrichmentSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING, description: 'A concise summary of the input.' },
    visualDescription: { type: Type.STRING, description: 'Description of the attached images or documents content, if provided.' },
    locationIsRelevant: { type: Type.BOOLEAN, description: 'Whether the input refers to a specific place or relevant location.' },
    locationContext: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "The specific name of the place (e.g. 'Starbucks', 'Eiffel Tower', 'Central Park')." },
        address: { type: Type.STRING },
        website: { type: Type.STRING },
        operatingHours: { type: Type.STRING },
        latitude: { type: Type.NUMBER },
        longitude: { type: Type.NUMBER },
        mapsUri: { type: Type.STRING, description: 'Direct Google Maps URL for the specific place found.' }
      }
    },
    entityContext: {
      type: Type.OBJECT,
      description: 'Details if the input is a Movie, Book, TV Show, Product, etc.',
      properties: {
        type: { type: Type.STRING, description: "e.g. 'Movie', 'Book', 'TV Show', 'Product', 'Place'" },
        title: { type: Type.STRING },
        subtitle: { type: Type.STRING, description: 'Author for books, Director/Year for movies.' },
        description: { type: Type.STRING, description: 'A brief synopsis, plot summary, or product description.' },
        rating: { type: Type.STRING, description: "Critic or user rating if available (e.g. '4.5/5', 'IMDb 8.2')." }
      }
    },
    suggestedTags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '3-5 suggested short tags.'
    }
  },
  required: ['summary', 'suggestedTags', 'locationIsRelevant']
};

// --- POST /api/enrich ---
app.post('/api/enrich', authenticateRequest, rateLimiter, validateEnrichInput, async (req, res) => {
  try {
    const { text, attachments, location, tags } = req.body;

    const parts = [];

    // Add attachments (images, PDFs, text files)
    if (attachments && Array.isArray(attachments)) {
      for (const att of attachments) {
        const base64Data = att.data?.split(',')[1];
        if (base64Data) {
          parts.push({
            inlineData: {
              data: base64Data,
              mimeType: att.mimeType
            }
          });
        }
      }
    }

    let prompt = `Analyze this Second Brain entry.
  TASK: Use Google Search to enrich the content using the INPUT TEXT, USER TAGS, and attached DOCUMENTS/IMAGES.

  SEARCH STRATEGY:
  1. Combine the INPUT TEXT and USER TAGS to form your search queries. The tags provide essential context (e.g., "Movie", "Book", "Restaurant") that disambiguates the text.
  2. If the INPUT TEXT is short or ambiguous, rely on the TAGS to determine the entity type.`;

    if (tags && tags.length > 0) {
      prompt += `\nUSER TAGS: ${tags.join(', ')}`;
    }

    if (location) {
      prompt += `
    USER CURRENT GPS: Lat ${location.latitude}, Lng ${location.longitude}.

    LOCATION & SEARCH RULES:
    1. INPUT IS KEY: The INPUT TEXT is the primary search term.
    2. USE GPS CONTEXT: When searching, explicitly include the GPS coordinates in your search query to prioritize results near the user.
       - Query format: "${text} near ${location.latitude}, ${location.longitude}"
    3. PLACE IDENTIFICATION:
       - If the search result confirms the INPUT TEXT is a specific place/business at this location, set 'locationIsRelevant' to TRUE.
       - You MUST populate 'locationContext.mapsUri' with the specific Google Maps link found in the search result.
       - Populate 'locationContext.name' and 'locationContext.address'.
    4. NO GENERIC REVERSE GEOCODING:
       - Do NOT return the address of the coordinates if the INPUT TEXT does not match the place.
       - If the user types "Idea", do not return "Starbucks" just because they are there.
       - If 'locationIsRelevant' is false, leave 'locationContext' empty.
    `;
    }

    prompt += `
    RULES FOR LINKS:
    1. DO NOT generate generic external links (e.g. no IMDB, no Amazon, no Official Website links).
    2. LOCATION/BUSINESS: 'locationContext.mapsUri' MUST be the Google Maps link found in the search result.

    ENTITY SPECIFIC INSTRUCTIONS:
    1. MOVIE/TV: Identify Title, Director/Year, and Description.
    2. BOOK: Identify Title, Author, and Description.
    3. LOCATION/BUSINESS: Populate locationContext fully, especially mapsUri.

    OUTPUT FORMAT:
    You must return a raw JSON object (no markdown) matching this schema:
    ${JSON.stringify(enrichmentSchema, null, 2)}
  `;

    if (text) prompt += `\nINPUT TEXT: "${text}"`;

    parts.push({ text: prompt });

    const config = {
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingBudget: 0 }
    };

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { parts },
      config
    });

    let jsonString = response.text || '{}';
    jsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();

    const firstBrace = jsonString.indexOf('{');
    const lastBrace = jsonString.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      jsonString = jsonString.substring(firstBrace, lastBrace + 1);
    }

    const parsedData = JSON.parse(jsonString);

    // SECURITY: Do NOT include the audit trail (prompt + rawResponse) in the
    // client response. The prompt contains system instructions, and the raw
    // response could contain error details. Keep audit server-side only.

    res.json(parsedData);
  } catch (error) {
    safeErrorResponse(res, 500, 'Enrichment failed', error);
  }
});

// --- POST /api/query ---
app.post('/api/query', authenticateRequest, rateLimiter, validateQueryInput, async (req, res) => {
  try {
    const { query, memories } = req.body;

    const contextBlock = memories
      .filter(m => !m.isPending && !m.processingError)
      .map(m => `
    [ID: ${m.id}] [DATE: ${new Date(m.timestamp).toLocaleDateString()}]
    [CONTENT]: ${m.content}
    [SUMMARY]: ${m.enrichment?.summary || ''}
    [VISUAL DESCRIPTION]: ${m.enrichment?.visualDescription || 'N/A'}
    [TAGS]: ${(m.tags || []).concat(m.enrichment?.suggestedTags || []).join(', ')}
    [PLACE]: ${m.enrichment?.locationContext?.name || 'N/A'}
    [ENTITY]: ${m.enrichment?.entityContext?.title || 'N/A'} (${m.enrichment?.entityContext?.type || ''})
    [SUBTITLE]: ${m.enrichment?.entityContext?.subtitle || 'N/A'}
    [DESCRIPTION]: ${m.enrichment?.entityContext?.description || 'N/A'}
    [ATTACHMENTS]: ${(m.attachments || []).map(a => a.name).join(', ')}
  `).join('\n---\n');

    const systemInstruction = `
    You are SaveItForL8r. Answer based ONLY on context.
    Format: Conversational.
    End with: [[SOURCE_IDS: id1, id2]].
  `;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `CONTEXT:\n${contextBlock}\nQUERY: "${query}"`,
      config: {
        systemInstruction,
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 0 }
      }
    });

    const text = response.text || '';
    const match = text.match(/\[\[SOURCE_IDS: (.+?)\]\]/);
    let sourceIds = [];
    if (match) sourceIds = match[1].split(',').map(s => s.trim());

    res.json({
      answer: text.replace(/\[\[SOURCE_IDS: .+?\]\]/, '').trim(),
      sourceIds
    });
  } catch (error) {
    safeErrorResponse(res, 500, 'Query failed', error);
  }
});

// =========================================================================
// GLOBAL ERROR HANDLER
// =========================================================================
// Catch-all to prevent any unhandled error from leaking stack traces or
// internal details to the client.
app.use((err, _req, res, _next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`SaveItForL8r proxy running on port ${PORT}`);
});
