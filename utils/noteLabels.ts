import { Memory } from '../types';

const plainText = (html: string): string =>
  (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Best human-readable label for a note: AI entity title, then summary, then
 * the note content itself.
 */
export const noteTitle = (m: Memory): string =>
  m.enrichment?.entityContext?.title || m.enrichment?.summary || plainText(m.content) || 'Untitled note';

/**
 * Secondary line: the summary when the title came from the entity, otherwise
 * the note content.
 */
export const noteSnippet = (m: Memory): string => {
  if (m.enrichment?.entityContext?.title && m.enrichment.summary) return m.enrichment.summary;
  const content = plainText(m.content);
  return content === noteTitle(m) ? '' : content;
};

export const formatNoteDate = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
