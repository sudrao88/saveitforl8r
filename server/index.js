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

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// --- Middleware ---
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:9000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  }
}));

app.use(express.json({ limit: '50mb' }));

// --- Health Check ---
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', model: MODEL_NAME });
});

// --- Enrichment Schema (mirrors client-side schema) ---
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
app.post('/api/enrich', async (req, res) => {
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
    const rawResponse = jsonString;
    jsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();

    const firstBrace = jsonString.indexOf('{');
    const lastBrace = jsonString.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      jsonString = jsonString.substring(firstBrace, lastBrace + 1);
    }

    const parsedData = JSON.parse(jsonString);

    // Inject audit trail
    parsedData.audit = {
      prompt,
      rawResponse
    };

    res.json(parsedData);
  } catch (error) {
    console.error('Enrichment error:', error);
    res.status(500).json({ error: 'Enrichment failed', message: error.message });
  }
});

// --- POST /api/query ---
app.post('/api/query', async (req, res) => {
  try {
    const { query, memories } = req.body;

    if (!query || !memories) {
      return res.status(400).json({ error: 'Missing required fields: query, memories' });
    }

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
    console.error('Query error:', error);
    res.status(500).json({ error: 'Query failed', message: error.message });
  }
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`SaveItForL8r proxy running on port ${PORT}`);
  console.log(`Model: ${MODEL_NAME}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
