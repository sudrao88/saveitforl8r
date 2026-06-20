import { SynthesisResponse } from '../types';

/**
 * Filter a synthesis to a moment's current note set.
 *
 * Web-sourced items (sourceType === 'web') have no note home, so they are kept
 * unconditionally; note-sourced items are dropped when their note has left the
 * moment. Sections that end up empty are removed, and generatedFrom is pruned to
 * the surviving note ids.
 *
 * Shared by loadSynthesis (useMoments) and the recovery/polling path
 * (useMomentCreationPolling) so the two never drift.
 */
export const filterSynthesisToNotes = (
  raw: SynthesisResponse,
  noteIdSet: Set<string>,
): SynthesisResponse => ({
  ...raw,
  sections: raw.sections
    .map(section => ({
      ...section,
      items: section.items.filter(item =>
        item.sourceType === 'web' || noteIdSet.has(item.sourceNoteId ?? '')
      ),
    }))
    .filter(section => section.items.length > 0),
  generatedFrom: raw.generatedFrom.filter(id => noteIdSet.has(id)),
});
