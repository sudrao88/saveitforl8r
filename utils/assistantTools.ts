import { Memory } from '../types';
import { noteTitle } from './noteLabels';
import { searchNotes } from './noteSearch';

/**
 * Read-only tools the assistant can ask for. The server decides which tool to
 * call; they all run here, on the device, against the decrypted notes. Only
 * the text these functions return is sent back to the server.
 *
 * Pure and deterministic: no DOM, network or storage access.
 */

export type AssistantToolCall =
  | { tool: 'search_notes'; query: string; queryVector?: number[]; limit?: number }
  | { tool: 'get_notes'; ids: string[] }
  | { tool: 'list_notes'; after?: string; before?: string; tag?: string; type?: string; limit?: number };

export interface AssistantToolResult {
  tool: AssistantToolCall['tool'];
  /** Human-readable arguments, shown to the model next to the result. */
  args: string;
  result: string;
}

export const DEFAULT_SEARCH_LIMIT = 8;
export const MAX_SEARCH_LIMIT = 15;
export const MAX_GET_NOTES = 5;
export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 40;

const EXCERPT_LENGTH = 300;
const FULL_CONTENT_LENGTH = 6000;
const FULL_NOTE_LENGTH = 7500;
const FIELD_LENGTH = 600;

/** Mirror the server's per-result and total caps (server/middleware/validation.js). */
export const MAX_RESULT_LENGTH = 38_000;
export const MAX_RESULTS_TOTAL = 150_000;
export const MAX_TOOL_RESULTS = 12;

