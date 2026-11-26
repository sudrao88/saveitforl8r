/**
 * momentAiSections.ts
 *
 * Sections of a moment proposed by the server model, and the rules for when
 * to ask for them. Calls are kept to a minimum:
 *
 *  - Nothing is asked when a moment is created; only when it is opened.
 *  - A moment with enough notes and no sections asks once. The answer is
 *    stored on the moment (and synced), even when it is "no worthwhile split",
 *    so no device asks again until the moment has grown.
 *  - A moment with sections asks again only when the notes outside every
 *    section are many (more than MAX_OTHER_NOTES and more than
 *    MIN_OTHER_SHARE of the moment) AND more than were left over last time.
 *    That request sends just those notes and the existing sections, which are
 *    kept: the model can place the notes in them or add sections.
 *
 * Between calls the device places notes itself. A note the model saw stays
 * where the model put it. A note saved later joins the section it clearly
 * sits with by embedding (the same rule the on-device lenses use), or waits
 * in "Other". Notes without an embedding yet are shown in "Other" but never
 * counted towards asking again.
 *
 * Everything here is pure; hooks/useMoments.ts does the calling and saving.
 */

import { Memory, Moment, MomentAiSection, MomentAiSections } from '../types';
import { MomentMatch, noteVector } from './momentMatching';
import { adoptIntoGroups, MomentSection, MIN_SECTIONED_NOTES, OTHER_SECTION_KEY } from './momentSections';
import { noteTitle, noteSnippet } from './noteLabels';

/** Mirrors MAX_AI_SECTIONS in server/lib/momentSections.js. */
export const MAX_AI_SECTIONS = 6;
/** Mirrors MAX_SECTION_NOTES in server/middleware/validation.js. */
export const MAX_SECTION_REQUEST_NOTES = 60;
/** Sections are extended only when more notes than this sit outside them... */
export const MAX_OTHER_NOTES = 4;
/** ...and they are more than this share of the moment. */
export const MIN_OTHER_SHARE = 0.15;
/** After "no worthwhile split", ask again once the moment has this many more notes. */
export const RETRY_GROWTH = 3;

const MAX_CARD_TITLE = 120;
const MAX_CARD_SUMMARY = 300;
const MAX_CARD_TYPE = 80;
const MAX_CARD_TAGS = 8;
const MAX_CARD_TAG_LEN = 40;

/** What the server is told about one note. */
export interface SectionNoteCard {
  id: string;
  title: string;
  summary?: string;
  type?: string;
  tags?: string[];
}

export interface SectionRequest {
  title: string;
  notes: SectionNoteCard[];
  existing?: MomentAiSection[];
}

/** One section in the server's answer; `id` is set for an existing section. */
export interface SectionResult {
  id?: string;
  label: string;
  description: string;
  noteIds: string[];
}

export interface SectionPlan {
  mode: 'create' | 'extend';
  /** The notes to send, best match first. */
  notes: Memory[];
  /** Sections the moment already has (extend only). */
  existing: MomentAiSection[];
}

export interface AiSectionLayout {
  /** Named sections in stored order, then "Other" if any note is outside them. */
  sections: MomentSection[];
  /** Notes outside every section that count towards asking again. */
  countedOther: string[];
}

const clip = (s: unknown, max: number): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const noteCard = (m: Memory): SectionNoteCard => {
  const e = m.enrichment;
  const card: SectionNoteCard = { id: m.id, title: clip(noteTitle(m), MAX_CARD_TITLE) || 'Untitled note' };
  const summary = clip(e?.summary && e.summary !== noteTitle(m) ? e.summary : noteSnippet(m), MAX_CARD_SUMMARY);
  if (summary) card.summary = summary;
  const type = clip(
    [e?.entityContext?.type, e?.entityContext?.subtitle, e?.contentType ? String(e.contentType).replace(/_/g, ' ') : '']
      .filter(Boolean)
      .join(', '),
    MAX_CARD_TYPE,
  );
  if (type) card.type = type;
  const tags = [...new Set([...(m.tags || []), ...(e?.suggestedTags || [])].map(t => clip(t, MAX_CARD_TAG_LEN)))]
    .filter(Boolean)
    .slice(0, MAX_CARD_TAGS);
  if (tags.length) card.tags = tags;
  return card;
};

const liveNotes = (matches: MomentMatch[], byId: ReadonlyMap<string, Memory>): Memory[] => {
  const out: Memory[] = [];
  for (const match of matches) {
    const m = byId.get(match.id);
    if (m && !m.isDeleted) out.push(m);
  }
  return out;
};

/**
 * Where every note of the moment goes under the given sections: index into
 * `ai.sections`, or -1 for none. `counted` holds the unplaced notes that count
 * towards asking again (it leaves out notes with no embedding yet).
 */
