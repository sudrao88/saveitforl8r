
import { EnrichmentData, Memory, Attachment, ChatMessage, Moment, SynthesisResponse } from '../types.ts';
import { postProxy } from './proxyService.ts';

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

  const result = await postProxy<SubmitEnrichmentResponse>('/api/enrich', payload as unknown as Record<string, unknown>);
  if (result.status !== 'accepted') {
    throw new Error(`Unexpected enrichment response: ${result.status}`);
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

/**
 * Re-synthesizes a moment when new notes have been added.
 */
export const synthesizeMoment = async (
  moment: Moment,
  memories: Memory[]
): Promise<SynthesisResponse> => {
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

  const result = await postProxy<SynthesisResponse>('/api/synthesize', {
    notes,
    momentType: moment.type,
    momentTitle: moment.title,
    objective: moment.objective,
  }, { timeout: 90000 });
  return result;
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
