import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createEnrichPhotoRouter } from '../routes/enrichPhoto.js';
import { createConcurrencyLimiter } from '../lib/concurrency.js';
import { _resetAudienceCache } from '../middleware/auth.js';

// --- Test HTTP client (node:http so it doesn't collide with the stubbed
//     global.fetch the auth middleware uses for tokeninfo) ---
const post = (port, path, body, headers = {}) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1', port, path, method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, json: data ? JSON.parse(data) : null }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });

const AUD = 'client-l8rgram';
const UUID = '11111111-1111-4111-8111-111111111111';
const AUTH = { authorization: 'Bearer tok-ok' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- In-memory Firestore stub ---
const makeFakeDb = () => {
  const store = new Map();
  const ref = (col, id) => ({
    _key: `${col}/${id}`,
    async get() { const d = store.get(`${col}/${id}`); return { exists: d !== undefined, data: () => d }; },
    async set(obj) { store.set(`${col}/${id}`, obj); },
  });
  return {
    _store: store,
    collection: (col) => ({ doc: (id) => ref(col, id) }),
    async getAll(...refs) {
      return refs.map((r) => { const d = store.get(r._key); return { exists: d !== undefined, data: () => d }; });
    },
  };
};

// --- Gemini stub ---
let geminiResult; // JSON string the model "returns"
let geminiCalls;
const makeFakeAi = () => ({
  models: {
    generateContent: async () => { geminiCalls++; return { text: geminiResult }; },
  },
  files: {
    upload: async () => ({ uri: 'https://generativelanguage.googleapis.com/v1beta/files/up1', name: 'files/up1' }),
    delete: async () => {},
  },
});

const realFetch = global.fetch;
let server;
let port;
let db;

before(async () => {
  process.env.GOOGLE_ALLOWED_AUDIENCES = AUD;
  _resetAudienceCache();

  global.fetch = async (url) => {
    if (String(url).includes('oauth2.googleapis.com/tokeninfo')) {
      return new Response(JSON.stringify({ aud: AUD, sub: 'user-1', scope: 'openid email' }), { status: 200 });
    }
    return realFetch(url);
  };

  db = makeFakeDb();
  const app = express();
  app.use(express.json({ limit: '75mb' }));
  app.use((req, _res, next) => { req.requestId = 'test'; next(); });
  app.use('/api/enrich-photo', createEnrichPhotoRouter({
    ai: makeFakeAi(),
    db,
    MODEL_NAME: 'model-primary',
    FALLBACK_MODEL_NAME: 'model-fallback',
    GEMINI_TIMEOUT_MS: 5000,
    PHOTO_ENRICHMENT_COLLECTION: 'photo-enrichment-results',
    PHOTO_ENRICHMENT_TTL_MS: 1000,
    PHOTO_ENRICHMENT_FAILED_TTL_MS: 1000,
    aiLimiter: createConcurrencyLimiter(5),
  }));

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });
});

after(async () => {
  global.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  db._store.clear();
  geminiResult = JSON.stringify({ caption: 'A dog runs on a beach.', tags: ['Dog', 'beach scene', 'dog'] });
  geminiCalls = 0;
});

// Poll the results endpoint until the job leaves the "processing" state.
const waitForResult = async (jobId) => {
  for (let i = 0; i < 50; i++) {
    const res = await post(port, '/api/enrich-photo/results', { jobIds: [jobId] }, AUTH);
    const entry = res.json.results[jobId];
    if (entry.status !== 'processing') return entry;
    await sleep(10);
  }
  throw new Error('timed out waiting for result');
};

describe('POST /api/enrich-photo', () => {
  test('acknowledges immediately and enriches an inline image', async () => {
    const accept = await post(port, '/api/enrich-photo', {
      jobId: UUID,
      image: { mimeType: 'image/jpeg', data: 'AAAABBBB' },
    }, AUTH);
    assert.equal(accept.status, 200);
    assert.equal(accept.json.status, 'accepted');

    const entry = await waitForResult(UUID);
    assert.equal(entry.status, 'completed');
    assert.equal(entry.data.caption, 'A dog runs on a beach.');
    // Tags normalized: lower-cased, de-duped, ≤2 words.
    assert.deepEqual(entry.data.tags, ['dog', 'beach scene']);
    assert.ok(geminiCalls >= 1);
  });

  test('persists a failed result when the model output cannot be parsed', async () => {
    // Non-JSON output → parseJsonResponse throws → the route records "failed".
    geminiResult = 'not json at all';
    const accept = await post(port, '/api/enrich-photo', {
      jobId: UUID,
      image: { mimeType: 'image/png', data: 'ZZZZ' },
    }, AUTH);
    assert.equal(accept.status, 200);

    const entry = await waitForResult(UUID);
    assert.equal(entry.status, 'failed');
  });

  test('rejects an unauthenticated request', async () => {
    const res = await post(port, '/api/enrich-photo', {
      jobId: UUID, image: { mimeType: 'image/jpeg', data: 'AAAA' },
    });
    assert.equal(res.status, 401);
  });

  test('rejects an invalid payload with 400', async () => {
    const res = await post(port, '/api/enrich-photo', { jobId: 'bad', image: {} }, AUTH);
    assert.equal(res.status, 400);
  });
});

describe('POST /api/enrich-photo/results', () => {
  test('returns not_found for an unknown job', async () => {
    const res = await post(port, '/api/enrich-photo/results', { jobIds: [UUID] }, AUTH);
    assert.equal(res.status, 200);
    assert.equal(res.json.results[UUID].status, 'not_found');
  });

  test('does not leak another user\'s result', async () => {
    // Seed a doc owned by a different user under this user's key shape.
    db._store.set(`photo-enrichment-results/user-1:${UUID}`, {
      userId: 'someone-else', status: 'completed', result: { caption: 'secret', tags: [] },
    });
    const res = await post(port, '/api/enrich-photo/results', { jobIds: [UUID] }, AUTH);
    assert.equal(res.json.results[UUID].status, 'not_found');
  });
});
