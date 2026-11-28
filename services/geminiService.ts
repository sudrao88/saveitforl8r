
import { EnrichmentData, Memory, Attachment } from '../types.ts';
import { postProxy, getProxyUrl } from './proxyService.ts';
import type { SectionRequest, SectionResult } from '../utils/momentAiSections.ts';
import { getValidToken } from './googleAuth.ts';
import { enqueue as bgSyncEnqueue } from './backgroundSyncQueue.ts';

interface EnrichmentInput {
  text: string;
  attachments: Attachment[];
  location?: { latitude: number; longitude: number };
  tags: string[];
  memoryId?: string;
  requestId?: string;
}

interface SubmitEnrichmentResponse {
  status: string;
}

interface EmbedResponse {
  embeddings: number[][];
  model: string;
}

/**
 * Compose the text embedded for a memory's similarity vector. Mirrors the
 * server's buildEmbeddingText (server/lib/embedding.js) so backfilled vectors
 * land in the same space as enrich-time ones.
 */
export const buildEmbeddingText = (memory: Memory): string => {
  const e = memory.enrichment;
  const entity = e?.entityContext;
  const parts: string[] = [];
  // Field order and labels MUST stay byte-identical to the server's
  // buildEmbeddingText (server/lib/embedding.js) so backfilled vectors land in
  // the same space as enrich-time ones. Distilled descriptors lead, and the
  // title is repeated once to weight the note's subject over body wording.
  if (entity?.title) parts.push(`TITLE: ${entity.title}`);
  if (entity?.subtitle) parts.push(`SUBTITLE: ${entity.subtitle}`);
  if (entity?.type) parts.push(`TYPE: ${entity.type}`);
  if (e?.summary) parts.push(`SUMMARY: ${e.summary}`);
  if (e?.suggestedTags?.length) parts.push(`TAGS: ${e.suggestedTags.join(', ')}`);
  if (entity?.title) parts.push(`TITLE: ${entity.title}`); // repeated for weight
  if (memory.content) parts.push(`CONTENT: ${memory.content}`);
  if (e?.visualDescription) parts.push(`VISUAL: ${e.visualDescription}`);
  if (entity?.description) parts.push(`DESCRIPTION: ${entity.description}`);
  return parts.join('\n').trim();
};

/**
 * Request similarity embeddings for a batch of texts (max 50) from the proxy.
 * Returns vectors in input order. Used to backfill notes enriched before
 * embeddings existed; newly enriched notes get their vector inline.
 */
export const embedTexts = async (texts: string[]): Promise<number[][]> => {
  if (texts.length === 0) return [];
  const result = await postProxy<EmbedResponse>('/api/embed', { texts });
  return result.embeddings;
};

export interface MomentEmbedResult {
  vectors: number[][];
  /** Whole-moment vector. Optional only so an older proxy still works. */
  intentVector?: number[];
  /** Required keyword concepts (synonyms, label first). Optional for older proxies. */
  concepts?: string[][];
  emoji: string;
  model: string;
}

/**
 * Embed a moment: an intent vector for the terms read together, one vector per
 * term (same model as notes), and an emoji from the server's emoji dictionary.
 * Called once per moment; matching against notes then happens locally.
 */
export const embedMomentTerms = async (terms: string[]): Promise<MomentEmbedResult> => {
  // The server may spend up to ~12s expanding the terms with an LLM before
  // embedding, so allow more than the default 30s on a slow connection.
  const result = await postProxy<MomentEmbedResult>('/api/moment/embed', { terms }, { timeout: 45_000 });
  if (!Array.isArray(result?.vectors) || result.vectors.length !== terms.length) {
    throw new Error('Unexpected moment embedding response');
  }
  if (result.intentVector !== undefined && (!Array.isArray(result.intentVector) || result.intentVector.length === 0)) {
    throw new Error('Unexpected moment intent vector');
  }
  if (
    result.concepts !== undefined &&
    (!Array.isArray(result.concepts) ||
      !result.concepts.every(c => Array.isArray(c) && c.length > 0 && c.every(w => typeof w === 'string')))
  ) {
    throw new Error('Unexpected moment concepts');
  }
  return result;
};

/**
 * Ask the server model to split a moment's notes into named sections (or to
 * place leftover notes into its existing ones). Sends a short card per note,
 * never full content. An empty list means "no worthwhile split".
 */