/** HTML note content as plain text, keeping line breaks between blocks. */
export const noteText = (html: string): string =>
  (html || '')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max).trimEnd()}…` : s);

/** Local calendar date of a timestamp as YYYY-MM-DD. */
export const localDate = (ts: number): string => {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const noteType = (m: Memory): string => {
  const type = m.enrichment?.entityContext?.type;
  if (type && type !== 'Other') return String(type);
  return m.enrichment?.contentType ? String(m.enrichment.contentType) : '';
};

const header = (m: Memory): string => {
  const type = noteType(m);
  return `[ID: ${m.id}] [DATE: ${localDate(m.timestamp)}]${type ? ` [TYPE: ${type}]` : ''}`;
};

/** Short form used for search results. */
export const noteBrief = (m: Memory): string => {
  const title = noteTitle(m);
  const lines = [header(m), `TITLE: ${clip(title, 200)}`];
  const summary = m.enrichment?.summary;
  if (summary && summary !== title) lines.push(`SUMMARY: ${clip(summary, FIELD_LENGTH)}`);
  if (m.tags?.length) lines.push(`TAGS: ${m.tags.join(', ')}`);
  const place = m.enrichment?.locationContext?.name;
  if (place) lines.push(`PLACE: ${place}`);
  const content = noteText(m.content).replace(/\n+/g, ' ');
  if (content && content !== title) lines.push(`EXCERPT: ${clip(content, EXCERPT_LENGTH)}`);
  if (m.attachments?.length) lines.push(`ATTACHMENTS: ${m.attachments.map(a => a.name).join(', ')}`);
  return lines.join('\n');
};

/** One line per note, used for listings. */
export const noteLine = (m: Memory): string => {
  const title = noteTitle(m);
  const summary = m.enrichment?.summary;
  const extra = summary && summary !== title ? ` | ${clip(summary, 140)}` : '';
  return `${header(m)} ${clip(title, 120)}${extra}`;
};

// Enrichment fields that are internal, numeric noise, or rendered separately.
const SKIPPED_FIELDS = new Set([
  'summary', 'embedding', 'embeddingModel', 'suggestedTags', 'places', 'enrichmentStrategy',
  'locationIsRelevant', 'latitude', 'longitude', 'placeId', 'mapsUri', 'audit',
]);

const label = (key: string): string => key.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();

const fieldLines = (obj: Record<string, unknown>, prefix = ''): string[] => {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (SKIPPED_FIELDS.has(key) || value === null || value === undefined || value === '') continue;
    const name = `${prefix}${label(key)}`;
    if (typeof value === 'string') {
      lines.push(`${name}: ${clip(value, FIELD_LENGTH)}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${name}: ${value}`);
    } else if (Array.isArray(value)) {
      const items = value.filter(v => typeof v === 'string' && v) as string[];
      if (items.length > 0) lines.push(`${name}: ${clip(items.join('; '), FIELD_LENGTH * 2)}`);
    } else if (typeof value === 'object' && !prefix) {
      // One level of nesting (locationContext, entityContext, temporalContext).
      lines.push(...fieldLines(value as Record<string, unknown>, `${name}.`));
    }
  }
  return lines;
};

/** Everything the app knows about a note, as text. */
export const noteFull = (m: Memory): string => {
  const lines = [header(m), `TITLE: ${clip(noteTitle(m), 200)}`];
  if (m.tags?.length) lines.push(`TAGS: ${m.tags.join(', ')}`);
  if (m.attachments?.length) lines.push(`ATTACHMENTS: ${m.attachments.map(a => a.name).join(', ')}`);
  const content = noteText(m.content);
  if (content) lines.push(`CONTENT:\n${clip(content, FULL_CONTENT_LENGTH)}`);
  if (m.enrichment) {
    if (m.enrichment.summary) lines.push(`SUMMARY: ${clip(m.enrichment.summary, FIELD_LENGTH)}`);
    lines.push(...fieldLines(m.enrichment));
  }
  return clip(lines.join('\n'), FULL_NOTE_LENGTH);
};

const clampLimit = (value: number | undefined, fallback: number, max: number): number =>
  Number.isInteger(value) && (value as number) > 0 ? Math.min(value as number, max) : fallback;

const SEPARATOR = '\n---\n';

const runSearch = (call: Extract<AssistantToolCall, { tool: 'search_notes' }>, memories: Memory[]): AssistantToolResult => {
  const limit = clampLimit(call.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
  const byId = new Map(memories.map(m => [m.id, m]));
  const hits = searchNotes(memories, call.query, call.queryVector)
    .map(r => byId.get(r.id))
    .filter((m): m is Memory => !!m);
  const shown = hits.slice(0, limit);
  const result = shown.length === 0
    ? 'No notes match this search.'
    : `${hits.length} matching ${hits.length === 1 ? 'note' : 'notes'}, showing the top ${shown.length}:${SEPARATOR}${shown.map(noteBrief).join(SEPARATOR)}`;
  return { tool: 'search_notes', args: JSON.stringify(call.query), result };
};

const runGet = (call: Extract<AssistantToolCall, { tool: 'get_notes' }>, memories: Memory[]): AssistantToolResult => {
  const ids = Array.from(new Set(call.ids)).slice(0, MAX_GET_NOTES);
  const byId = new Map(memories.map(m => [m.id, m]));
  const parts = ids.map(id => {
    const m = byId.get(id);
    return m ? noteFull(m) : `[ID: ${id}] No note has this ID.`;
  });
  return { tool: 'get_notes', args: ids.join(', '), result: parts.join(SEPARATOR) || 'No note IDs given.' };
};

const matchesFilter = (candidates: string[], wanted: string): boolean => {
  const w = wanted.trim().toLowerCase();
  if (!w) return true;
  return candidates.some(c => {
    const v = c.toLowerCase();
    return v === w || v.includes(w) || w.includes(v);
  });
};

const runList = (call: Extract<AssistantToolCall, { tool: 'list_notes' }>, memories: Memory[]): AssistantToolResult => {
  const limit = clampLimit(call.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const matched = memories
    .filter(m => {
      const date = localDate(m.timestamp);
      if (call.after && date < call.after) return false;
      if (call.before && date > call.before) return false;
      if (call.tag && !matchesFilter(m.tags || [], call.tag)) return false;
      if (call.type) {
        const types = [m.enrichment?.entityContext?.type, m.enrichment?.contentType]
          .filter((t): t is string => typeof t === 'string' && !!t)
          .map(t => t.replace(/_/g, ' '));
        if (!matchesFilter(types, call.type.replace(/_/g, ' '))) return false;
      }
      return true;
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  const shown = matched.slice(0, limit);
  const args = [
    call.after ? `after=${call.after}` : null,
    call.before ? `before=${call.before}` : null,
    call.tag ? `tag=${call.tag}` : null,
    call.type ? `type=${call.type}` : null,
  ].filter(Boolean).join(', ') || 'all notes';

  const result = matched.length === 0
    ? 'No notes match these filters.'
    : `${matched.length} matching ${matched.length === 1 ? 'note' : 'notes'}, showing the newest ${shown.length}:\n${shown.map(noteLine).join('\n')}`;
  return { tool: 'list_notes', args, result };
};

/** Run one tool call against the user's notes. */
export const runAssistantTool = (call: AssistantToolCall, memories: Memory[]): AssistantToolResult => {
  const live = memories.filter(m => !m.isDeleted && !m.isDeleting);
  const out =
    call.tool === 'search_notes' ? runSearch(call, live)
    : call.tool === 'get_notes' ? runGet(call, live)
    : runList(call, live);
  return { ...out, result: clip(out.result, MAX_RESULT_LENGTH) };
};

/**
 * Append a result while keeping the whole set inside the server's limits. A
 * result that would overflow the total is shortened; once the count or the
 * budget is used up, further results are dropped.
 */
export const appendToolResult = (results: AssistantToolResult[], next: AssistantToolResult): AssistantToolResult[] => {
  if (results.length >= MAX_TOOL_RESULTS) return results;
  const used = results.reduce((sum, r) => sum + r.result.length, 0);
  const room = MAX_RESULTS_TOTAL - used;
  if (room < 200) return results;
  return [...results, next.result.length > room ? { ...next, result: clip(next.result, room - 1) } : next];
};

/** A short, user-facing description of what a tool call is doing. */
export const describeToolCall = (call: AssistantToolCall): string => {
  if (call.tool === 'search_notes') return `Searching notes for “${clip(call.query, 40)}”…`;
  if (call.tool === 'get_notes') return call.ids.length === 1 ? 'Reading a note…' : `Reading ${call.ids.length} notes…`;
  return 'Looking through your notes…';
};
