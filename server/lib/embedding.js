/**
 * Server-side text embedding via the Gemini embedding API.
 *
 * Embeddings are generated here (using a far more capable model than the
 * client's on-device one) and returned to the client inside the enrichment
 * result. The client stores them, syncs them with the memory, and does the
 * actual similarity matching locally — so plaintext never leaves beyond the
 * enrichment request that already sends it.
 */

export const EMBEDDING_MODEL = 'gemini-embedding-2';
// Matryoshka truncation: 768 dims is the recommended high-quality/compact
// tradeoff and keeps the synced vector small (~5-6 KB JSON per memory).
export const EMBEDDING_DIM = 768;
// gemini-embedding-2's text input cap is 8192 tokens; keep the composed text
// well under that. Roughly 4 chars/token, so ~8000 chars is a safe ceiling.
export const MAX_EMBEDDING_INPUT_CHARS = 8000;

const round = (n) => Math.round(n * 1e6) / 1e6;

/**
 * L2-normalize a vector so the client can treat dot product as cosine
 * similarity. gemini-embedding-2 already returns L2-normalized vectors for
 * non-default (truncated) dimensionalities like 768; we normalize defensively
 * anyway — it's idempotent on an already-unit vector.
 */
const normalize = (values) => {
  let normSq = 0;
  for (const v of values) normSq += v * v;
  const norm = Math.sqrt(normSq);
  if (norm === 0) return values.map(() => 0);
  return values.map((v) => round(v / norm));
};

// gemini-embedding-2 is natively multimodal and fuses every part of a single
// Content into one vector. We let a few image parts ride along with a memory's
// text so its actual pixels shape similarity — not just the AI's text caption —
// while capping the count to keep the visual signal complementary (and well
// within the model's per-request media limits).
export const MAX_EMBED_IMAGES = 3;

const truncateText = (t) =>
  typeof t === 'string' ? t.slice(0, MAX_EMBEDDING_INPUT_CHARS) : '';

/**
 * Pick the image parts (inline or File API) out of a set of Gemini content
 * parts, capped at MAX_EMBED_IMAGES. Non-image parts (text, PDFs, audio) are
 * dropped — only images meaningfully sharpen a note's similarity vector here.
 */
export const imagePartsFromContentParts = (parts = []) =>
  parts
    .filter(
      (p) =>
        p?.inlineData?.mimeType?.startsWith('image/') ||
        p?.fileData?.mimeType?.startsWith('image/')
    )
    .slice(0, MAX_EMBED_IMAGES);

/**
 * Compose one memory's multimodal embedding Content: its (truncated) text plus
 * a few image parts. gemini-embedding-2 blends them into a single vector.
 */
export const buildEmbeddingContent = (text, imageParts = []) => ({
  parts: [{ text: truncateText(text) }, ...imageParts.slice(0, MAX_EMBED_IMAGES)],
});

/**
 * Embed an array of Content objects, returning one normalized vector per
 * Content (each Content is aggregated across its own parts). gemini-embedding-2
 * rejects taskType — passing it errors — so similarity intent lives entirely in
 * the composed content. Throws on API failure or a count/shape mismatch.
 */
export const embedContents = async (ai, contents, { signal } = {}) => {
  if (!Array.isArray(contents) || contents.length === 0) return [];

  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents,
    config: {
      outputDimensionality: EMBEDDING_DIM,
      ...(signal ? { abortSignal: signal } : {}),
    },
  });

  const embeddings = response.embeddings || [];
  if (embeddings.length !== contents.length) {
    throw new Error(
      `Embedding count mismatch: expected ${contents.length}, got ${embeddings.length}`
    );
  }

  return embeddings.map((e) => {
    const values = e?.values;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error('Empty embedding returned');
    }
    return normalize(values);
  });
};

/**
 * Embed one or more texts. Returns a normalized vector per input, in order.
 * Each text becomes its own Content — gemini-embedding-2 would otherwise fuse
 * multiple inline inputs into a single aggregated vector. Throws on API failure;
 * callers decide whether that's fatal (the embed endpoint) or best-effort.
 */
export const embedTexts = async (ai, texts, opts = {}) => {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const contents = texts.map((t) => ({ parts: [{ text: truncateText(t) }] }));
  return embedContents(ai, contents, opts);
};

/**
 * Compose the text used for a memory's embedding from its content and
 * enrichment. Kept in sync with the client-side composer
 * (services/relatedMemories buildEmbeddingText) so enrich-time and
 * backfill-time vectors live in the same space.
 */
export const buildEmbeddingText = (content, enrichment = {}) => {
  const e = enrichment;
  const entity = e.entityContext || {};
  const parts = [];
  // Lead with the most distilled, highest-signal descriptors (entity + summary)
  // and repeat the title once. gemini-embedding-2 mean-pools token embeddings,
  // so front-loading and repeating the subject biases the vector toward what the
  // note is *about* instead of incidental wording in a long body.
  if (entity.title) parts.push(`TITLE: ${entity.title}`);
  if (entity.subtitle) parts.push(`SUBTITLE: ${entity.subtitle}`);
  if (entity.type) parts.push(`TYPE: ${entity.type}`);
  if (e.summary) parts.push(`SUMMARY: ${e.summary}`);
  if (Array.isArray(e.suggestedTags) && e.suggestedTags.length) {
    parts.push(`TAGS: ${e.suggestedTags.join(', ')}`);
  }
  if (entity.title) parts.push(`TITLE: ${entity.title}`); // repeated for weight
  if (content) parts.push(`CONTENT: ${content}`);
  if (e.visualDescription) parts.push(`VISUAL: ${e.visualDescription}`);
  if (entity.description) parts.push(`DESCRIPTION: ${entity.description}`);
  return parts.join('\n').trim();
};
