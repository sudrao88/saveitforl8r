// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  validateQueryInput,
  validateSynthesizeInput,
} from './validation.js';

// ── helpers ──────────────────────────────────────────────────────────

const mockReq = (body) => ({ body });
const mockRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  return res;
};
const mockNext = vi.fn();

const VALID_UUID = '12345678-1234-1234-1234-123456789abc';

// ── validateQueryInput ───────────────────────────────────────────────

describe('validateQueryInput', () => {
  it('should pass with valid query only', () => {
    const next = vi.fn();
    validateQueryInput(mockReq({ query: 'hello' }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('should pass with query and valid history', () => {
    const next = vi.fn();
    validateQueryInput(
      mockReq({
        query: 'hello',
        history: [{ role: 'user', text: 'hi' }],
      }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalled();
  });

  it('should reject missing query', () => {
    const res = mockRes();
    validateQueryInput(mockReq({}), res, mockNext);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/query is required/);
  });

  it('should reject query exceeding max length', () => {
    const res = mockRes();
    validateQueryInput(mockReq({ query: 'a'.repeat(2001) }), res, mockNext);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/too long/);
  });

  it('should no longer require memories array', () => {
    // After the Drive fetch refactor, memories should not be validated
    const next = vi.fn();
    validateQueryInput(mockReq({ query: 'hello' }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('should reject non-array history', () => {
    const res = mockRes();
    validateQueryInput(mockReq({ query: 'hello', history: 'bad' }), res, mockNext);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/history must be an array/);
  });

  it('should reject too many history turns', () => {
    const res = mockRes();
    const history = Array.from({ length: 11 }, (_, i) => ({
      role: 'user',
      text: `turn ${i}`,
    }));
    validateQueryInput(mockReq({ query: 'hello', history }), res, mockNext);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Too many history turns/);
  });

  it('should reject invalid history turn role', () => {
    const res = mockRes();
    validateQueryInput(
      mockReq({ query: 'hello', history: [{ role: 'admin', text: 'hi' }] }),
      res,
      mockNext
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/role/);
  });

  it('should reject history turn with missing text', () => {
    const res = mockRes();
    validateQueryInput(
      mockReq({ query: 'hello', history: [{ role: 'user' }] }),
      res,
      mockNext
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/text string/);
  });

  it('should reject history turn with text too long', () => {
    const res = mockRes();
    validateQueryInput(
      mockReq({ query: 'hello', history: [{ role: 'user', text: 'x'.repeat(4001) }] }),
      res,
      mockNext
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/text too long/);
  });
});

// ── validateSynthesizeInput ──────────────────────────────────────────

describe('validateSynthesizeInput', () => {
  const VALID_UUID_2 = 'abcdef01-2345-6789-abcd-ef0123456789';
  const validBody = {
    noteIds: [VALID_UUID, VALID_UUID_2],
    momentType: 'general',
    momentTitle: 'My Moment',
    momentId: VALID_UUID,
  };

  it('should pass with valid input including noteIds', () => {
    const next = vi.fn();
    validateSynthesizeInput(mockReq(validBody), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('should pass without noteIds (server fetches all notes from Drive)', () => {
    const next = vi.fn();
    const { noteIds, ...bodyWithoutNoteIds } = validBody;
    validateSynthesizeInput(mockReq(bodyWithoutNoteIds), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('should reject non-array noteIds', () => {
    const res = mockRes();
    validateSynthesizeInput(
      mockReq({ ...validBody, noteIds: 'bad' }),
      res,
      mockNext
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/noteIds must be an array/);
  });

  it('should reject too many noteIds', () => {
    const res = mockRes();
    const manyUuids = Array.from({ length: 501 }, (_, i) =>
      `${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`
    );
    validateSynthesizeInput(
      mockReq({ ...validBody, noteIds: manyUuids }),
      res,
      mockNext
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Too many noteIds/);
  });

  it('should reject non-string noteIds', () => {
    const res = mockRes();
    validateSynthesizeInput(
      mockReq({ ...validBody, noteIds: [123] }),
      res,
      mockNext
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Each noteId must be a valid UUID/);
  });

  it('should reject noteIds that are not valid UUIDs', () => {
    const res = mockRes();
    validateSynthesizeInput(
      mockReq({ ...validBody, noteIds: ['not-a-uuid'] }),
      res,
      mockNext
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Each noteId must be a valid UUID/);
  });

  it('should accept noteIds that are valid UUIDs', () => {
    const next = vi.fn();
    validateSynthesizeInput(
      mockReq({ ...validBody, noteIds: [VALID_UUID, 'abcdef01-2345-6789-abcd-ef0123456789'] }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalled();
  });

  it('should reject missing momentType', () => {
    const res = mockRes();
    validateSynthesizeInput(
      mockReq({ ...validBody, momentType: undefined }),
      res,
      mockNext
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/momentType/);
  });

  it('should reject missing momentTitle', () => {
    const res = mockRes();
    validateSynthesizeInput(
      mockReq({ ...validBody, momentTitle: undefined }),
      res,
      mockNext
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/momentTitle/);
  });

  it('should reject missing momentId', () => {
    const res = mockRes();
    validateSynthesizeInput(
      mockReq({ ...validBody, momentId: undefined }),
      res,
      mockNext
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/momentId/);
  });

  it('should reject invalid UUID for momentId', () => {
    const res = mockRes();
    validateSynthesizeInput(
      mockReq({ ...validBody, momentId: 'not-a-uuid' }),
      res,
      mockNext
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/momentId must be a valid UUID/);
  });

  it('should allow optional objective as string', () => {
    const next = vi.fn();
    validateSynthesizeInput(
      mockReq({ ...validBody, objective: 'Plan a trip' }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalled();
  });

  it('should reject non-string objective', () => {
    const res = mockRes();
    validateSynthesizeInput(
      mockReq({ ...validBody, objective: 123 }),
      res,
      mockNext
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/objective must be a string/);
  });
});
