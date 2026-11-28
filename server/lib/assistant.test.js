import { describe, it, expect } from 'vitest';
import {
  buildAssistantContents,
  normalizeAssistantHistory,
  normalizeAssistantStep,
  normalizeAttachmentText,
  buildAttachmentContents,
  FALLBACK_ANSWER,
  MAX_ASSISTANT_STEPS,
  MAX_CALLS_PER_STEP,
  MAX_GET_NOTE_IDS,
} from './assistant.js';

describe('normalizeAssistantHistory', () => {
  it('keeps only complete user → model exchanges', () => {
    const history = [
      { role: 'model', text: 'stray' },
      { role: 'user', text: 'q1' },
      { role: 'user', text: 'q2 (q1 failed)' },
      { role: 'model', text: 'a2' },
      { role: 'user', text: 'unanswered' },
    ];
    expect(normalizeAssistantHistory(history)).toEqual([
      { role: 'user', text: 'q2 (q1 failed)' },
      { role: 'model', text: 'a2' },
    ]);
  });

  it('tolerates missing history', () => {
    expect(normalizeAssistantHistory(undefined)).toEqual([]);
  });
});

describe('buildAssistantContents', () => {
  it('puts the question, context and tool results in the last user turn', () => {
    const contents = buildAssistantContents({
      question: 'Where did Priya suggest eating?',
      history: [{ role: 'user', text: 'hi' }, { role: 'model', text: 'hello' }],
      toolResults: [{ tool: 'search_notes', args: '"priya"', result: '[ID: n1] Dinner tips' }],
      step: 2,
      context: { today: '2026-11-28 (Saturday)', noteCount: 42 },
    });
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(JSON.parse(contents[1].parts[0].text)).toEqual({ calls: [], answer: 'hello', sources: [] });
    const last = contents[2].parts[0].text;
    expect(last).toContain('TODAY: 2026-11-28 (Saturday)');
    expect(last).toContain('The user has 42 notes.');
    expect(last).toContain(`STEP 2 of ${MAX_ASSISTANT_STEPS}`);
    expect(last).not.toContain('FINAL STEP');
    expect(last).toContain('QUESTION:\nWhere did Priya suggest eating?');
    expect(last).toContain('### search_notes("priya")\n[ID: n1] Dinner tips');
  });

  it('marks the final step and strips control characters', () => {
    const [only] = buildAssistantContents({ question: 'a\u0000b', step: MAX_ASSISTANT_STEPS });
    expect(only.parts[0].text).toContain('FINAL STEP');
    expect(only.parts[0].text).toContain('QUESTION:\nab');
    expect(only.parts[0].text).toContain('(nothing yet)');
  });
});

describe('normalizeAssistantStep', () => {
  it('returns valid tool calls and drops invalid ones', () => {
    const out = normalizeAssistantStep({
      calls: [
        { tool: 'search_notes', query: ' <b>ramen</b> tokyo ', limit: 500 },
        { tool: 'search_notes', query: '' },
        { tool: 'delete_notes', ids: ['x'] },
        { tool: 'get_notes', ids: ['a', 'a', 7, 'b'] },
        { tool: 'list_notes', after: '2026-03-01', before: 'last week', tag: 'travel' },
      ],
      answer: '',
      sources: [],
    });
    expect(out).toEqual({
      type: 'tools',
      calls: [
        { tool: 'search_notes', query: 'ramen tokyo', limit: 50 },
        { tool: 'get_notes', ids: ['a', 'b'] },
        { tool: 'list_notes', after: '2026-03-01', tag: 'travel' },
      ],
    });
  });

  it('caps calls per step and ids per get_notes', () => {
    const calls = Array.from({ length: 6 }, (_, i) => ({ tool: 'search_notes', query: `q${i}` }));
    expect(normalizeAssistantStep({ calls }).calls).toHaveLength(MAX_CALLS_PER_STEP);
    const ids = Array.from({ length: 9 }, (_, i) => `n${i}`);
    expect(normalizeAssistantStep({ calls: [{ tool: 'get_notes', ids }] }).calls[0].ids).toHaveLength(MAX_GET_NOTE_IDS);
  });

  it('returns a sanitized answer with deduplicated sources', () => {
    const out = normalizeAssistantStep({
      calls: [],
      answer: 'Priya suggested <script>x</script>Ichiran.',
      beyondNotes: 'Ichiran is a ramen chain.',
      sources: ['n1', 'n1', 3, 'n2'],
    });
    expect(out).toEqual({
      type: 'answer',
      answer: 'Priya suggested xIchiran.',
      beyondNotes: 'Ichiran is a ramen chain.',
      sources: ['n1', 'n2'],
    });
  });

  it('ignores tool requests on the final step so the loop terminates', () => {
    const out = normalizeAssistantStep(
      { calls: [{ tool: 'search_notes', query: 'more' }], answer: 'Best I have.', sources: [] },
      { step: MAX_ASSISTANT_STEPS },
    );
    expect(out).toEqual({ type: 'answer', answer: 'Best I have.', beyondNotes: '', sources: [] });
  });

  it('falls back to a fixed answer when the model returns nothing usable', () => {
    for (const parsed of [null, {}, { calls: [{ tool: 'nope' }], answer: '' }, { calls: 'x', answer: 5 }]) {
      expect(normalizeAssistantStep(parsed)).toEqual({ type: 'answer', answer: FALLBACK_ANSWER, beyondNotes: '', sources: [] });
    }
  });
});

describe('read_attachment', () => {
  it('is a valid tool call with a default question', () => {
    const out = normalizeAssistantStep({
      calls: [
        { tool: 'read_attachment', noteId: 'n1', attachment: 'lease.pdf', query: 'termination clause' },
        { tool: 'read_attachment', noteId: 'n2', attachment: 'scan.png' },
        { tool: 'read_attachment', attachment: 'orphan.pdf' },
      ],
    });
    expect(out.calls).toEqual([
      { tool: 'read_attachment', noteId: 'n1', attachment: 'lease.pdf', query: 'termination clause' },
      { tool: 'read_attachment', noteId: 'n2', attachment: 'scan.png', query: 'Summarize the key contents of this file.' },
    ]);
  });

  it('builds the reading request with the file before the question', () => {
    const filePart = { inlineData: { data: 'AAAA', mimeType: 'application/pdf' } };
    const [turn] = buildAttachmentContents({ filePart, fileName: 'lease.pdf', question: 'notice period?' });
    expect(turn.parts[0]).toBe(filePart);
    expect(turn.parts[1].text).toBe('FILE NAME: lease.pdf\n\nQUESTION:\nnotice period?');
  });

  it('sanitizes what the model read', () => {
    expect(normalizeAttachmentText('Notice is <b>60 days</b>.')).toBe('Notice is 60 days.');
    expect(normalizeAttachmentText(undefined)).toBe('The file could not be read.');
  });
});
