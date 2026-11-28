import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Memory } from '../types';

vi.mock('./proxyService', () => ({ postProxy: vi.fn() }));
vi.mock('./geminiService', () => ({ embedTexts: vi.fn() }));
vi.mock('./assistantAttachments', () => ({ readAttachment: vi.fn() }));

import { postProxy } from './proxyService';
import { embedTexts } from './geminiService';
import { readAttachment } from './assistantAttachments';
import { AssistantCancelledError, buildHistory, MAX_ASSISTANT_STEPS, MAX_ATTACHMENT_READS, MAX_HISTORY_TURNS, runAssistantTurn } from './assistantService';

const post = vi.mocked(postProxy);
const embed = vi.mocked(embedTexts);
const readFile = vi.mocked(readAttachment);

const note = (id: string, content: string, extra: Partial<Memory> = {}): Memory => ({
  id, timestamp: new Date(2026, 2, 10, 12).getTime(), content, tags: [], ...extra,
});
const notes = [
  note('n1', 'Priya says try Ichiran ramen in Shibuya'),
  note('n2', 'Flight to Tokyo confirmed, seat 14A'),
  note('gone', 'Deleted ramen note', { isDeleted: true }),
];
const bodyOf = (call: number) => post.mock.calls[call][1] as any;

beforeEach(() => {
  post.mockReset();
  embed.mockReset();
  readFile.mockReset();
  embed.mockResolvedValue([]); // no query vector: keyword-only search
});

describe('buildHistory', () => {
  it('keeps complete exchanges, newest last, within the turn limit', () => {
    const turns = Array.from({ length: 10 }, (_, i) => [
      { role: 'user' as const, text: `q${i}` },
      { role: 'model' as const, text: `a${i}` },
    ]).flat();
    const history = buildHistory([...turns, { role: 'user', text: 'unanswered' }]);
    expect(history).toHaveLength(MAX_HISTORY_TURNS);
    expect(history[0]).toEqual({ role: 'user', text: 'q4' });
    expect(history[history.length - 1]).toEqual({ role: 'model', text: 'a9' });
  });
});

describe('runAssistantTurn', () => {
  it('seeds the first step with a search for the question and returns the answer', async () => {
    post.mockResolvedValueOnce({ type: 'answer', answer: 'Ichiran in Shibuya.', beyondNotes: '', sources: ['n1', 'gone', 'made-up'] });

    const out = await runAssistantTurn({ question: 'Which ramen place did Priya suggest?', history: [], memories: notes, now: new Date(2026, 10, 28) });

    expect(out).toEqual({ answer: 'Ichiran in Shibuya.', beyondNotes: '', sourceIds: ['n1'] });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('/api/assistant/step');
    const body = bodyOf(0);
    expect(body.step).toBe(1);
    expect(body.context).toEqual({ today: '2026-11-28 (Saturday)', noteCount: 2 });
    expect(body.toolResults).toHaveLength(1);
    expect(body.toolResults[0].tool).toBe('search_notes');
    expect(body.toolResults[0].result).toContain('[ID: n1]');
    expect(body.toolResults[0].result).not.toContain('gone');
  });

  it('runs requested tools locally and sends the results on the next step', async () => {
    post
      .mockResolvedValueOnce({ type: 'tools', calls: [{ tool: 'get_notes', ids: ['n2'] }] })
      .mockResolvedValueOnce({ type: 'answer', answer: 'Seat 14A.', sources: ['n2'] });
    const statuses: string[] = [];

    const out = await runAssistantTurn({ question: 'What seat am I in?', history: [], memories: notes, onStatus: s => statuses.push(s) });

    expect(out.answer).toBe('Seat 14A.');
    expect(out.sourceIds).toEqual(['n2']);
    expect(bodyOf(1).step).toBe(2);
    expect(bodyOf(1).toolResults.map((r: any) => r.tool)).toEqual(['search_notes', 'get_notes']);
    expect(bodyOf(1).toolResults[1].result).toContain('seat 14A');
    expect(statuses).toEqual(['Searching your notes…', 'Thinking…', 'Reading a note…', 'Putting it together…']);
  });

  it('re-reads notes cited by the previous answer for follow-ups', async () => {
    post.mockResolvedValueOnce({ type: 'answer', answer: 'Yes.', sources: [] });
    await runAssistantTurn({
      question: 'And when should I go?',
      history: [{ role: 'user', text: 'ramen?' }, { role: 'model', text: 'Ichiran.' }],
      memories: notes,
      previousSourceIds: ['n1', 'gone'],
    });
    const body = bodyOf(0);
    expect(body.history).toEqual([{ role: 'user', text: 'ramen?' }, { role: 'model', text: 'Ichiran.' }]);
    expect(body.toolResults.map((r: any) => `${r.tool}:${r.args}`)).toContain('get_notes:n1');
  });

  it('opens attachments through read_attachment, up to a per-question limit', async () => {
    const open = { tool: 'read_attachment', noteId: 'n1', attachment: 'menu.pdf', query: 'prices' };
    post
      .mockResolvedValueOnce({ type: 'tools', calls: [open, open] })
      .mockResolvedValueOnce({ type: 'tools', calls: [open, open] })
      .mockResolvedValueOnce({ type: 'answer', answer: 'Ramen is 980 yen.', sources: ['n1'] });
    readFile.mockResolvedValue({ tool: 'read_attachment', args: 'n1, "menu.pdf"', result: 'FILE: menu.pdf\nRamen 980 yen' });

    const out = await runAssistantTurn({ question: 'How much is the ramen?', history: [], memories: notes });

    expect(out.answer).toBe('Ramen is 980 yen.');
    expect(readFile).toHaveBeenCalledTimes(MAX_ATTACHMENT_READS);
    const sent = bodyOf(2).toolResults.filter((r: any) => r.tool === 'read_attachment');
    expect(sent).toHaveLength(4);
    expect(sent[0].result).toContain('Ramen 980 yen');
    expect(sent[3].result).toContain('No more files can be opened');
  });

  it('never runs more than the maximum number of steps', async () => {
    post.mockResolvedValue({ type: 'tools', calls: [{ tool: 'search_notes', query: 'more' }] });
    await expect(runAssistantTurn({ question: 'loop', history: [], memories: notes })).rejects.toThrow('did not produce an answer');
    expect(post).toHaveBeenCalledTimes(MAX_ASSISTANT_STEPS);
  });

  it('throws a cancellation error when aborted mid-step', async () => {
    const controller = new AbortController();
    post.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error('Request timed out');
    });
    await expect(runAssistantTurn({ question: 'q', history: [], memories: notes, signal: controller.signal }))
      .rejects.toBeInstanceOf(AssistantCancelledError);
  });

  it('surfaces a failed step', async () => {
    post.mockRejectedValueOnce(new Error('Proxy error 502: nope'));
    await expect(runAssistantTurn({ question: 'q', history: [], memories: notes })).rejects.toThrow('502');
  });
});
