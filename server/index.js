/**
 * SaveItForL8R server proxy — thin orchestrator.
 *
 * Business logic is split into focused modules:
 *   middleware/auth.js       — Google OAuth token validation + caching
 *   middleware/validation.js — Request input validation
 *   services/gemini.js       — Schemas, prompts, sanitization
 *   routes/enrich.js         — /api/enrich + /api/enrich/results
 *   routes/query.js          — /api/query
 *   lib/sanitize.js          — Shared sanitization utilities
 */
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { GoogleGenAI } from '@google/genai';
import { Firestore } from '@google-cloud/firestore';
import { createEnrichRouter } from './routes/enrich.js';
import { createQueryRouter } from './routes/query.js';

const app = express();
const PORT = process.env.PORT || 8081;
const GEMINI_TIMEOUT_MS = 60_000;

// --- Gemini API setup ---

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('FATAL: GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const MODEL_NAME = 'gemini-3-flash-preview';
const FALLBACK_MODEL_NAME = 'gemini-2.0-flash';
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// --- Firestore for durable enrichment results ---

const ENRICHMENT_COLLECTION = 'enrichment-results';
const ENRICHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ENRICHMENT_FAILED_TTL_MS = 24 * 60 * 60 * 1000; // 1 day for failures

let db;
try {
  db = new Firestore();
  console.log('Firestore initialized for enrichment result persistence');
} catch (err) {
  console.warn('Firestore initialization failed (enrichment recovery disabled):', err.message);
}

// --- Security middleware ---

app.use(helmet());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error(`[CORS] Blocked request from origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
);

app.use(express.json({ limit: '10mb' }));

// Attach an anonymous request ID for log correlation
app.use((req, _res, next) => {
  req.requestId = crypto.randomBytes(4).toString('hex');
  next();
});

// --- Health check ---

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// --- Mount route modules ---

const sharedDeps = { ai, db, MODEL_NAME, FALLBACK_MODEL_NAME, GEMINI_TIMEOUT_MS, ENRICHMENT_COLLECTION, ENRICHMENT_TTL_MS, ENRICHMENT_FAILED_TTL_MS };

app.use('/api/enrich', createEnrichRouter(sharedDeps));
app.use('/api/query', createQueryRouter(sharedDeps));

// --- Start server ---

app.listen(PORT, '0.0.0.0', () => console.log(`Proxy on ${PORT}`));
