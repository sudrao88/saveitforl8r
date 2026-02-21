import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI, SchemaType, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

const app = express();
const PORT = process.env.PORT || 8081;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('FATAL: GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const MODEL_NAME = 'gemini-3-flash-preview';
// Using a confirmed stable model name for fallback
const FALLBACK_MODEL_NAME = 'gemini-1.5-flash'; 
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

app.use(cors()); 
app.use(express.json({ limit: '10mb' }));

const authenticateRequest = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Auth required' });
  const accessToken = authHeader.slice(7);
  try {
    const response = await fetch(`${GOOGLE_TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Token validation failed:', errorText);
      return res.status(401).json({ error: 'Invalid token' });
    }
    const tokenInfo = await response.json();
    const expectedClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
    if (expectedClientId && tokenInfo.aud !== expectedClientId) {
      console.error('Audience mismatch. Expected:', expectedClientId, 'Got:', tokenInfo.aud);
      return res.status(403).json({ error: 'Audience mismatch' });
    }
    req.userId = tokenInfo.sub || tokenInfo.email || 'unknown';
    next();
  } catch (err) {
    console.error('Auth check error:', err);
    return res.status(401).json({ error: 'Auth failed' });
  }
};

const enrichmentSchema = {
  type: SchemaType.OBJECT,
  properties: {
    summary: { type: SchemaType.STRING, description: "A concise summary of the input." },
    visualDescription: { type: SchemaType.STRING, description: "Description of the attached images or documents content, if provided." },
    locationIsRelevant: { type: SchemaType.BOOLEAN, description: "Whether the input refers to a specific place or relevant location." },
    locationContext: {
      type: SchemaType.OBJECT,
      properties: {
        name: { type: SchemaType.STRING, description: "The specific name of the place (e.g. 'Starbucks', 'Eiffel Tower', 'Central Park')." },
        address: { type: SchemaType.STRING },
        website: { type: SchemaType.STRING },
        operatingHours: { type: SchemaType.STRING },
        latitude: { type: SchemaType.NUMBER },
        longitude: { type: SchemaType.NUMBER },
        mapsUri: { type: SchemaType.STRING, description: "Direct Google Maps URL for the specific place found." }
      }
    },
    entityContext: {
      type: SchemaType.OBJECT,
      description: "Details if the input is a Movie, Book, TV Show, Product, etc.",
      properties: {
        type: { type: SchemaType.STRING, description: "e.g. 'Movie', 'Book', 'TV Show', 'Product', 'Place'" },
        title: { type: SchemaType.STRING },
        subtitle: { type: SchemaType.STRING, description: "Author for books, Director/Year for movies." },
        description: { type: SchemaType.STRING, description: "A brief synopsis, plot summary, or product description." },
        rating: { type: SchemaType.STRING, description: "Critic or user rating if available (e.g. '4.5/5', 'IMDb 8.2')." }
      }
    },
    suggestedTags: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "3-5 suggested short tags."
    }
  },
  required: ["summary", "suggestedTags", "locationIsRelevant"]
};

const queryResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    answer: { 
      type: SchemaType.STRING, 
      description: "A natural language answer based ONLY on the provided memories. If the answer isn't in the memories, state that you don't know." 
    },
    sources: {
      type: SchemaType.ARRAY,
      description: "The specific memories used to form this answer.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          id: { type: SchemaType.STRING, description: "The unique ID of the memory." },
          preview: { type: SchemaType.STRING, description: "A short snippet (1-2 sentences) from the memory content that relevant to the answer." }
        },
        required: ["id", "preview"]
      }
    }
  },
  required: ["answer", "sources"]
};

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/enrich', authenticateRequest, async (req, res) => {
  const startTime = Date.now();
  const { text, attachments, location, tags } = req.body;

  try {
    console.log(`[Enrich] Start for user ${req.userId}. Text: "${text?.substring(0, 50)}"`);
    
    const parts = [];
    
    if (attachments && Array.isArray(attachments)) {
      for (const att of attachments) {
        if (!att.data) continue;
        const base64Data = att.data.includes(',') ? att.data.split(',')[1] : att.data;
        if (base64Data) {
          parts.push({ 
            inlineData: { data: base64Data, mimeType: att.mimeType } 
          });
        }
      }
    }

    let prompt = `TASK: Use Google Search to enrich this entry.
${text ? `INPUT TEXT: "${text}"` : ''}
${tags?.length ? `USER TAGS: ${tags.join(', ')}` : ''}
${location ? `USER GPS: Lat ${location.latitude}, Lng ${location.longitude}` : ''}

RULES:
1. SEARCH: Find the specific business, place, movie, book, or entity mentioned.
2. GPS: If user GPS is provided, search near those coordinates for businesses.
3. MAPS LINK: For places, 'locationContext.mapsUri' MUST be a real Google Maps URL.
4. JSON: Return ONLY raw JSON matching the schema. lowercase keys. No markdown.
`;

    parts.push({ text: prompt });

    const model = genAI.getGenerativeModel({ 
        model: MODEL_NAME,
        tools: [{ googleSearch: {} }],
        safetySettings
    });

    const generationConfig = {
      responseMimeType: "application/json",
      responseSchema: enrichmentSchema,
    };

    const resultPromise = model.generateContent({
      contents: [{ role: "user", parts }],
      generationConfig
    });

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Gemini API timeout')), 25000)
    );

    const result = await Promise.race([resultPromise, timeoutPromise]);
    const responseText = result.response.text();
    const duration = Date.now() - startTime;
    
    console.log(`[Enrich] API responded in ${duration}ms. Raw response length: ${responseText.length}`);

    const parsed = JSON.parse(responseText);
    
    const normalizeKeys = (obj) => {
      if (Array.isArray(obj)) return obj.map(normalizeKeys);
      if (obj !== null && typeof obj === 'object') {
        return Object.keys(obj).reduce((acc, key) => {
          const lowerKey = key.charAt(0).toLowerCase() + key.slice(1);
          acc[lowerKey] = normalizeKeys(obj[key]);
          return acc;
        }, {});
      }
      return obj;
    };

    res.json(normalizeKeys(parsed));
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Enrich] Main enrichment failed after ${duration}ms. Error:`, error.message);
    
    // Fallback: Try without Google Search if it timed out or failed
    const fallbackStartTime = Date.now();
    console.log('[Enrich] Attempting fallback enrichment without Google Search...');
    try {
        const fallbackModel = genAI.getGenerativeModel({ model: FALLBACK_MODEL_NAME, safetySettings });
        const fallbackResult = await fallbackModel.generateContent({
            contents: [{ role: "user", parts: [{ text: `Summarize and tag this (no search): "${text}" Tags: ${tags?.join(',')}. Return JSON: ${JSON.stringify(enrichmentSchema)}` }] }],
            generationConfig: { responseMimeType: "application/json", responseSchema: enrichmentSchema }
        });
        const fallbackResponseText = fallbackResult.response.text();
        console.log(`[Enrich] Fallback succeeded in ${Date.now() - fallbackStartTime}ms`);
        return res.json(JSON.parse(fallbackResponseText));
    } catch (fallbackError) {
        console.error('[Enrich] Fallback failed:', fallbackError.message);
        res.status(500).json({ error: 'Enrichment failed', details: error.message });
    }
  }
});

app.post('/api/query', authenticateRequest, async (req, res) => {
  try {
    const { query, memories } = req.body;
    
    if (!memories || !Array.isArray(memories) || memories.length === 0) {
      return res.json({ 
        answer: "I don't have any notes to search through yet. Try adding some memories first!", 
        sources: [] 
      });
    }

    const model = genAI.getGenerativeModel({ 
      model: MODEL_NAME,
      safetySettings 
    });

    const context = memories.map(m => `ID: ${m.id}\nContent: ${m.content}`).join('\n---\n');
    
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

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { 
        responseMimeType: "application/json", 
        responseSchema: queryResponseSchema 
      }
    });

    const responseText = result.response.text();
    console.log(`[Query] User ${req.userId} query: "${query}". Response length: ${responseText.length}`);
    
    res.json(JSON.parse(responseText));
  } catch (error) {
    console.error('Query failed:', error.message);
    res.status(500).json({ error: 'Query failed', details: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Proxy on ${PORT}`));
