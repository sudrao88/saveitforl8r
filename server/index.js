import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const app = express();
const PORT = process.env.PORT || 8081;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('FATAL: GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
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

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/enrich', authenticateRequest, async (req, res) => {
  try {
    const { text, attachments, location, tags } = req.body;
    console.log(`Enrichment request for user ${req.userId}. Text length: ${text?.length || 0}`);
    
    const parts = [];
    
    // Add attachments (images, PDFs, text files)
    if (attachments && Array.isArray(attachments)) {
      for (const att of attachments) {
        const base64Data = att.data.split(',')[1];
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

    const model = genAI.getGenerativeModel({ 
        model: MODEL_NAME,
        tools: [{ googleSearch: {} }]
    });

    const generationConfig = {
      responseMimeType: "application/json",
      responseSchema: enrichmentSchema,
    };

    // OPTIMIZATION: Disable thinking process if supported by the model
    if (MODEL_NAME.includes('thinking')) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
      generationConfig
    });

    const responseText = result.response.text();
    res.json(JSON.parse(responseText));
  } catch (error) {
    console.error('Enrichment failed error details:', error);
    res.status(500).json({ 
      error: 'Enrichment failed', 
      details: error.message
    });
  }
});

app.post('/api/query', authenticateRequest, async (req, res) => {
  try {
    const { query, memories } = req.body;
    console.log(`Query request for user ${req.userId}. Query: ${query}`);
    
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const context = memories.map(m => m.content).join('\n');
    const result = await model.generateContent(`Context: ${context}\n\nQuery: ${query}`);
    res.json({ answer: result.response.text(), sourceIds: [] });
  } catch (error) {
    console.error('Query failed error details:', error);
    res.status(500).json({ error: 'Query failed', details: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Proxy on ${PORT}`));
