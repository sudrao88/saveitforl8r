import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { requireScope } from '../middleware/requireScope.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

const makeRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

describe('requireScope', () => {
  test('calls next() when the required scope is present', () => {
    const req = { tokenInfo: { scope: `openid email ${SCOPE}` } };
    const res = makeRes();
    let nexted = false;
    requireScope(SCOPE)(req, res, () => { nexted = true; });
    assert.ok(nexted);
    assert.equal(res.statusCode, 200);
  });

  test('returns 403 insufficient_scope when the scope is missing', () => {
    const req = { tokenInfo: { scope: 'openid email' } };
    const res = makeRes();
    let nexted = false;
    requireScope(SCOPE)(req, res, () => { nexted = true; });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'insufficient_scope');
    assert.equal(res.body.required, SCOPE);
  });

  test('returns 403 when tokenInfo is absent entirely', () => {
    const req = {};
    const res = makeRes();
    requireScope(SCOPE)(req, res, () => {});
    assert.equal(res.statusCode, 403);
  });
});
