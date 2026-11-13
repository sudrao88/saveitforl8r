
import { EnrichmentData, Memory, Attachment, ChatMessage, isMemoryInFlight, isMemoryFailed } from '../types.ts';
import { postProxy, getProxyUrl } from './proxyService.ts';
import { getValidToken } from './googleAuth.ts';
import { enqueue as bgSyncEnqueue } from './backgroundSyncQueue.ts';
import { uploadFileChunked, LARGE_PAYLOAD_THRESHOLD } from './chunkUploadService.ts';

export interface QuerySource {
  id: string;
  preview: string;
}

export interface QueryResponse {
  answer: string;
  sources: QuerySource[];
}

interface EnrichmentInput {
  text: string;
  attachments: Attachment[];
  location?: { latitude: number; longitude: number };
  tags: string[];
  memoryId?: string;
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
}

interface EnrichmentResultsResponse {
  results: Record<string, EnrichmentResultEntry>;
}

export type EnrichmentPollResult =
  | { status: 'completed'; data: EnrichmentData }
  | { status: 'processing' }
  | { status: 'failed' }
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
          result[id] = { status: 'completed', data: entry.data };
        } else if (entry?.status === 'failed') {
          result[id] = { status: 'failed' };
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

interface LightMemory {
  id: string;
  timestamp: number;
  content: string;
  tags: string[];
  enrichment?: EnrichmentData;
  attachments: { name: string }[];
  isPending?: boolean;
  processingError?: boolean;
}

interface QueryPayload {
  query: string;
  memories?: LightMemory[];
  history: ChatMessage[];
  memoriesFileUri?: string;
  memoriesFileName?: string;
}

// Cap the number of memories sent in query context.
// Keeps payload under ~1 MB even with large collections.
// Memories are already sorted by recency, so this sends the most relevant.
const MAX_QUERY_MEMORIES = 200;

/**
 * Builds the [ID]/[CONTENT]/[SUMMARY]... text block for query context.
 * Mirrors the format the server constructs in server/routes/query.js when
 * memories are inlined. When this is uploaded as a text/plain file via
 * the Gemini File API, the LLM sees identical structure.
 */
const buildMemoriesContextString = (memories: LightMemory[]): string =>
  memories
    .map(
      (m) =>
        `[ID: ${m.id}] [DATE: ${new Date(m.timestamp).toISOString().split('T')[0]}]
[CONTENT]: ${m.content || ''}
[SUMMARY]: ${m.enrichment?.summary || 'N/A'}
[TAGS]: ${(m.tags || []).join(', ')}
[PLACE]: ${m.enrichment?.locationContext?.name || 'N/A'}
[ENTITY]: ${m.enrichment?.entityContext?.title || 'N/A'} (${m.enrichment?.entityContext?.type || ''})
[SUBTITLE]: ${m.enrichment?.entityContext?.subtitle || 'N/A'}
[DESCRIPTION]: ${m.enrichment?.entityContext?.description || 'N/A'}
[ATTACHMENTS]: ${(m.attachments || []).map((a) => a.name).join(', ')}
[KEY_POINTS]: ${(m.enrichment?.keyPoints || []).join('; ') || 'N/A'}
[ACTION_ITEMS]: ${(m.enrichment?.actionItems || []).join('; ') || 'N/A'}
[THEMES]: ${(m.enrichment?.themes || []).join(', ') || 'N/A'}`
    )
    .join('\n---\n');

/**
 * Generate a v4 UUID. Used as the upload-session "owner id" for context-file
 * uploads (the upload-init validator requires a UUID, but accepts any).
 */
const newUuid = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  const bytes = new Uint8Array(16);
  (typeof crypto !== 'undefined' ? crypto : { getRandomValues: (b: Uint8Array) => { for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); return b; } }).getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * If the serialized payload would exceed LARGE_PAYLOAD_THRESHOLD, upload the
 * supplied context string via the chunked-upload pipeline so the server can
 * reference it by Gemini File API URI instead of embedding it in the body.
 *
 * Returns null when the payload is small enough to send inline (no upload).
 * Returns { fileUri, geminiFileName } when an upload happened.
 */
const uploadContextIfLarge = async (
  contextText: string,
  inlinePayloadSize: number,
  fileNamePrefix: string,
): Promise<{ fileUri: string; geminiFileName: string } | null> => {
  if (inlinePayloadSize <= LARGE_PAYLOAD_THRESHOLD) return null;

  const ownerId = newUuid();
  const blob = new Blob([contextText], { type: 'text/plain' });
  const fileName = `${fileNamePrefix}-${ownerId}.txt`;
  return uploadFileChunked(blob, 'text/plain', fileName, ownerId);
};

/**
 * Sends a query + memory context to the server proxy for AI-powered recall.
 *
 * If the inline JSON payload would exceed LARGE_PAYLOAD_THRESHOLD, the
 * memories context is uploaded via the chunked-upload pipeline and the
 * server reads it from the Gemini File API instead of receiving it in
 * the request body.
 */
export const queryBrain = async (
  query: string,
  memories: Memory[],
  history: ChatMessage[] = []
): Promise<QueryResponse> => {
  try {
    // Strip attachment data and cap count to keep payload manageable.
    const lightMemories: LightMemory[] = memories
      .filter(m => !isMemoryInFlight(m) && !isMemoryFailed(m))
      .slice(0, MAX_QUERY_MEMORIES)
      .map(m => {
        // Drop the similarity embedding from the query payload — it's large
        // (~7 KB/memory) and the query endpoint doesn't use it.
        let enrichment: EnrichmentData | undefined;
        if (m.enrichment) {
          const { embedding, embeddingModel, ...rest } = m.enrichment;
          enrichment = rest as EnrichmentData;
        }
        return {
          id: m.id,
          timestamp: m.timestamp,
          content: m.content,
          tags: m.tags,
          enrichment,
          attachments: (m.attachments || []).map(a => ({ name: a.name })),
          isPending: m.isPending,
          processingError: m.processingError,
        };
      });

    const inlinePayload: QueryPayload = {
      query,
      memories: lightMemories,
      history,
    };

    const inlineSize = JSON.stringify(inlinePayload).length;
    const uploaded = await uploadContextIfLarge(
      buildMemoriesContextString(lightMemories),
      inlineSize,
      'query-memories',
    );

    const payload: QueryPayload = uploaded
      ? { query, history, memoriesFileUri: uploaded.fileUri, memoriesFileName: uploaded.geminiFileName }
      : inlinePayload;

    // Explicitly cast the response
    const result = await postProxy<QueryResponse>('/api/query', payload as unknown as Record<string, unknown>);
    return result;
  } catch (error) {
    console.error('Query Error:', error);
    return { answer: 'Unable to retrieve memory.', sources: [] };
  }
};
