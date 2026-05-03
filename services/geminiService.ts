
import { EnrichmentData, Memory, Attachment, ChatMessage, Moment, SynthesisResponse } from '../types.ts';
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

export interface CreateMomentResponse {
  title: string;
  type: string;
  emoji?: string;
  usedNoteIds: string[];
  synthesis: SynthesisResponse;
  refinedObjective?: string;
}

interface EnrichmentInput {
  text: string;
  attachments: Attachment[];
  location?: { latitude: number; longitude: number };
  tags: string[];
  memoryId?: string;
  moments?: { id: string; objective: string; refinedObjective?: string; title: string; type: string }[];
}

interface SubmitEnrichmentResponse {
  status: string;
}

/**
 * Submits memory content to the server proxy for AI enrichment.
 * The server validates the request, persists a "processing" status,
 * and returns 200 { status: "accepted" } immediately. Enrichment
 * happens asynchronously — poll with fetchPendingEnrichments().
 * Optionally includes moments metadata for moment-matching phase.
 */
export const submitEnrichment = async (
  text: string,
  attachments: Attachment[],
  location?: { latitude: number; longitude: number },
  tags: string[] = [],
  memoryId?: string,
  moments?: { id: string; objective: string; refinedObjective?: string; title: string; type: string }[]
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
    moments,
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
        `[ID: ${m.id}] [DATE: ${new Date(m.timestamp).toLocaleDateString()}]
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

interface LightNote {
  id: string;
  content: string;
  tags: string[];
  enrichment?: {
    summary?: string;
    locationContext?: EnrichmentData['locationContext'];
    entityContext?: EnrichmentData['entityContext'];
  };
}

/**
 * Builds the moment-creation/synthesis context string. Mirrors the format
 * server/routes/moment.js (stepNoteSelection, stepSynthesis, singleCallFallback)
 * and server/index.js (synthesize handler) construct when notes are inlined.
 */
const buildNotesContextString = (notes: LightNote[]): string =>
  notes
    .map(
      (n) =>
        `[ID: ${n.id}]
[CONTENT]: ${n.content || ''}
[TAGS]: ${(n.tags || []).join(', ')}
[SUMMARY]: ${n.enrichment?.summary || 'N/A'}
[ENTITY]: ${n.enrichment?.entityContext?.title || 'N/A'} (${n.enrichment?.entityContext?.type || ''})
[DESCRIPTION]: ${n.enrichment?.entityContext?.description || 'N/A'}`
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

// --- Async Moment Creation ---

interface SubmitMomentCreationResponse {
  status: string;
  momentId: string;
}

/**
 * Submits a moment creation request asynchronously.
 * Server returns { status: "accepted", momentId } immediately.
 * The 3-step pipeline (intent refinement → note selection → synthesis) runs
 * in the background. Poll with fetchPendingMomentResults() to get the result.
 */
export const submitMomentCreation = async (
  objective: string,
  memories: Memory[],
  momentId: string,
): Promise<{ momentId: string }> => {
  const lightNotes: LightNote[] = memories
    .filter(m => !m.isPending && !m.processingError && !m.isDeleted)
    .map(m => ({
      id: m.id,
      content: m.content,
      tags: m.tags,
      enrichment: m.enrichment
        ? {
            summary: m.enrichment.summary,
            locationContext: m.enrichment.locationContext,
            entityContext: m.enrichment.entityContext,
          }
        : undefined,
    }));

  const inlineBody: Record<string, unknown> = { objective, notes: lightNotes, momentId };
  const inlineSize = JSON.stringify(inlineBody).length;
  const uploaded = await uploadContextIfLarge(
    buildNotesContextString(lightNotes),
    inlineSize,
    'create-moment-notes',
  );

  const body: Record<string, unknown> = uploaded
    ? { objective, momentId, notesFileUri: uploaded.fileUri, notesFileName: uploaded.geminiFileName, noteCount: lightNotes.length }
    : inlineBody;

  const result = await postProxy<SubmitMomentCreationResponse>('/api/create-moment', body);

  if (result.status !== 'accepted') {
    throw new Error(`Unexpected moment creation response: ${result.status}`);
  }
  return { momentId: result.momentId };
};

// --- Moment Creation Polling ---

export type MomentCreationPollResult =
  | { status: 'completed'; data: CreateMomentResponse }
  | { status: 'processing' }
  | { status: 'failed' }
  | { status: 'not_found' };

interface MomentResultEntry {
  status: 'completed' | 'failed' | 'not_found' | string;
  data?: CreateMomentResponse;
}

interface MomentResultsResponse {
  results: Record<string, MomentResultEntry>;
}

/**
 * Fetches moment creation results for pending moments from the server.
 * Returns per-moment status. Mirrors fetchPendingEnrichments() pattern.
 */
export const fetchPendingMomentResults = async (
  momentIds: string[],
): Promise<Record<string, MomentCreationPollResult>> => {
  try {
    const payload = { momentIds };
    const response = await postProxy<MomentResultsResponse>(
      '/api/create-moment/results',
      payload as unknown as Record<string, unknown>
    );

    const result: Record<string, MomentCreationPollResult> = {};
    if (response && response.results) {
      for (const id of momentIds) {
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
    console.error('Failed to fetch pending moment results:', error);
    return {};
  }
};

// --- Async Moment Re-Synthesis ---

interface SubmitResynthesisResponse {
  status: string;
  momentId: string;
}

/**
 * Submits a re-synthesis request asynchronously.
 * Server returns { status: "accepted", momentId } immediately.
 * The synthesis runs in the background. Poll with fetchPendingSynthesisResults()
 * to get the result.
 */
export const submitResynthesis = async (
  moment: Moment,
  memories: Memory[]
): Promise<{ momentId: string }> => {
  const notes: LightNote[] = moment.noteIds
    .map(id => memories.find(m => m.id === id))
    .filter((m): m is Memory => !!m)
    .map(m => ({
      id: m.id,
      content: m.content,
      tags: m.tags,
      enrichment: m.enrichment
        ? {
            summary: m.enrichment.summary,
            locationContext: m.enrichment.locationContext,
            entityContext: m.enrichment.entityContext,
          }
        : undefined,
    }));

  const inlineBody: Record<string, unknown> = {
    notes,
    momentType: moment.type,
    momentTitle: moment.title,
    objective: moment.objective,
    momentId: moment.id,
  };

  const inlineSize = JSON.stringify(inlineBody).length;
  const uploaded = await uploadContextIfLarge(
    buildNotesContextString(notes),
    inlineSize,
    'synthesize-notes',
  );

  const body: Record<string, unknown> = uploaded
    ? {
        momentType: moment.type,
        momentTitle: moment.title,
        objective: moment.objective,
        momentId: moment.id,
        notesFileUri: uploaded.fileUri,
        notesFileName: uploaded.geminiFileName,
        noteCount: notes.length,
      }
    : inlineBody;

  const result = await postProxy<SubmitResynthesisResponse>('/api/synthesize', body);

  if (result.status !== 'accepted') {
    throw new Error(`Unexpected synthesis response: ${result.status}`);
  }
  return { momentId: result.momentId };
};

// --- Synthesis Polling ---

export type SynthesisPollResult =
  | { status: 'completed'; data: SynthesisResponse }
  | { status: 'processing' }
  | { status: 'failed' }
  | { status: 'not_found' };

interface SynthesisResultEntry {
  status: 'completed' | 'failed' | 'not_found' | string;
  data?: SynthesisResponse;
}

interface SynthesisResultsResponse {
  results: Record<string, SynthesisResultEntry>;
}

/**
 * Fetches re-synthesis results for pending moments from the server.
 * Mirrors fetchPendingMomentResults() pattern.
 */
export const fetchPendingSynthesisResults = async (
  momentIds: string[],
): Promise<Record<string, SynthesisPollResult>> => {
  try {
    const payload = { momentIds };
    const response = await postProxy<SynthesisResultsResponse>(
      '/api/synthesize/results',
      payload as unknown as Record<string, unknown>
    );

    const result: Record<string, SynthesisPollResult> = {};
    if (response && response.results) {
      for (const id of momentIds) {
        const entry = response.results[id];
        if (entry?.status === 'not_found') {
          result[id] = { status: 'not_found' };
        } else if (entry?.status === 'completed' && entry.data) {
          result[id] = { status: 'completed', data: entry.data };
        } else if (entry?.status === 'failed') {
          result[id] = { status: 'failed' };
        } else {
          // Default unknown statuses to 'processing' as a safe intermediate state
          result[id] = { status: 'processing' };
        }
      }
    }
    return result;
  } catch (error) {
    console.error('Failed to fetch pending synthesis results:', error);
    return {};
  }
};

/** Poll every 1s during the initial fast-polling tier. */
const SYNTH_FAST_POLL_INTERVAL_MS = 1_000;
/** Poll every 2s after the fast tier expires. */
const SYNTH_SLOW_POLL_INTERVAL_MS = 2_000;
/** Duration of the fast-polling tier (first 15 seconds). */
const SYNTH_FAST_POLL_TIER_MS = 15_000;
/** Maximum time to poll before giving up. */
const SYNTH_POLL_TIMEOUT_MS = 120_000;

/**
 * Polls for a re-synthesis result with tiered intervals (1s for 15s, then 2s).
 * Returns the SynthesisResponse when complete, or throws on failure/timeout.
 * Accepts an optional AbortSignal to stop polling early when the caller is
 * cancelled (e.g. when a note deletion triggers a new synthesis request).
 */
export const pollSynthesisResult = async (
  momentId: string,
  signal?: AbortSignal,
): Promise<SynthesisResponse> => {
  const start = Date.now();

  while (Date.now() - start < SYNTH_POLL_TIMEOUT_MS) {
    if (signal?.aborted) {
      throw new DOMException('Synthesis polling aborted', 'AbortError');
    }

    const elapsed = Date.now() - start;
    const interval = elapsed < SYNTH_FAST_POLL_TIER_MS
      ? SYNTH_FAST_POLL_INTERVAL_MS
      : SYNTH_SLOW_POLL_INTERVAL_MS;

    // Abort-aware delay: rejects immediately if signal fires during the wait
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Synthesis polling aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, interval);
      signal?.addEventListener('abort', onAbort, { once: true });
    });

    const results = await fetchPendingSynthesisResults([momentId]);
    const result = results[momentId];

    if (result?.status === 'completed' && 'data' in result) {
      return result.data;
    }
    if (result?.status === 'failed') {
      throw new Error('Synthesis failed on server');
    }
  }

  throw new Error('Synthesis polling timed out');
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
      .filter(m => !m.isPending && !m.processingError)
      .slice(0, MAX_QUERY_MEMORIES)
      .map(m => ({
        id: m.id,
        timestamp: m.timestamp,
        content: m.content,
        tags: m.tags,
        enrichment: m.enrichment,
        attachments: (m.attachments || []).map(a => ({ name: a.name })),
        isPending: m.isPending,
        processingError: m.processingError,
      }));

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
