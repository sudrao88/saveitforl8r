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

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const ai = new GoogleGenAI(GEMINI_API_KEY);

app.use(cors()); // Simplified CORS for now to ensure deployment success
app.use(express.json({ limit: '10mb' }));

const authenticateRequest = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Auth required' });
  const accessToken = authHeader.slice(7);
  try {
    const response = await fetch(`${GOOGLE_TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`);
    if (!response.ok) return res.status(401).json({ error: 'Invalid token' });
    const tokenInfo = await response.json();
    const expectedClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
    if (expectedClientId && tokenInfo.aud !== expectedClientId) return res.status(403).json({ error: 'Audience mismatch' });
    req.userId = tokenInfo.sub || tokenInfo.email || 'unknown';
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Auth failed' });
  }
};

const enrichmentSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    visualDescription: { type: Type.STRING },
    locationIsRelevant: { type: Type.BOOLEAN },
    locationContext: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        address: { type: Type.STRING },
        mapsUri: { type: Type.STRING }
      }
    },
    suggestedTags: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ['summary', 'suggestedTags', 'locationIsRelevant']
};

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/enrich', authenticateRequest, async (req, res) => {
  try {
    const { text, attachments, tags } = req.body;
    const model = ai.getGenerativeModel({ 
        model: MODEL_NAME,
        generationConfig: { responseMimeType: "application/json", responseSchema: enrichmentSchema }
    });
    const prompt = `Enrich this entry: ${text}. Tags: ${tags?.join(',')}`;
    const result = await model.generateContent(prompt);
    res.json(JSON.parse(result.response.text()));
  } catch (error) {
    res.status(500).json({ error: 'Enrichment failed' });
  }
});

app.post('/api/query', authenticateRequest, async (req, res) => {
  try {
    const { query, memories } = req.body;
    const model = ai.getGenerativeModel({ model: MODEL_NAME });
    const context = memories.map(m => m.content).join('\n');
    const result = await model.generateContent(`Context: ${context}\n\nQuery: ${query}`);
    res.json({ answer: result.response.text(), sourceIds: [] });
  } catch (error) {
    res.status(500).json({ error: 'Query failed' });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Proxy on ${PORT}`));
