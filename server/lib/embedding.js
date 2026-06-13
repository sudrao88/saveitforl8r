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

/**
 * Embed one or more texts. Returns an array of normalized vectors in the same
 * order as the input. Throws on API failure — callers decide whether that's
 * fatal (the embed endpoint) or best-effort (the enrich hook).
 */
export const embedTexts = async (ai, texts, { signal } = {}) => {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const truncated = texts.map((t) =>
    typeof t === 'string' ? t.slice(0, MAX_EMBEDDING_INPUT_CHARS) : ''
  );

  // gemini-embedding-2 aggregates multiple inline inputs into a SINGLE vector;
  // wrapping each text in its own Content object yields one embedding per input
  // (the count guard below catches any regression). Unlike gemini-embedding-001
  // it also rejects taskType — passing it errors — so the similarity intent is
  // expressed purely through the composed text.
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: truncated.map((text) => ({ parts: [{ text }] })),
    config: {
      outputDimensionality: EMBEDDING_DIM,
      ...(signal ? { abortSignal: signal } : {}),
    },
  });

  const embeddings = response.embeddings || [];
  if (embeddings.length !== truncated.length) {
    throw new Error(
      `Embedding count mismatch: expected ${truncated.length}, got ${embeddings.length}`
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
 * Compose the text used for a memory's embedding from its content and
 * enrichment. Kept in sync with the client-side composer
 * (services/relatedMemories buildEmbeddingText) so enrich-time and
 * backfill-time vectors live in the same space.
 */
export const buildEmbeddingText = (content, enrichment = {}) => {
  const parts = [];
  if (content) parts.push(`CONTENT: ${content}`);
  if (enrichment.summary) parts.push(`SUMMARY: ${enrichment.summary}`);
  if (enrichment.visualDescription) parts.push(`VISUAL: ${enrichment.visualDescription}`);
  if (Array.isArray(enrichment.suggestedTags) && enrichment.suggestedTags.length) {
    parts.push(`TAGS: ${enrichment.suggestedTags.join(', ')}`);
  }
  const entity = enrichment.entityContext;
  if (entity) {
    if (entity.type) parts.push(`TYPE: ${entity.type}`);
    if (entity.title) parts.push(`ENTITY: ${entity.title}`);
    if (entity.subtitle) parts.push(`SUBTITLE: ${entity.subtitle}`);
    if (entity.description) parts.push(`DESCRIPTION: ${entity.description}`);
  }
  return parts.join('\n').trim();
};
