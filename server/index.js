import express from 'express';
import cors from 'cors';
import { GoogleGenAI, Type } from '@google/genai';

const app = express();
const PORT = process.env.PORT || 8081;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('FATAL: GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const MODEL_NAME = 'gemini-3-flash-preview';
const FALLBACK_MODEL_NAME = 'gemini-2.0-flash';
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --- Authentication middleware ---

const authenticateRequest = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Auth required' });
  }
  const accessToken = authHeader.slice(7);
  try {
    const response = await fetch(
      `${GOOGLE_TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Token validation failed:', errorText);
      return res.status(401).json({ error: 'Invalid token' });
    }
    const tokenInfo = await response.json();
    const expectedClientId =
      process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
    if (expectedClientId && tokenInfo.aud !== expectedClientId) {
      console.error(
        'Audience mismatch. Expected:',
        expectedClientId,
        'Got:',
        tokenInfo.aud
      );
      return res.status(403).json({ error: 'Audience mismatch' });
    }
    req.userId = tokenInfo.sub || tokenInfo.email || 'unknown';
    next();
  } catch (err) {
    console.error('Auth check error:', err);
    return res.status(401).json({ error: 'Auth failed' });
  }
};

// --- Schemas (used in prompt text for enrichment, structured output for query) ---

const enrichmentSchema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: 'A concise summary of the input.',
    },
    visualDescription: {
      type: Type.STRING,
      description:
        'Description of the attached images or documents content, if provided.',
    },
    locationIsRelevant: {
      type: Type.BOOLEAN,
      description:
        'Whether the input refers to a specific place or relevant location.',
    },
    locationContext: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description:
            "The specific name of the place (e.g. 'Starbucks', 'Eiffel Tower', 'Central Park').",
        },
        address: { type: Type.STRING },
        website: { type: Type.STRING },
        operatingHours: { type: Type.STRING },
        latitude: { type: Type.NUMBER },
        longitude: { type: Type.NUMBER },
        mapsUri: {
          type: Type.STRING,
          description: 'Direct Google Maps URL for the specific place found.',
        },
      },
    },
    entityContext: {
      type: Type.OBJECT,
      description:
        'Details if the input is a Movie, Book, TV Show, Product, etc.',
      properties: {
        type: {
          type: Type.STRING,
          description:
            "e.g. 'Movie', 'Book', 'TV Show', 'Product', 'Place'",
        },
        title: { type: Type.STRING },
        subtitle: {
          type: Type.STRING,
          description: 'Author for books, Director/Year for movies.',
        },
        description: {
          type: Type.STRING,
          description:
            'A brief synopsis, plot summary, or product description.',
        },
        rating: {
          type: Type.STRING,
          description:
            "Critic or user rating if available (e.g. '4.5/5', 'IMDb 8.2').",
        },
      },
    },
    suggestedTags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '3-5 suggested short tags.',
    },
  },
  required: ['summary', 'suggestedTags', 'locationIsRelevant'],
};

const queryResponseSchema = {
  type: Type.OBJECT,
  properties: {
    answer: {
      type: Type.STRING,
      description:
        "A natural language answer based ONLY on the provided memories. If the answer isn't in the memories, state that you don't know.",
    },
    sources: {
      type: Type.ARRAY,
      description: 'The specific memories used to form this answer.',
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.STRING,
            description: 'The unique ID of the memory.',
          },
          preview: {
            type: Type.STRING,
            description:
              'A short snippet (1-2 sentences) from the memory content that is relevant to the answer.',
          },
        },
        required: ['id', 'preview'],
      },
    },
  },
  required: ['answer', 'sources'],
};

// --- Build the full enrichment prompt (ported from original geminiService.ts) ---

const buildEnrichmentPrompt = (text, tags, location) => {
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

  return prompt;
};

// --- Parse JSON from model text response (handles markdown fences) ---

const parseJsonResponse = (raw) => {
  let jsonString = raw || '{}';
  jsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
  const firstBrace = jsonString.indexOf('{');
  const lastBrace = jsonString.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    jsonString = jsonString.substring(firstBrace, lastBrace + 1);
  }
  return JSON.parse(jsonString);
};

// --- Health check ---

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// --- Enrichment endpoint ---

app.post('/api/enrich', authenticateRequest, async (req, res) => {
  const startTime = Date.now();
  const { text, attachments, location, tags } = req.body;

  // Build parts array (attachments first, then prompt text)
  const parts = [];

  if (attachments && Array.isArray(attachments)) {
    for (const att of attachments) {
      if (!att.data) continue;
      const base64Data = att.data.includes(',')
        ? att.data.split(',')[1]
        : att.data;
      if (base64Data) {
        parts.push({
          inlineData: { data: base64Data, mimeType: att.mimeType },
        });
      }
    }
  }

  const prompt = buildEnrichmentPrompt(text, tags, location);
  parts.push({ text: prompt });

  try {
    console.log(
      `[Enrich] Start for user ${req.userId}. Text: "${text?.substring(0, 50)}"`
    );

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { parts },
      config: {
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const responseText = response.text || '{}';
    const duration = Date.now() - startTime;
    console.log(
      `[Enrich] API responded in ${duration}ms. Raw response length: ${responseText.length}`
    );

    const parsed = parseJsonResponse(responseText);
    res.json(parsed);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(
      `[Enrich] Main enrichment failed after ${duration}ms. Error:`,
      error.message
    );

    // Fallback: retry with a stable model, without Google Search, but keep attachments + full prompt
    const fallbackStartTime = Date.now();
    console.log(
      '[Enrich] Attempting fallback enrichment without Google Search...'
    );
    try {
      const response = await ai.models.generateContent({
        model: FALLBACK_MODEL_NAME,
        contents: { parts },
        config: {
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      const fallbackText = response.text || '{}';
      console.log(
        `[Enrich] Fallback succeeded in ${Date.now() - fallbackStartTime}ms`
      );
      res.json(parseJsonResponse(fallbackText));
    } catch (fallbackError) {
      console.error('[Enrich] Fallback failed:', fallbackError.message);
      res
        .status(500)
        .json({ error: 'Enrichment failed', details: error.message });
    }
  }
});

// --- Query endpoint ---

app.post('/api/query', authenticateRequest, async (req, res) => {
  try {
    const { query, memories } = req.body;

    if (!memories || !Array.isArray(memories) || memories.length === 0) {
      return res.json({
        answer:
          "I don't have any notes to search through yet. Try adding some memories first!",
        sources: [],
      });
    }

    // Build rich context from memories (including enrichment data)
    const context = memories
      .map(
        (m) => `[ID: ${m.id}] [DATE: ${new Date(m.timestamp).toLocaleDateString()}]
[CONTENT]: ${m.content}
[SUMMARY]: ${m.enrichment?.summary || 'N/A'}
[TAGS]: ${(m.tags || []).join(', ')}
[PLACE]: ${m.enrichment?.locationContext?.name || 'N/A'}
[ENTITY]: ${m.enrichment?.entityContext?.title || 'N/A'} (${m.enrichment?.entityContext?.type || ''})
[SUBTITLE]: ${m.enrichment?.entityContext?.subtitle || 'N/A'}
[DESCRIPTION]: ${m.enrichment?.entityContext?.description || 'N/A'}
[ATTACHMENTS]: ${(m.attachments || []).map((a) => a.name).join(', ')}`
      )
      .join('\n---\n');

    const prompt = `You are a helpful assistant for a personal "second brain" app.
Your task is to answer the user's query using ONLY the provided memories below.

RULES:
1. STRICTNESS: Answer ONLY based on the provided memories. Do NOT use outside knowledge.
2. HONESTY: If the answer is not contained in the memories, clearly state that you don't know based on the available notes.
3. SOURCES: For every part of your answer, identify which memory (by ID) it came from.
4. FORMAT: Return your response as JSON matching the specified schema.

MEMORIES:
${context}

QUERY: ${query}`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: queryResponseSchema,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const responseText = response.text || '{}';
    console.log(
      `[Query] User ${req.userId} query: "${query}". Response length: ${responseText.length}`
    );

    res.json(JSON.parse(responseText));
  } catch (error) {
    console.error('Query failed:', error.message);
    res.status(500).json({ error: 'Query failed', details: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Proxy on ${PORT}`));
