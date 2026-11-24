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
export const matchPlace = (places, name) => {
  if (places.length === 0) return undefined;
  const target = normalize(name);
  if (target) {
    const exact = places.find((p) => normalize(p.title) === target);
    if (exact) return exact;
    const partial = places.find((p) => {
      const title = normalize(p.title);
      return title && (title.includes(target) || target.includes(title));
    });
    if (partial) return partial;
  }
  return places.length === 1 ? places[0] : undefined;
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
