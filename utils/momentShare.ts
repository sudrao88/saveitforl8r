/**
 * momentShare.ts
 *
 * Formats a moment and its matching notes as a plain-text note for sharing
 * (system share sheet or clipboard). Plain text with light structure — a
 * header, a numbered list, indented details — reads well in any target app
 * (messaging, email, notes) without relying on markdown rendering.
 */

import { Memory, Moment } from '../types';
import { noteTitle, formatNoteDate } from './noteLabels';

const FALLBACK_EMOJI = '✨';
const MAX_SNIPPET = 280;

const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * Note HTML → plain lines: list items become "• item" / "☐ item", block
 * elements become line breaks, everything else is stripped.
 */
export const htmlToShareLines = (html: string): string[] => {
  const text = decodeEntities(
    (html || '')
      .replace(/<li[^>]*data-checked="true"[^>]*>/gi, '\n☑ ')
      .replace(/<li[^>]*data-checked="false"[^>]*>/gi, '\n☐ ')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|blockquote|pre|tr|ul|ol)>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  );
  return text
    .split('\n')
    .map(l => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
};

const truncate = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;

const noteLink = (m: Memory): string | undefined => {
  if (m.enrichment?.sourceUrl) return m.enrichment.sourceUrl;
  const loc = m.enrichment?.locationContext;
  if (loc?.website) return loc.website;
  if (loc?.mapsUri) return loc.mapsUri;
  return m.content.match(/https?:\/\/[^\s<>"']+/i)?.[0];
};

const formatNote = (m: Memory, index: number): string => {
  const title = noteTitle(m).replace(/\s+/g, ' ').trim();
  const lines = [`${index + 1}. ${truncate(title, 120)}`];

  // Body: the note's own text (keeps its list structure), else the summary.
  const body = htmlToShareLines(m.content).filter(l => l !== title);
  const summary = m.enrichment?.summary;
  const detail = body.length > 0
    ? body
    : summary && summary !== title ? [summary] : [];
  let used = 0;
  for (const line of detail) {
    if (used >= MAX_SNIPPET) {
      lines.push('   …');
      break;
    }
    const clipped = truncate(line, MAX_SNIPPET - used);
    lines.push(`   ${clipped}`);
    used += clipped.length;
  }

  const meta: string[] = [];
  const place = m.enrichment?.locationIsRelevant !== false ? m.enrichment?.locationContext?.name : undefined;
  if (place) meta.push(`📍 ${place}`);
  meta.push(`🗓 ${formatNoteDate(m.timestamp)}`);
  lines.push(`   ${meta.join(' · ')}`);

  const link = noteLink(m);
  if (link) lines.push(`   🔗 ${link}`);

  return lines.join('\n');
};

/** Title used for the share sheet. */
export const momentShareTitle = (moment: Moment): string =>
  `${moment.emoji || FALLBACK_EMOJI} ${moment.title}`;

/** Full shareable text for a moment and its notes (in the given order). */
export const formatMomentForShare = (moment: Moment, notes: Memory[]): string => {
  const parts: string[] = [momentShareTitle(moment)];

  const terms = moment.terms.filter(t => t.trim() && t.trim() !== moment.title.trim());
  if (terms.length > 0) parts.push(terms.join(' · '));

  const count = notes.length;
  parts.push(`${count} ${count === 1 ? 'note' : 'notes'}`);

  const header = parts.join('\n');
  const body = count > 0 ? notes.map(formatNote).join('\n\n') : 'No notes yet.';

  return `${header}\n${'─'.repeat(16)}\n\n${body}\n\n— Shared from SaveItForL8R`;
};
