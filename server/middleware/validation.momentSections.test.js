import { describe, it, expect, vi } from 'vitest';
import { validateMomentSectionsInput, MAX_SECTION_NOTES, MAX_EXISTING_SECTIONS } from './validation.js';

const run = (body) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const next = vi.fn();
  validateMomentSectionsInput({ body }, res, next);
  return { res, next };
};

const note = (id, extra = {}) => ({ id, title: `Note ${id}`, ...extra });
const valid = () => ({ title: 'Japan trip', notes: [note('a', { summary: 's', type: 't', tags: ['x'] }), note('b')] });

describe('validateMomentSectionsInput', () => {
  it('accepts notes with and without existing sections', () => {
    expect(run(valid()).next).toHaveBeenCalled();
    expect(run({ ...valid(), existing: [{ id: 's1', label: 'Food', description: 'Eating.' }] }).next).toHaveBeenCalled();
  });

  it.each([
    ['missing title', { ...valid(), title: ' ' }],
    ['no notes', { ...valid(), notes: [] }],
    ['too many notes', { ...valid(), notes: Array.from({ length: MAX_SECTION_NOTES + 1 }, (_, i) => note(`n${i}`)) }],
    ['a note without an id', { ...valid(), notes: [{ title: 'x' }] }],
    ['duplicate note ids', { ...valid(), notes: [note('a'), note('a')] }],
    ['a note without a title', { ...valid(), notes: [{ id: 'a', title: '' }] }],
    ['an oversized summary', { ...valid(), notes: [note('a', { summary: 'x'.repeat(1001) })] }],
    ['non-string tags', { ...valid(), notes: [note('a', { tags: [1] })] }],
    ['too many existing sections', { ...valid(), existing: Array.from({ length: MAX_EXISTING_SECTIONS + 1 }, (_, i) => ({ id: `s${i}`, label: 'L' })) }],
    ['an existing section without a label', { ...valid(), existing: [{ id: 's1', label: '' }] }],
    ['existing that is not a list', { ...valid(), existing: 'Food' }],
  ])('rejects %s with 400', (_label, body) => {
    const { next, res } = run(body);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
