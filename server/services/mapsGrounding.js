/**
 * Google Maps grounding helpers.
 *
 * Gemini used to be asked to write `locationContext.mapsUri` itself from
 * Google Search results, so the link was often made up. Grounding with Google
 * Maps returns real places (title, placeId, Maps URI) in the response's
 * `groundingMetadata.groundingChunks[].maps`. These helpers turn that metadata
 * into the place link instead of trusting text the model wrote.
 */

/** Content types that are about a physical place. */
const PLACE_CONTENT_TYPES = new Set(['place_restaurant', 'travel', 'event']);

/**
 * Decide whether the enrichment call should attach the Google Maps tool.
 * With no classification (it failed), use Maps when we know where the user is,
 * since the old prompt already treated those notes as possible places.
 */
export const shouldUseMapsGrounding = (classification, location) => {
  if (!classification) return Boolean(location);
  if (PLACE_CONTENT_TYPES.has(classification.contentType)) return true;
  const entities = Array.isArray(classification.detectedEntities) ? classification.detectedEntities : [];
  return entities.some((e) => e && typeof e.type === 'string' && e.type.toLowerCase() === 'place');
};

/** toolConfig that biases Maps results toward the user's GPS position. */
export const buildMapsToolConfig = (location) => {
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return undefined;
  return { retrievalConfig: { latLng: { latitude: location.latitude, longitude: location.longitude } } };
};

const MAPS_HOSTS = new Set(['maps.google.com', 'www.google.com', 'google.com', 'goo.gl', 'maps.app.goo.gl']);

/** Only https Google Maps links are allowed through. */
export const isValidMapsUri = (uri) => {
  if (typeof uri !== 'string' || uri.length > 2_000) return false;
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'https:' || !MAPS_HOSTS.has(parsed.hostname)) return false;
    // www.google.com / google.com links must point at Maps.
    if (parsed.hostname.endsWith('google.com') && parsed.hostname !== 'maps.google.com') {
      return parsed.pathname.startsWith('/maps');
    }
    return true;
  } catch {
    return false;
  }
};

const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,300}$/;

/**
 * Pull grounded places out of a generateContent response.
 * Shape (Gemini API docs, "Grounding with Google Maps"):
 *   groundingMetadata.groundingChunks[].maps = { uri, title, placeId: "places/<id>" }
 * Only the place ID is kept: the Maps grounding terms allow caching and storing
 * `placeId`, not the other response fields. The title is used only to match
 * the place in this request and is never stored.
 */
export const extractMapsPlaces = (response) => {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const places = [];
  for (const chunk of chunks) {
    const maps = chunk?.maps;
    if (!maps) continue;
    const rawId = typeof maps.placeId === 'string' ? maps.placeId.replace(/^places\//, '') : '';
    if (!PLACE_ID_RE.test(rawId)) continue;
    places.push({ title: typeof maps.title === 'string' ? maps.title : '', placeId: rawId });
  }
  return places;
};

/**
 * Google Maps URL for a place ID (Maps URLs API: `query` is required,
 * `query_place_id` pins the exact place).
 */
export const buildPlaceUri = (name, placeId) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${encodeURIComponent(placeId)}`;

const normalize = (s) => (typeof s === 'string' ? s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim() : '');

/**
 * Pick the grounded place that matches the place the model named. If the name
 * matches no title, use a place only when Maps returned exactly one.
 */
export const matchPlace = (places, name, { exclude, allowSingle = true } = {}) => {
  const candidates = exclude ? places.filter((p) => !exclude.has(p.placeId)) : places;
  if (candidates.length === 0) return undefined;
  const target = normalize(name);
  if (target) {
    const exact = candidates.find((p) => normalize(p.title) === target);
    if (exact) return exact;
    const partial = candidates.find((p) => {
      const title = normalize(p.title);
      return title && (title.includes(target) || target.includes(title));
    });
    if (partial) return partial;
  }
  return allowSingle && places.length === 1 && candidates.length === 1 ? candidates[0] : undefined;
};

/**
 * Replace the model-written mapsUri with a link built from a grounded place ID.
 * A mapsUri not backed by a Maps grounding chunk is removed; the client then
 * builds a Maps search link from the place name and GPS, which is never a
 * wrong place. A Google Maps link the user pasted into the note is also kept.
 */
export const applyMapsGrounding = (sanitized, places, userUrls = []) => {
  const loc = sanitized?.locationContext;
  if (!loc) return sanitized;

  const match = loc.name ? matchPlace(places, loc.name) : undefined;
  if (match) {
    loc.placeId = match.placeId;
    loc.mapsUri = buildPlaceUri(loc.name, match.placeId);
  } else {
    delete loc.placeId;
    const userMapsUri = userUrls.find(isValidMapsUri);
    if (userMapsUri) loc.mapsUri = userMapsUri;
    else delete loc.mapsUri;
  }
  return sanitized;
};

/**
 * Ground every place the note mentions, so a map can show all of them.
 *
 * Each entry in `sanitized.places` ({ name, address }) gets the placeId (and a
 * link built from it) of the grounded Maps place with the same name. Each
 * grounded place is used at most once, and a place with no name match is kept
 * without a placeId rather than pinned to the wrong spot. If the model gave no
 * list but did name a main place, the list is that one place, so every
 * location note has a `places` array. The main place (locationContext) keeps
 * the placeId it was matched to, so the two never disagree.
 *
 * Coordinates are not stored: Maps grounding returns none, and placeId is the
 * one Maps field the grounding terms allow storing. A map resolves each
 * placeId to a position when it renders.
 */
export const applyPlacesGrounding = (sanitized, groundedPlaces) => {
  if (!sanitized || sanitized.locationIsRelevant === false) {
    if (sanitized) delete sanitized.places;
    return sanitized;
  }
  const loc = sanitized.locationContext;
  let places = Array.isArray(sanitized.places) ? sanitized.places : [];
  if (places.length === 0 && loc?.name) {
    places = [{ name: loc.name, ...(loc.address ? { address: loc.address } : {}) }];
  }
  if (places.length === 0) {
    delete sanitized.places;
    return sanitized;
  }

  const used = new Set();
  const mainKey = normalize(loc?.name);
  // Reserve the main place's placeId first so it goes to the same-named entry.
  if (loc?.placeId) used.add(loc.placeId);
  let mainAssigned = false;

  sanitized.places = places.map((place) => {
    const out = { name: place.name };
    if (place.address) out.address = place.address;
    const key = normalize(place.name);
    const isMain = mainKey && key && (key === mainKey || key.includes(mainKey) || mainKey.includes(key));
    if (isMain && loc?.placeId && !mainAssigned) {
      mainAssigned = true;
      out.placeId = loc.placeId;
    } else {
      const match = matchPlace(groundedPlaces, place.name, { exclude: used, allowSingle: places.length === 1 });
      if (match) {
        used.add(match.placeId);
        out.placeId = match.placeId;
      }
    }
    if (out.placeId) out.mapsUri = buildPlaceUri(out.name, out.placeId);
    return out;
  });
  return sanitized;
};
