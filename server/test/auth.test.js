import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { authenticateRequest, getAllowedAudiences, _resetAudienceCache } from '../middleware/auth.js';

const makeRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.GOOGLE_ALLOWED_AUDIENCES;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.VITE_GOOGLE_CLIENT_ID;
  _resetAudienceCache();
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
  _resetAudienceCache();
});

describe('getAllowedAudiences', () => {
  test('single audience falls back to GOOGLE_CLIENT_ID when allowlist unset', () => {
    process.env.GOOGLE_CLIENT_ID = 'client-saveitforl8r';
    const set = getAllowedAudiences();
    assert.equal(set.size, 1);
    assert.ok(set.has('client-saveitforl8r'));
  });

  test('parses a comma-separated multi-audience allowlist', () => {
    process.env.GOOGLE_ALLOWED_AUDIENCES = ' client-a , client-b ,client-c ';
    const set = getAllowedAudiences();
    assert.equal(set.size, 3);
    assert.ok(set.has('client-a'));
    assert.ok(set.has('client-b'));
    assert.ok(set.has('client-c'));
  });

  test('allowlist takes precedence over GOOGLE_CLIENT_ID', () => {
    process.env.GOOGLE_ALLOWED_AUDIENCES = 'client-a,client-b';
    process.env.GOOGLE_CLIENT_ID = 'client-legacy';
    const set = getAllowedAudiences();
    assert.ok(!set.has('client-legacy'));
    assert.ok(set.has('client-a'));
  });
});

describe('authenticateRequest audience check', () => {
  let realFetch;
  afterEach(() => { global.fetch = realFetch; });

  const stubTokeninfo = (info) => {
    realFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify(info), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  test('accepts a token whose aud is in the allowlist (multi)', async () => {
    process.env.GOOGLE_ALLOWED_AUDIENCES = 'client-a,client-b';
    _resetAudienceCache();
    stubTokeninfo({ aud: 'client-b', sub: 'user-1', scope: 'openid email' });

    const req = { headers: { authorization: 'Bearer tok-accept-multi' }, requestId: 'r1' };
    const res = makeRes();
    let nexted = false;
    await authenticateRequest(req, res, () => { nexted = true; });

    assert.ok(nexted, 'next() should be called');
    assert.equal(req.userId, 'user-1');
    assert.equal(req.tokenInfo.scope, 'openid email');
  });

  test('rejects a token whose aud is not allowlisted with 403', async () => {
    process.env.GOOGLE_ALLOWED_AUDIENCES = 'client-a';
    _resetAudienceCache();
    stubTokeninfo({ aud: 'client-evil', sub: 'user-2', scope: 'openid' });

    const req = { headers: { authorization: 'Bearer tok-reject' }, requestId: 'r2' };
    const res = makeRes();
    let nexted = false;
    await authenticateRequest(req, res, () => { nexted = true; });

    assert.equal(nexted, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Audience mismatch');
  });

  test('caches scope so requireScope can read it on the cache-hit path', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-a';
    _resetAudienceCache();
    stubTokeninfo({ aud: 'client-a', sub: 'user-3', scope: 'a b c' });

    const headers = { authorization: 'Bearer tok-cached' };
    // First call hits the (stubbed) network and populates the cache.
    await authenticateRequest({ headers, requestId: 'r3' }, makeRes(), () => {});

    // Second call must resolve from cache even if the network now fails.
    global.fetch = async () => { throw new Error('network should not be called'); };
    const req2 = { headers, requestId: 'r4' };
    let nexted = false;
    await authenticateRequest(req2, makeRes(), () => { nexted = true; });

    assert.ok(nexted);
    assert.equal(req2.userId, 'user-3');
    assert.equal(req2.tokenInfo.scope, 'a b c');
  });
});