const placeNotes = (ai: MomentAiSections, notes: Memory[]): { place: Map<string, number>; counted: string[] } => {
  const indexOf = new Map(ai.sections.map((s, i) => [s.id, i]));
  const place = new Map<string, number>();
  const groups: string[][] = ai.sections.map(() => []);
  const unseen: string[] = [];
  const counted: string[] = [];

  for (const m of notes) {
    const sectionId = ai.assigned[m.id];
    const index = sectionId ? indexOf.get(sectionId) : undefined;
    if (index !== undefined) {
      place.set(m.id, index);
      groups[index].push(m.id);
    } else if (sectionId === '') {
      // The model saw it and it fit nowhere.
      place.set(m.id, -1);
      counted.push(m.id);
    } else {
      unseen.push(m.id);
    }
  }

  const adopted = adoptIntoGroups(groups, unseen, notes);
  const byId = new Map(notes.map(m => [m.id, m]));
  for (const id of unseen) {
    const index = adopted.get(id);
    place.set(id, index ?? -1);
    if (index === undefined && noteVector(byId.get(id)!)) counted.push(id);
  }
  return { place, counted };
};

/**
 * The moment's notes laid out under its model-made sections. Null when the
 * moment has none, or fewer than two of them still hold a note (the on-device
 * grouping is shown instead).
 */
export const layoutAiSections = (
  moment: Moment,
  matches: MomentMatch[],
  byId: ReadonlyMap<string, Memory>,
): AiSectionLayout | null => {
  const ai = moment.aiSections;
  if (!ai || ai.sections.length === 0) return null;
  const notes = liveNotes(matches, byId);
  const { place, counted } = placeNotes(ai, notes);

  const sections: MomentSection[] = ai.sections
    .map((s, i) => ({ key: `ai:${s.id}`, label: s.label, noteIds: notes.filter(m => place.get(m.id) === i).map(m => m.id) }))
    .filter(s => s.noteIds.length > 0);
  if (sections.length < 2) return null;
  const other = notes.filter(m => place.get(m.id) === -1).map(m => m.id);
  if (other.length > 0) sections.push({ key: OTHER_SECTION_KEY, label: 'Other', noteIds: other });
  return { sections, countedOther: counted };
};

/** Whether opening this moment should ask the server for sections, and with what. */
export const planSectionRequest = (
  moment: Moment,
  matches: MomentMatch[],
  byId: ReadonlyMap<string, Memory>,
): SectionPlan | null => {
  const notes = liveNotes(matches, byId);
  if (notes.length < MIN_SECTIONED_NOTES) return null;
  const ai = moment.aiSections;
  const all = notes.slice(0, MAX_SECTION_REQUEST_NOTES);

  if (!ai) return { mode: 'create', notes: all, existing: [] };
  if (ai.sections.length === 0) {
    return notes.length - ai.noteCount >= RETRY_GROWTH ? { mode: 'create', notes: all, existing: [] } : null;
  }
  if (ai.sections.length >= MAX_AI_SECTIONS) return null;

  const { counted } = placeNotes(ai, notes);
  const other = counted.length;
  if (other <= MAX_OTHER_NOTES || other <= notes.length * MIN_OTHER_SHARE || other <= ai.otherCount) return null;
  const leftover = new Set(counted);
  return {
    mode: 'extend',
    notes: notes.filter(m => leftover.has(m.id)).slice(0, MAX_SECTION_REQUEST_NOTES),
    existing: ai.sections,
  };
};

export const buildSectionRequest = (moment: Moment, plan: SectionPlan): SectionRequest => ({
  title: moment.title,
  notes: plan.notes.map(noteCard),
  ...(plan.existing.length
    ? { existing: plan.existing.map(s => ({ id: s.id, label: s.label, description: s.description })) }
    : {}),
});

const defaultNewId = (): string => crypto.randomUUID().slice(0, 8);

/**
 * Fold the server's answer into the moment's stored sections. Existing
 * sections are kept, new ones appended (up to MAX_AI_SECTIONS), and every note
 * that was sent is recorded with where it went, so it is never sent again
 * unless the leftovers grow.
 */
export const applySectionResult = (
  moment: Moment,
  plan: SectionPlan,
  result: SectionResult[],
  matches: MomentMatch[],
  byId: ReadonlyMap<string, Memory>,
  now: number,
  newId: () => string = defaultNewId,
): MomentAiSections => {
  const previous = plan.mode === 'extend' ? moment.aiSections : undefined;
  const sections: MomentAiSection[] = previous ? [...previous.sections] : [];
  const known = new Set(sections.map(s => s.id));
  const sent = new Set(plan.notes.map(m => m.id));

  // Keep earlier placements of notes that still exist.
  const assigned: Record<string, string> = {};
  for (const [noteId, sectionId] of Object.entries(previous?.assigned ?? {})) {
    if (byId.has(noteId)) assigned[noteId] = sectionId;
  }
  for (const id of sent) assigned[id] = '';

  for (const r of result) {
    let sectionId = r.id && known.has(r.id) ? r.id : undefined;
    if (!sectionId) {
      const label = String(r.label ?? '').replace(/\s+/g, ' ').trim();
      if (!label || sections.length >= MAX_AI_SECTIONS) continue;
      do sectionId = newId(); while (known.has(sectionId));
      known.add(sectionId);
      sections.push({ id: sectionId, label, description: String(r.description ?? '').trim() });
    }
    for (const noteId of r.noteIds) if (sent.has(noteId) && assigned[noteId] === '') assigned[noteId] = sectionId;
  }

  const notes = liveNotes(matches, byId);
  const next: MomentAiSections = { sections, assigned, generatedAt: now, noteCount: notes.length, otherCount: 0 };
  if (sections.length === 0) next.assigned = {};
  else next.otherCount = placeNotes(next, notes).counted.length;
  return next;
};
