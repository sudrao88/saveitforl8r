/**
 * SaveItForL8R server proxy — thin orchestrator.
 *
 * Business logic is split into focused modules:
 *   middleware/auth.js       — Google OAuth token validation + caching
 *   middleware/validation.js — Request input validation
 *   services/gemini.js       — Schemas, prompts, sanitization
 *   routes/enrich.js         — /api/enrich + /api/enrich/results
 *   routes/query.js          — /api/query
 *   routes/moment.js         — /api/moment/embed (intent + term vectors, emoji for moments)
 *   lib/sanitize.js          — Shared sanitization utilities
 */
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai';
import { Firestore } from '@google-cloud/firestore';
import { createEnrichRouter } from './routes/enrich.js';
import { createQueryRouter } from './routes/query.js';
import { createEmbedRouter } from './routes/embed.js';
import { createMomentRouter } from './routes/moment.js';
import { createPushRouter } from './routes/push.js';
import { createUploadRouter } from './routes/upload.js';
import { createConcurrencyLimiter } from './lib/concurrency.js';

const app = express();
const PORT = process.env.PORT || 8081;
const GEMINI_TIMEOUT_MS = 60_000;

// --- Gemini API setup ---

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('FATAL: GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
if (!GOOGLE_CLIENT_ID) {
  console.error('FATAL: GOOGLE_CLIENT_ID environment variable is required for token audience validation');
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

// --- Concurrency limiter for background AI tasks ---
// Prevents unbounded Gemini API calls during traffic surges.
// Max 20 concurrent background tasks; excess requests are queued.
const aiLimiter = createConcurrencyLimiter(20);

// --- Security middleware ---

app.use(helmet());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  console.warn('WARNING: ALLOWED_ORIGINS is not set — all cross-origin requests will be denied. Set ALLOWED_ORIGINS to allow specific origins.');
}

app.use(
  cors({
    origin: (origin, callback) => {
      // When no origins are configured, deny all cross-origin requests
      if (allowedOrigins.length === 0) {
        if (!origin) return callback(null, true); // same-origin / server-to-server
        console.error(`[CORS] Blocked request (no allowed origins configured): ${origin}`);
        return callback(new Error('Not allowed by CORS'));
      }
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error(`[CORS] Blocked request from origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
);

app.use(compression());
app.use(express.json({ limit: '75mb' }));

// Attach an anonymous request ID for log correlation
app.use((req, _res, next) => {
  req.requestId = crypto.randomBytes(8).toString('hex');
  next();
});

// --- Health check ---

const healthLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/health', healthLimiter, async (_req, res) => {
  const checks = { server: 'ok', firestore: 'ok' };

  if (db) {
    try {
      await db.collection('_healthcheck').limit(1).get();
    } catch (err) {
      console.warn('[Health] Firestore check failed:', err.message);
      checks.firestore = 'degraded';
    }
  } else {
    checks.firestore = 'unavailable';
  }

  const overall = Object.values(checks).every((v) => v === 'ok') ? 'ok' : 'degraded';
  const statusCode = overall === 'ok' ? 200 : 503;
  res.status(statusCode).json({ status: overall, checks });
});

// --- Mount route modules ---

const sharedDeps = { ai, db, MODEL_NAME, FALLBACK_MODEL_NAME, GEMINI_TIMEOUT_MS, ENRICHMENT_COLLECTION, ENRICHMENT_TTL_MS, ENRICHMENT_FAILED_TTL_MS, aiLimiter };

app.use('/api/enrich', createEnrichRouter(sharedDeps));
app.use('/api/query', createQueryRouter(sharedDeps));
app.use('/api/embed', createEmbedRouter(sharedDeps));
app.use('/api/push', createPushRouter({ db }));
app.use('/api/upload', createUploadRouter({ ai, db }));

app.use('/api/moment', createMomentRouter(sharedDeps));

// --- Graceful shutdown ---

const server = app.listen(PORT, '0.0.0.0', () => console.log(`Proxy on ${PORT}`));

const SHUTDOWN_TIMEOUT_MS = 30_000;

const shutdown = (signal) => {
  console.log(`[Shutdown] ${signal} received — draining connections…`);
  const forceTimer = setTimeout(() => {
    console.error('[Shutdown] Forceful exit after timeout.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();
  server.close(() => {
    clearTimeout(forceTimer);
    console.log('[Shutdown] HTTP server closed. Exiting.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
