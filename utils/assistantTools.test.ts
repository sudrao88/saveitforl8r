import { describe, it, expect } from 'vitest';
import { Memory } from '../types';
import {
  appendToolResult,
  AssistantToolResult,
  describeToolCall,
  localDate,
  MAX_GET_NOTES,
  MAX_RESULTS_TOTAL,
  MAX_TOOL_RESULTS,
  noteBrief,
  noteFull,
  noteText,
  runAssistantTool,
} from './assistantTools';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();

const note = (id: string, content: string, extra: Partial<Memory> = {}): Memory => ({
  id,
  timestamp: at(2026, 3, 10),
  content,
  tags: [],
  ...extra,
});

const ramen = note('n1', '<p>Priya says try <b>Ichiran</b> in Shibuya</p><p>Go before 6pm</p>', {
  tags: ['japan', 'food'],
  enrichment: {
    summary: 'Ramen recommendation from Priya',
    suggestedTags: [],
    entityContext: { type: 'Restaurant', title: 'Ichiran Shibuya' },
    locationContext: { name: 'Ichiran', latitude: 35.6, longitude: 139.7, placeId: 'abc' },
    keyPoints: ['Go before 6pm', 'Solo booths'],
    embedding: [0.1, 0.2],
  } as Memory['enrichment'],
  attachments: [{ name: 'menu.pdf' } as any],
});
const flight = note('n2', 'Flight to Tokyo confirmed, seat 14A', { timestamp: at(2026, 5, 2), tags: ['travel'] });
const recipe = note('n3', 'Dal tadka with extra garlic', {
  timestamp: at(2026, 5, 20),
  enrichment: { summary: 'Dal recipe', suggestedTags: [], contentType: 'recipe' } as Memory['enrichment'],
});
const deleted = note('n4', 'Old ramen note', { isDeleted: true });
const notes = [ramen, flight, recipe, deleted];

describe('noteText', () => {
  it('strips tags, decodes entities and keeps block breaks', () => {
    expect(noteText('<p>Tom &amp; Jerry</p><ul><li>one</li><li>two</li></ul>')).toBe('Tom & Jerry\none\ntwo');
  });
});

describe('note rendering', () => {
  it('gives a brief with id, date, type, tags and an excerpt', () => {
    const brief = noteBrief(ramen);
    expect(brief).toContain(`[ID: n1] [DATE: ${localDate(ramen.timestamp)}] [TYPE: Restaurant]`);
    expect(brief).toContain('TITLE: Ichiran Shibuya');
    expect(brief).toContain('SUMMARY: Ramen recommendation from Priya');
    expect(brief).toContain('TAGS: japan, food');
    expect(brief).toContain('EXCERPT: Priya says try Ichiran in Shibuya Go before 6pm');
    expect(brief).toContain('ATTACHMENTS: menu.pdf');
  });

  it('gives the full note with enrichment fields but no vectors or coordinates', () => {
    const full = noteFull(ramen);
    expect(full).toContain('CONTENT:\nPriya says try Ichiran in Shibuya\nGo before 6pm');
    expect(full).toContain('KEY_POINTS: Go before 6pm; Solo booths');
    expect(full).toContain('LOCATION_CONTEXT.NAME: Ichiran');
    expect(full).not.toMatch(/EMBEDDING|LATITUDE|PLACE_ID|0\.1/);
  });
});

describe('runAssistantTool', () => {
  it('search_notes returns matching live notes as briefs', () => {
    const out = runAssistantTool({ tool: 'search_notes', query: 'ramen' }, notes);
    expect(out.tool).toBe('search_notes');
    expect(out.args).toBe('"ramen"');
    expect(out.result).toContain('[ID: n1]');
    expect(out.result).not.toContain('n4');
  });

  it('search_notes says so when nothing matches', () => {
    expect(runAssistantTool({ tool: 'search_notes', query: 'zeppelin' }, notes).result).toBe('No notes match this search.');
  });

  it('get_notes returns full notes and flags unknown or deleted ids', () => {
    const out = runAssistantTool({ tool: 'get_notes', ids: ['n2', 'nope', 'n4'] }, notes);
    expect(out.result).toContain('CONTENT:\nFlight to Tokyo confirmed, seat 14A');
    expect(out.result).toContain('[ID: nope] No note has this ID.');
    expect(out.result).toContain('[ID: n4] No note has this ID.');
  });

  it('get_notes reads at most MAX_GET_NOTES notes', () => {
    const many = Array.from({ length: MAX_GET_NOTES + 3 }, (_, i) => note(`m${i}`, `note ${i}`));
    const out = runAssistantTool({ tool: 'get_notes', ids: many.map(m => m.id) }, many);
    expect(out.result.split('\n---\n')).toHaveLength(MAX_GET_NOTES);
  });

  it('list_notes filters by date range, newest first', () => {
    const out = runAssistantTool({ tool: 'list_notes', after: '2026-05-01', before: '2026-05-31' }, notes);
    expect(out.args).toBe('after=2026-05-01, before=2026-05-31');
    expect(out.result).toContain('2 matching notes');
    expect(out.result.indexOf('n3')).toBeLessThan(out.result.indexOf('n2'));
    expect(out.result).not.toContain('n1');
  });

  it('list_notes filters by tag and by type', () => {
    expect(runAssistantTool({ tool: 'list_notes', tag: 'Travel' }, notes).result).toContain('[ID: n2]');
    const byType = runAssistantTool({ tool: 'list_notes', type: 'recipes' }, notes).result;
    expect(byType).toContain('1 matching note,');
    expect(byType).toContain('[ID: n3]');
  });

  it('list_notes reports the total when the limit hides some', () => {
    const out = runAssistantTool({ tool: 'list_notes', limit: 1 }, notes);
    expect(out.args).toBe('all notes');
    expect(out.result).toContain('3 matching notes, showing the newest 1');
  });
});

describe('appendToolResult', () => {
  const big = (n: number): AssistantToolResult => ({ tool: 'get_notes', args: 'x', result: 'x'.repeat(n) });

  it('shortens a result that would overflow the total and then stops adding', () => {
    let results = appendToolResult([], big(MAX_RESULTS_TOTAL - 1000));
    results = appendToolResult(results, big(5000));
    expect(results).toHaveLength(2);
    expect(results.reduce((n, r) => n + r.result.length, 0)).toBeLessThanOrEqual(MAX_RESULTS_TOTAL);
    expect(appendToolResult(results, big(10))).toHaveLength(2);
  });

  it('stops at the maximum number of results', () => {
    let results: AssistantToolResult[] = [];
    for (let i = 0; i < MAX_TOOL_RESULTS + 3; i++) results = appendToolResult(results, big(10));
    expect(results).toHaveLength(MAX_TOOL_RESULTS);
  });
});

describe('describeToolCall', () => {
  it('describes each tool for the progress line', () => {
    expect(describeToolCall({ tool: 'search_notes', query: 'ramen' })).toBe('Searching notes for “ramen”…');
    expect(describeToolCall({ tool: 'get_notes', ids: ['a'] })).toBe('Reading a note…');
    expect(describeToolCall({ tool: 'get_notes', ids: ['a', 'b'] })).toBe('Reading 2 notes…');
    expect(describeToolCall({ tool: 'list_notes' })).toBe('Looking through your notes…');
  });
});
