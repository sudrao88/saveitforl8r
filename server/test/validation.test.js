import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateCalendarQuery } from '../middleware/validation.js';

const makeRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const run = (query) => {
  const req = { query };
  const res = makeRes();
  let nexted = false;
  validateCalendarQuery(req, res, () => { nexted = true; });
  return { res, nexted };
};

describe('validateCalendarQuery', () => {
  test('accepts a valid one-week RFC3339 span', () => {
    const { res, nexted } = run({
      timeMin: '2024-06-01T00:00:00Z',
      timeMax: '2024-06-08T00:00:00Z',
    });
    assert.ok(nexted);
    assert.equal(res.statusCode, 200);
  });

  test('accepts an optional pageToken', () => {
    const { nexted } = run({
      timeMin: '2024-06-01T00:00:00.000Z',
      timeMax: '2024-06-02T00:00:00+05:30',
      pageToken: 'abc123',
    });
    assert.ok(nexted);
  });

  test('rejects when timeMin/timeMax are missing', () => {
    const { res, nexted } = run({ timeMin: '2024-06-01T00:00:00Z' });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 400);
  });

  test('rejects non-RFC3339 timestamps', () => {
    const { res, nexted } = run({ timeMin: '2024-06-01', timeMax: 'not-a-date' });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 400);
  });

  test('rejects when timeMax is not after timeMin', () => {
    const { res, nexted } = run({
      timeMin: '2024-06-08T00:00:00Z',
      timeMax: '2024-06-01T00:00:00Z',
    });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 400);
  });

  test('rejects a span larger than one year', () => {
    const { res, nexted } = run({
      timeMin: '2022-01-01T00:00:00Z',
      timeMax: '2024-01-01T00:00:00Z',
    });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /1 year/);
  });
});
