import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createQueryGalleryRouter } from '../routes/queryGallery.js';
import { _resetAudienceCache } from '../middleware/auth.js';

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
const AUTH = { authorization: 'Bearer tok-ok' };

// Minimal Firestore stub capturing writes.
const makeFakeDb = () => {
  const writes = [];
  return {
    writes,
    collection: () => ({ doc: () => ({ set: async (obj) => { writes.push(obj); } }) }),
  };
};

let geminiResult;
let lastPrompt;
let failPrimary;
const makeFakeAi = () => ({
  models: {
    generateContent: async ({ model, contents }) => {
      lastPrompt = contents[0].parts[0].text;
      if (failPrimary && model === 'model-primary') throw new Error('primary down');
      return { text: geminiResult };
    },
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
  app.use('/api/query-gallery', createQueryGalleryRouter({
    ai: makeFakeAi(),
    db,
    MODEL_NAME: 'model-primary',
    FALLBACK_MODEL_NAME: 'model-fallback',
    GEMINI_TIMEOUT_MS: 5000,
    GALLERY_QUERY_COLLECTION: 'gallery-query-results',
    GALLERY_QUERY_TTL_MS: 1000,
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
  db.writes.length = 0;
  failPrimary = false;
  geminiResult = JSON.stringify({ photoIds: ['p1', 'p2'], reasoning: 'beach photos' });
});

const CONTEXTS = [
  { id: 'p1', caption: 'ocean waves', tags: ['sea'], capturedAt: 1719000000000, albumTitles: ['Trip'] },
  { id: 'p2', caption: 'sand', tags: ['beach'], capturedAt: 1719100000000, albumTitles: [] },
  { id: 'p3', caption: 'office', tags: ['work'], capturedAt: 1719200000000, albumTitles: [] },
];

describe('POST /api/query-gallery', () => {
  test('returns matching photo ids and persists the result', async () => {
    const res = await post(port, '/api/query-gallery', { query: 'beach trip', photoContexts: CONTEXTS }, AUTH);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.photoIds, ['p1', 'p2']);
    assert.equal(res.json.reasoning, 'beach photos');
    // The prompt embeds the per-photo context block + the query.
    assert.match(lastPrompt, /ocean waves/);
    assert.match(lastPrompt, /beach trip/);
    // Best-effort persistence happened.
    assert.equal(db.writes.length, 1);
    assert.equal(db.writes[0].status, 'completed');
  });

  test('drops model-hallucinated ids not in the photo set', async () => {
    geminiResult = JSON.stringify({ photoIds: ['p1', 'ghost', 'p3'] });
    const res = await post(port, '/api/query-gallery', { query: 'x', photoContexts: CONTEXTS }, AUTH);
    assert.deepEqual(res.json.photoIds, ['p1', 'p3']);
  });

  test('short-circuits with no photos to search', async () => {
    const res = await post(port, '/api/query-gallery', { query: 'x', photoContexts: [] }, AUTH);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.photoIds, []);
  });

  test('falls back to the secondary model when the primary fails', async () => {
    failPrimary = true;
    const res = await post(port, '/api/query-gallery', { query: 'beach', photoContexts: CONTEXTS }, AUTH);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.photoIds, ['p1', 'p2']);
  });

  test('rejects an unauthenticated request', async () => {
    const res = await post(port, '/api/query-gallery', { query: 'x', photoContexts: [] });
    assert.equal(res.status, 401);
  });

  test('rejects a missing query with 400', async () => {
    const res = await post(port, '/api/query-gallery', { photoContexts: CONTEXTS }, AUTH);
    assert.equal(res.status, 400);
  });
});
