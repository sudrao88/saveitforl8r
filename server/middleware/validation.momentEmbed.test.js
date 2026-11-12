import { describe, it, expect, vi } from 'vitest';
import { validateMomentEmbedInput, MAX_MOMENT_TERMS, MAX_MOMENT_TERM_LENGTH } from './validation.js';

const run = (body) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const next = vi.fn();
  validateMomentEmbedInput({ body }, res, next);
  return { res, next };
};

describe('validateMomentEmbedInput', () => {
  it('accepts a list of non-empty terms', () => {
    const { next, res } = run({ terms: ['Singapore', 'hawker food'] });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each([
    ['missing terms', {}],
    ['empty list', { terms: [] }],
    ['too many terms', { terms: Array(MAX_MOMENT_TERMS + 1).fill('x') }],
    ['blank term', { terms: ['  '] }],
    ['non-string term', { terms: [42] }],
    ['oversized term', { terms: ['x'.repeat(MAX_MOMENT_TERM_LENGTH + 1)] }],
  ])('rejects %s with 400', (_label, body) => {
    const { next, res } = run(body);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
