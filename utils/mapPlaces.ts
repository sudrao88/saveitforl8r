/**
 * mapPlaces.ts
 *
 * Collects the Google Maps places (those with a grounded placeId) that a note
 * or a set of notes mentions, for rendering on the in-app map. Coordinates are
 * not stored: the map resolves each placeId to a position when it renders.
 */

import { Memory } from '../types';
import { noteTitle } from './noteLabels';
import { MomentSection, OTHER_SECTION_KEY } from './momentSections';

export interface MapPlace {
  placeId: string;
  name: string;
  address?: string;
  /** Link that opens this exact place in Google Maps. */
  mapsUri: string;
  /** Notes that mention this place (set when collecting across notes). */
  noteTitles?: string[];
  /** Ids of those notes, in the order the notes were given. */
  noteIds?: string[];
  /** The subsection this place's pin belongs to (moments only). */
  category?: MapCategory;
}

export interface MapCategory {
  key: string;
  label: string;
  /** Position in the moment's sections, for the pin colour; -1 for "Other". */
  index: number;
}

const placeUri = (name: string, placeId: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${encodeURIComponent(placeId)}`;

/** Every grounded place a note mentions, in order, without duplicates. */
export const notePlaces = (memory: Memory): MapPlace[] => {
  const e = memory.enrichment;
  if (!e) return [];
  const out: MapPlace[] = [];
  const seen = new Set<string>();
  const add = (p?: { name?: string; address?: string; placeId?: string; mapsUri?: string }) => {
    if (!p?.placeId || !p.name || seen.has(p.placeId)) return;
    seen.add(p.placeId);
    out.push({
      placeId: p.placeId,
      name: p.name,
      address: p.address,
      mapsUri: p.mapsUri || placeUri(p.name, p.placeId),
    });
  };
  for (const p of e.places ?? []) add(p);
  if (e.locationIsRelevant !== false) add(e.locationContext);
  return out;
};

/** Places across several notes, one entry per place, in note order. */
export const collectPlaces = (notes: Memory[]): MapPlace[] => {
  const byId = new Map<string, MapPlace>();
  for (const note of notes) {
    const title = noteTitle(note);
    for (const place of notePlaces(note)) {
      const existing = byId.get(place.placeId);
      if (existing) {
        if (!existing.noteTitles!.includes(title)) existing.noteTitles!.push(title);
        if (!existing.noteIds!.includes(note.id)) existing.noteIds!.push(note.id);
      } else {
        byId.set(place.placeId, { ...place, noteTitles: [title], noteIds: [note.id] });
      }
    }
  }
  return [...byId.values()];
};

/**
 * Puts each place in the moment subsection of the first note (in the order
 * collectPlaces was given them, i.e. best match first) that mentions it, so
 * the map's pins follow the grouping shown in the moment. Without sections
 * the places are returned unchanged.
 */
export const categorisePlaces = (places: MapPlace[], sections?: MomentSection[]): MapPlace[] => {
  if (!sections || sections.length === 0) return places;
  const sectionOf = new Map<string, MapCategory>();
  let index = 0;
  for (const section of sections) {
    const category: MapCategory = {
      key: section.key,
      label: section.label,
      index: section.key === OTHER_SECTION_KEY ? -1 : index++,
    };
    for (const id of section.noteIds) if (!sectionOf.has(id)) sectionOf.set(id, category);
  }
  return places.map(place => {
    const noteId = place.noteIds?.find(id => sectionOf.has(id));
    return { ...place, category: noteId ? sectionOf.get(noteId) : undefined };
  });
};
