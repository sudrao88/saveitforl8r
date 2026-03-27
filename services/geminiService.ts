
import { EnrichmentData, Memory, Attachment, ChatMessage, Moment, SynthesisResponse } from '../types.ts';
import { postProxy, getProxyUrl } from './proxyService.ts';
import { getValidToken } from './googleAuth.ts';
import { enqueue as bgSyncEnqueue } from './backgroundSyncQueue.ts';
import { POLLING } from '../constants.ts';

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
  const payload: EnrichmentInput = {
    text,
    attachments,
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
    throw err;
  }
};

export type EnrichmentPollResult =
  | { status: 'completed'; data: EnrichmentData }
  | { status: 'processing' }
  | { status: 'failed' }
  | { status: 'not_found' };

/**
 * Generic polling result fetcher. All three polling endpoints (enrich, moment,
 * synthesis) share the same request/response shape — this eliminates the
 * duplicated fetch + status-normalization logic.
 */
async function fetchPendingResults<TData>(
  ids: string[],
  endpoint: string,
  idsKey: string,
  label: string,
): Promise<Record<string, { status: 'completed'; data: TData } | { status: 'processing' } | { status: 'failed' } | { status: 'not_found' }>> {
  try {
    const response = await postProxy<{ results: Record<string, { status: string; data?: TData }> }>(
      endpoint, { [idsKey]: ids } as unknown as Record<string, unknown>
    );

    const result: Record<string, { status: 'completed'; data: TData } | { status: 'processing' } | { status: 'failed' } | { status: 'not_found' }> = {};
    if (response?.results) {
      for (const id of ids) {
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
    console.error(`Failed to fetch ${label}:`, error);
    return {};
  }
}

/**
 * Fetches enrichment results for pending memories from the server.
 */
export const fetchPendingEnrichments = (memoryIds: string[]) =>
  fetchPendingResults<EnrichmentData>(memoryIds, '/api/enrich/results', 'memoryIds', 'pending enrichments');

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
  memories: LightMemory[];
  history: ChatMessage[];
}

// Cap the number of memories sent in query context.
// Keeps payload under ~1 MB even with large collections.
// Memories are already sorted by recency, so this sends the most relevant.
const MAX_QUERY_MEMORIES = 200;

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
  const lightNotes = memories
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

  const result = await postProxy<SubmitMomentCreationResponse>('/api/create-moment', {
    objective,
    notes: lightNotes,
    momentId,
  });

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

/**
 * Fetches moment creation results for pending moments from the server.
 */
export const fetchPendingMomentResults = (momentIds: string[]) =>
  fetchPendingResults<CreateMomentResponse>(momentIds, '/api/create-moment/results', 'momentIds', 'pending moment results');

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
  const notes = moment.noteIds
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

  const result = await postProxy<SubmitResynthesisResponse>('/api/synthesize', {
    notes,
    momentType: moment.type,
    momentTitle: moment.title,
    objective: moment.objective,
    momentId: moment.id,
  });

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

/**
 * Fetches re-synthesis results for pending moments from the server.
 */
export const fetchPendingSynthesisResults = (momentIds: string[]) =>
  fetchPendingResults<SynthesisResponse>(momentIds, '/api/synthesize/results', 'momentIds', 'pending synthesis results');


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

  while (Date.now() - start < POLLING.SYNTHESIS_TIMEOUT_MS) {
    if (signal?.aborted) {
      throw new DOMException('Synthesis polling aborted', 'AbortError');
    }

    const elapsed = Date.now() - start;
    const interval = elapsed < POLLING.FAST_TIER_MS
      ? POLLING.FAST_INTERVAL_MS
      : POLLING.SLOW_INTERVAL_MS;

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

    const payload: QueryPayload = {
      query,
      memories: lightMemories,
      history,
    };

    // Explicitly cast the response
    const result = await postProxy<QueryResponse>('/api/query', payload as unknown as Record<string, unknown>);
    return result;
  } catch (error) {
    console.error('Query Error:', error);
    return { answer: 'Unable to retrieve memory.', sources: [] };
  }
};
