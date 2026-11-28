import { describe, it, expect, vi } from 'vitest';
import {
  validateAssistantStepInput,
  validateAssistantAttachmentInput,
  MAX_ASSISTANT_INLINE_ATTACHMENT_CHARS,
  MAX_ASSISTANT_HISTORY_TURNS,
  MAX_ASSISTANT_QUESTION_LENGTH,
  MAX_ASSISTANT_RESULT_LENGTH,
  MAX_ASSISTANT_RESULTS_TOTAL,
  MAX_ASSISTANT_TOOL_RESULTS,
} from './validation.js';

const run = (body) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const next = vi.fn();
  validateAssistantStepInput({ body }, res, next);
  return { res, next };
};

const result = (extra = {}) => ({ tool: 'search_notes', args: '"ramen"', result: 'No notes match this search.', ...extra });
const valid = () => ({
  question: 'Where should I eat in Tokyo?',
  history: [{ role: 'user', text: 'hi' }, { role: 'model', text: 'hello' }],
  toolResults: [result()],
  step: 2,
  context: { today: '2026-11-28 (Saturday)', noteCount: 12 },
});

describe('validateAssistantStepInput', () => {
  it('accepts a full request and a bare question', () => {
    expect(run(valid()).next).toHaveBeenCalled();
    expect(run({ question: 'hi' }).next).toHaveBeenCalled();
  });

  it.each([
    ['a missing question', { ...valid(), question: '  ' }],
    ['an oversized question', { ...valid(), question: 'x'.repeat(MAX_ASSISTANT_QUESTION_LENGTH + 1) }],
    ['a step of zero', { ...valid(), step: 0 }],
    ['a step past the limit', { ...valid(), step: 5 }],
    ['a non-integer step', { ...valid(), step: 1.5 }],
    ['non-array history', { ...valid(), history: 'hi' }],
    ['too many history turns', { ...valid(), history: Array.from({ length: MAX_ASSISTANT_HISTORY_TURNS + 1 }, () => ({ role: 'user', text: 'x' })) }],
    ['an unknown history role', { ...valid(), history: [{ role: 'system', text: 'x' }] }],
    ['an empty history turn', { ...valid(), history: [{ role: 'user', text: '' }] }],
    ['too many tool results', { ...valid(), toolResults: Array.from({ length: MAX_ASSISTANT_TOOL_RESULTS + 1 }, () => result()) }],
    ['an unknown tool', { ...valid(), toolResults: [result({ tool: 'delete_notes' })] }],
    ['missing args', { ...valid(), toolResults: [result({ args: undefined })] }],
    ['an oversized result', { ...valid(), toolResults: [result({ result: 'x'.repeat(MAX_ASSISTANT_RESULT_LENGTH + 1) })] }],
    ['results too long in total', {
      ...valid(),
      toolResults: Array.from({ length: Math.ceil(MAX_ASSISTANT_RESULTS_TOTAL / MAX_ASSISTANT_RESULT_LENGTH) + 1 }, () =>
        result({ result: 'x'.repeat(MAX_ASSISTANT_RESULT_LENGTH) })),
    }],
    ['a non-object context', { ...valid(), context: [] }],
    ['a negative note count', { ...valid(), context: { noteCount: -1 } }],
  ])('rejects %s', (_name, body) => {
    const { res, next } = run(body);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('validateAssistantAttachmentInput', () => {
  const runAtt = (body) => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    const next = vi.fn();
    validateAssistantAttachmentInput({ body }, res, next);
    return { res, next };
  };
  const base = () => ({ noteId: 'note-1', attachmentId: 'att-1', name: 'lease.pdf', question: 'notice period?' });
  const uploaded = () => ({
    ...base(),
    mimeType: 'application/pdf',
    fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc',
    fileName: 'files/abc',
  });

  it('accepts a Drive read, an uploaded file and small inline data', () => {
    expect(runAtt(base()).next).toHaveBeenCalled();
    expect(runAtt(uploaded()).next).toHaveBeenCalled();
    expect(runAtt({ ...base(), mimeType: 'image/png', data: 'iVBORw0KGgo=' }).next).toHaveBeenCalled();
  });

  it.each([
    ['a note id with query characters', { ...base(), noteId: "a' or 'b" }],
    ['a missing attachment id', { ...base(), attachmentId: '' }],
    ['a missing question', { ...base(), question: ' ' }],
    ['an oversized question', { ...base(), question: 'x'.repeat(501) }],
    ['a file URI outside the Gemini File API', { ...uploaded(), fileUri: 'https://evil.example/files/abc' }],
    ['a file URI without its file name', { ...uploaded(), fileName: undefined }],
    ['an uploaded file without a mime type', { ...uploaded(), mimeType: undefined }],
    ['an unsupported mime type', { ...uploaded(), mimeType: 'application/zip' }],
    ['both a file and inline data', { ...uploaded(), data: 'AAAA' }],
    ['inline data that is not base64', { ...base(), mimeType: 'image/png', data: 'data:image/png;base64,AAAA' }],
    ['oversized inline data', { ...base(), mimeType: 'image/png', data: 'A'.repeat(MAX_ASSISTANT_INLINE_ATTACHMENT_CHARS + 4) }],
  ])('rejects %s', (_name, body) => {
    const { res, next } = runAtt(body);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
