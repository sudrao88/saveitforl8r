/**
 * mapPlaces.ts
 *
 * Collects the Google Maps places (those with a grounded placeId) that a note
 * or a set of notes mentions, for rendering on the in-app map. Coordinates are
 * not stored: the map resolves each placeId to a position when it renders.
 */

import { Memory } from '../types';
import { noteTitle } from './noteLabels';

export interface MapPlace {
  placeId: string;
  name: string;
  address?: string;
  /** Link that opens this exact place in Google Maps. */
  mapsUri: string;
  /** Notes that mention this place (set when collecting across notes). */
  noteTitles?: string[];
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
      } else {
        byId.set(place.placeId, { ...place, noteTitles: [title] });
      }
    }
  }
  return [...byId.values()];
};