export const requestMomentSections = async (request: SectionRequest): Promise<SectionResult[]> => {
  // The server gives the model one 30s budget.
  const result = await postProxy<{ sections: SectionResult[] }>('/api/moment/sections', request, { timeout: 45_000 });
  if (!Array.isArray(result?.sections)) throw new Error('Unexpected moment sections response');
  return result.sections.filter(
    s =>
      s && typeof s === 'object' && typeof s.label === 'string' &&
      Array.isArray(s.noteIds) && s.noteIds.every(id => typeof id === 'string'),
  );
};

/**
 * Submits memory content to the server proxy for AI enrichment.
 * The server validates the request, persists a "processing" status,
 * and returns 200 { status: "accepted" } immediately. Enrichment
 * happens asynchronously — poll with fetchPendingEnrichments().
 */
export const submitEnrichment = async (
  text: string,
  attachments: Attachment[],
  location?: { latitude: number; longitude: number },
  tags: string[] = [],
  memoryId?: string,
  requestId?: string,
): Promise<void> => {
  // Strip base64 data from attachments that were uploaded via chunked upload
  // to avoid sending the massive payload — the server uses fileUri instead
  const enrichAttachments = attachments.map(a =>
    a.fileUri
      ? { id: a.id, type: a.type, mimeType: a.mimeType, name: a.name, fileUri: a.fileUri, geminiFileName: a.geminiFileName }
      : a
  );

  const payload: EnrichmentInput = {
    text,
    attachments: enrichAttachments,
    location,
    tags,
    memoryId,
    requestId,
  };

  try {
    const result = await postProxy<SubmitEnrichmentResponse>('/api/enrich', payload as unknown as Record<string, unknown>);
    if (result.status !== 'accepted') {
      throw new Error(`Unexpected enrichment response: ${result.status}`);
    }
  } catch (err) {
    // Queue for Background Sync retry on network errors (TypeError from fetch failures).
    // Server errors (4xx/5xx) throw Error with "Proxy error" prefix — don't queue those.
    if (err instanceof TypeError) {
      // Don't queue requests with large inline attachment data — they would
      // bloat IndexedDB and can't be retried without the chunked upload flow.
      const hasLargeInlineData = enrichAttachments.some(a => !a.fileUri && a.data && a.data.length > 1_000_000);
      if (hasLargeInlineData) {
        console.warn('[Enrichment] Skipping Background Sync queue — payload contains large inline attachments');
      } else {
        try {
          // Include full URL (SW may not have VITE_PROXY_URL) and auth token
          // so the service worker can retry with proper authentication
          let token: string | null = null;
          try { token = await getValidToken(); } catch { /* best-effort */ }
          await bgSyncEnqueue({
            type: 'enrich',
            payload: { path: `${getProxyUrl()}/api/enrich`, body: payload, token },
          });
          console.log('[Enrichment] Queued for Background Sync retry');
        } catch (queueErr) {
          // Background Sync queue is best-effort — don't mask the original error
          console.warn('[Enrichment] Failed to queue for Background Sync:', queueErr);
        }
      }
    }
    throw err;
  }
};

interface EnrichmentResultEntry {
  status: 'completed' | 'failed' | 'not_found' | string;
  data?: EnrichmentData;
  requestId?: string;
}

interface EnrichmentResultsResponse {
  results: Record<string, EnrichmentResultEntry>;
}

export type EnrichmentPollResult =
  | { status: 'completed'; data: EnrichmentData; requestId?: string }
  | { status: 'processing' }
  | { status: 'failed'; requestId?: string }
  | { status: 'not_found' };

/**
 * Fetches enrichment results for pending memories from the server.
 * Returns per-memory status so callers can distinguish between
 * "still processing", "completed", "failed", and "not found".
 */
export const fetchPendingEnrichments = async (
  memoryIds: string[]
): Promise<Record<string, EnrichmentPollResult>> => {
  try {
    const payload = { memoryIds };
    const response = await postProxy<EnrichmentResultsResponse>('/api/enrich/results', payload as unknown as Record<string, unknown>);

    const result: Record<string, EnrichmentPollResult> = {};
    if (response && response.results) {
      for (const id of memoryIds) {
        const entry = response.results[id];
        if (entry?.status === 'completed' && entry.data) {
          result[id] = { status: 'completed', data: entry.data, requestId: entry.requestId };
        } else if (entry?.status === 'failed') {
          result[id] = { status: 'failed', requestId: entry.requestId };
        } else if (entry?.status === 'processing') {
          result[id] = { status: 'processing' };
        } else {
          result[id] = { status: 'not_found' };
        }
      }
    }
    return result;
  } catch (error) {
    console.error('Failed to fetch pending enrichments:', error);
    return {};
  }
};
