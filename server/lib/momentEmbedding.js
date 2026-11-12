/**
 * Moment term embedding + emoji selection.
 *
 * A moment is a set of short terms ("Singapore", "hawker food"). Each term is
 * embedded on its own with the same model as notes so the client can score
 * notes against it locally. Bare one-word terms embed poorly against long
 * note documents, so each term is wrapped in a template that mirrors the
 * labelled fields notes are embedded with (see buildEmbeddingText).
 */
import { embedTexts } from './embedding.js';
import { EMOJI_DICTIONARY, DEFAULT_MOMENT_EMOJI } from './emojiDictionary.js';

// Gemini's embedContent accepts at most 100 contents per call.
const EMBED_BATCH = 100;

/** Wrap a raw term (or emoji label) in the note-shaped query template. */
export const buildTermEmbeddingText = (term) => {
  const t = String(term).trim();
  return `TITLE: ${t}\nTAGS: ${t}\nSUMMARY: Notes about ${t}.`;
};

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i];
  return s;
};

const embedInBatches = async (ai, texts, opts) => {
  const out = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    out.push(...(await embedTexts(ai, texts.slice(i, i + EMBED_BATCH), opts)));
  }
  return out;
};

// Emoji label vectors are computed once per server instance and reused. A
// failed attempt clears the cache so the next request retries.
let emojiVectorsPromise = null;

export const getEmojiVectors = (ai) => {
  if (!emojiVectorsPromise) {
    emojiVectorsPromise = embedInBatches(
      ai,
      EMOJI_DICTIONARY.map(([, label]) => buildTermEmbeddingText(label)),
    ).catch((err) => {
      emojiVectorsPromise = null;
      throw err;
    });
  }
  return emojiVectorsPromise;
};

/** Test hook: drop the cached emoji vectors. */
export const resetEmojiVectorCache = () => { emojiVectorsPromise = null; };

/**
 * Pick the emoji whose label is closest to the moment as a whole (the mean
 * similarity across all term vectors), so the emoji reflects the overall theme
 * rather than whichever single term happens to score highest.
 */
export const pickEmoji = (termVectors, emojiVectors) => {
  if (!termVectors.length || !emojiVectors.length) return DEFAULT_MOMENT_EMOJI;
  let best = -Infinity;
  let bestIdx = -1;
  for (let i = 0; i < emojiVectors.length; i++) {
    let sum = 0;
    for (const tv of termVectors) sum += dot(tv, emojiVectors[i]);
    const score = sum / termVectors.length;
    if (score > best) { best = score; bestIdx = i; }
  }
  return bestIdx >= 0 ? EMOJI_DICTIONARY[bestIdx][0] : DEFAULT_MOMENT_EMOJI;
};

/**
 * Embed a moment's terms and choose its emoji. The emoji is best-effort: if
 * the dictionary can't be embedded, the default emoji is returned and the
 * term vectors still come back.
 */
export const embedMomentTerms = async (ai, terms, opts = {}) => {
  const vectors = await embedTexts(ai, terms.map(buildTermEmbeddingText), opts);
  let emoji = DEFAULT_MOMENT_EMOJI;
  try {
    emoji = pickEmoji(vectors, await getEmojiVectors(ai));
  } catch (err) {
    console.warn('[MomentEmbed] Emoji dictionary embedding failed:', err.message);
  }
  return { vectors, emoji };
};
