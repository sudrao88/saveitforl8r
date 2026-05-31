import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createCalendarRouter, CALENDAR_SCOPE } from '../routes/calendar.js';
import { _resetAudienceCache } from '../middleware/auth.js';

// --- Test HTTP client (node:http, so it doesn't collide with the stubbed
//     global.fetch the server uses for its outbound calls) ---
const get = (port, path, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, json: data ? JSON.parse(data) : null })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });

const AUD = 'client-l8rgram';
const SPAN = 'timeMin=2024-06-01T00:00:00Z&timeMax=2024-06-08T00:00:00Z';

// Per-test override of how the (stubbed) Google upstream responds.
let upstreamHandler;
let tokenScope;
const realFetch = global.fetch;

let server;
let port;

before(async () => {
  process.env.GOOGLE_ALLOWED_AUDIENCES = AUD;
  _resetAudienceCache();

  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/tokeninfo')) {
      return new Response(
        JSON.stringify({ aud: AUD, sub: 'user-1', scope: tokenScope }),
        { status: 200 }
      );
    }
    if (u.includes('calendar/v3/calendars/primary/events')) {
      return upstreamHandler(new URL(u));
    }
    return realFetch(url);
  };

  const app = express();
  app.use((req, _res, next) => { req.requestId = 'test'; next(); });
  app.use('/api/calendar', createCalendarRouter());

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });
});

after(async () => {
  global.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  tokenScope = `openid ${CALENDAR_SCOPE}`;
  upstreamHandler = () => new Response(JSON.stringify({ items: [] }), { status: 200 });
});

describe('GET /api/calendar/events', () => {
  test('forwards to Google and returns the upstream JSON unchanged', async () => {
    upstreamHandler = (url) => {
      // Assert the route passes through the Google query knobs.
      assert.equal(url.searchParams.get('singleEvents'), 'true');
      assert.equal(url.searchParams.get('orderBy'), 'startTime');
      assert.equal(url.searchParams.get('timeMin'), '2024-06-01T00:00:00Z');
      return new Response(
        JSON.stringify({ items: [{ id: 'evt-1', summary: 'Lunch' }], nextPageToken: 'pg2' }),
        { status: 200 }
      );
    };

    const res = await get(port, `/api/calendar/events?${SPAN}`, {
      authorization: 'Bearer tok-ok',
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.items[0].id, 'evt-1');
    assert.equal(res.json.nextPageToken, 'pg2');
  });

  test('forwards a pageToken to the upstream request', async () => {
    let seenToken = null;
    upstreamHandler = (url) => {
      seenToken = url.searchParams.get('pageToken');
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    };
    await get(port, `/api/calendar/events?${SPAN}&pageToken=pg2`, {
      authorization: 'Bearer tok-page',
    });
    assert.equal(seenToken, 'pg2');
  });

  test('maps an upstream 401 to reauth_required', async () => {
    upstreamHandler = () => new Response('expired', { status: 401 });
    const res = await get(port, `/api/calendar/events?${SPAN}`, {
      authorization: 'Bearer tok-401',
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.error, 'reauth_required');
  });

  test('wraps other upstream errors as 502', async () => {
    upstreamHandler = () => new Response('boom', { status: 500 });
    const res = await get(port, `/api/calendar/events?${SPAN}`, {
      authorization: 'Bearer tok-500',
    });
    assert.equal(res.status, 502);
    assert.equal(res.json.error, 'calendar_upstream_error');
  });

  test('rejects a caller lacking the calendar.readonly scope with 403', async () => {
    tokenScope = 'openid email';
    const res = await get(port, `/api/calendar/events?${SPAN}`, {
      authorization: 'Bearer tok-noscope',
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error, 'insufficient_scope');
  });

  test('rejects an oversized span with 400 before hitting Google', async () => {
    let upstreamCalled = false;
    upstreamHandler = () => { upstreamCalled = true; return new Response('{}', { status: 200 }); };
    const res = await get(
      port,
      '/api/calendar/events?timeMin=2022-01-01T00:00:00Z&timeMax=2024-01-01T00:00:00Z',
      { authorization: 'Bearer tok-span' }
    );
    assert.equal(res.status, 400);
    assert.equal(upstreamCalled, false);
  });
});
