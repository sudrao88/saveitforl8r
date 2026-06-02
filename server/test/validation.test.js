import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCalendarQuery,
  validateEnrichPhoto,
  validatePhotoResultsInput,
  validateQueryGallery,
} from '../middleware/validation.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const FILE_URI = 'https://generativelanguage.googleapis.com/v1beta/files/abc123';

const runBody = (validate, body) => {
  const req = { body };
  const res = makeRes();
  let nexted = false;
  validate(req, res, () => { nexted = true; });
  return { res, nexted };
};

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

describe('validateEnrichPhoto', () => {
  test('accepts an inline image with a valid jobId', () => {
    const { nexted, res } = runBody(validateEnrichPhoto, {
      jobId: UUID,
      image: { mimeType: 'image/jpeg', data: 'AAAA' },
    });
    assert.ok(nexted);
    assert.equal(res.statusCode, 200);
  });

  test('accepts a pre-uploaded fileUri image', () => {
    const { nexted } = runBody(validateEnrichPhoto, {
      jobId: UUID,
      image: { mimeType: 'image/png', fileUri: FILE_URI },
    });
    assert.ok(nexted);
  });

  test('rejects a non-UUID jobId', () => {
    const { nexted, res } = runBody(validateEnrichPhoto, {
      jobId: 'nope',
      image: { mimeType: 'image/jpeg', data: 'AAAA' },
    });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 400);
  });

  test('rejects a non-image mime type', () => {
    const { nexted, res } = runBody(validateEnrichPhoto, {
      jobId: UUID,
      image: { mimeType: 'application/pdf', data: 'AAAA' },
    });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 400);
  });

  test('rejects an image with neither data nor fileUri', () => {
    const { nexted, res } = runBody(validateEnrichPhoto, {
      jobId: UUID,
      image: { mimeType: 'image/jpeg' },
    });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 400);
  });

  test('rejects an oversized inline payload', () => {
    const { nexted, res } = runBody(validateEnrichPhoto, {
      jobId: UUID,
      image: { mimeType: 'image/jpeg', data: 'A'.repeat(70_000_001) },
    });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 400);
  });
});

describe('validatePhotoResultsInput', () => {
  test('accepts an array of UUID jobIds', () => {
    const { nexted } = runBody(validatePhotoResultsInput, { jobIds: [UUID] });
    assert.ok(nexted);
  });

  test('rejects an empty array', () => {
    const { nexted, res } = runBody(validatePhotoResultsInput, { jobIds: [] });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 400);
  });

  test('rejects non-UUID entries', () => {
    const { nexted, res } = runBody(validatePhotoResultsInput, { jobIds: ['x'] });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 400);
  });
});

describe('validateQueryGallery', () => {
  test('accepts a query with photo contexts', () => {
    const { nexted } = runBody(validateQueryGallery, {
      query: 'beach trip',
      photoContexts: [{ id: 'p1', caption: 'ocean', tags: ['sea'], capturedAt: 1, albumTitles: [] }],
    });
    assert.ok(nexted);
  });

  test('accepts an empty photoContexts array', () => {
    const { nexted } = runBody(validateQueryGallery, { query: 'x', photoContexts: [] });
    assert.ok(nexted);
  });

  test('rejects a missing query', () => {
    const { nexted, res } = runBody(validateQueryGallery, { photoContexts: [] });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 400);
  });

  test('rejects when photoContexts is not an array', () => {
    const { nexted, res } = runBody(validateQueryGallery, { query: 'x', photoContexts: 'no' });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 400);
  });

  test('rejects a context missing a string id', () => {
    const { nexted, res } = runBody(validateQueryGallery, {
      query: 'x',
      photoContexts: [{ caption: 'no id' }],
    });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 400);
  });
});
