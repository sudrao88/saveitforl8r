
import { EnrichmentData, Memory, Attachment, ChatMessage, Moment, SynthesisResponse } from '../types.ts';
import { postProxy, getProxyUrl } from './proxyService.ts';
import { getValidToken } from './googleAuth.ts';
import { enqueue as bgSyncEnqueue } from './backgroundSyncQueue.ts';

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

interface QueryPayload {
  query: string;
  history: ChatMessage[];
}

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
  momentId: string,
): Promise<{ momentId: string }> => {
  const result = await postProxy<SubmitMomentCreationResponse>('/api/create-moment', {
    objective,
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
): Promise<{ momentId: string }> => {
  const result = await postProxy<SubmitResynthesisResponse>('/api/synthesize', {
    noteIds: moment.noteIds,
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
 */
export const queryBrain = async (
  query: string,
  history: ChatMessage[] = []
): Promise<QueryResponse> => {
  try {
    const payload: QueryPayload = {
      query,
      history,
    };

    const result = await postProxy<QueryResponse>('/api/query', payload as unknown as Record<string, unknown>);
    return result;
  } catch (error) {
    console.error('Query Error:', error);
    return { answer: 'Unable to retrieve memory.', sources: [] };
  }
};
