import { EnrichmentData, Memory, Attachment, ChatMessage } from '../types.ts';
import { postProxy } from './proxyService.ts';

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
  memoryId?: string
): Promise<void> => {
  const payload: EnrichmentInput = {
    text,
    attachments,
    location,
    tags,
    memoryId,
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

/**
 * Sends a query + memory context to the server proxy for AI-powered recall.
 * The server owns the API key and decides which model to use.
 */
export const queryBrain = async (
  query: string,
  memories: Memory[],
  history: ChatMessage[] = []
): Promise<QueryResponse> => {
  try {
    // Strip attachment data from memories to reduce payload size.
    // The server only needs metadata for context building.
    const lightMemories: LightMemory[] = memories
      .filter(m => !m.isPending && !m.processingError)
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
