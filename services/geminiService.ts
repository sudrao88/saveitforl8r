
import { EnrichmentData, Memory, Attachment } from '../types.ts';
import { postProxy } from './proxyService.ts';

export interface QuerySource {
  id: string;
  preview: string;
}

export interface QueryResponse {
  answer: string;
  sources: QuerySource[];
}

/**
 * Sends memory content to the server proxy for AI enrichment.
 * The server owns the API key and decides which model to use.
 * When memoryId is provided, the server persists the result for later recovery.
 */
export const enrichInput = async (
  text: string,
  attachments: Attachment[],
  location?: { latitude: number; longitude: number },
  tags: string[] = [],
  memoryId?: string
): Promise<EnrichmentData> => {
  try {
    const result = await postProxy<EnrichmentData>('/api/enrich', {
      text,
      attachments,
      location,
      tags,
      memoryId,
    });
    return result;
  } catch (error: any) {
    console.error('Enrichment Error:', error);
    throw error;
  }
};

interface EnrichmentResultEntry {
  status: 'completed' | 'failed' | 'not_found' | string;
  data?: EnrichmentData;
}

interface EnrichmentResultsResponse {
  results: Record<string, EnrichmentResultEntry>;
}

/**
 * Fetches enrichment results for pending memories from the server.
 * Used to recover results when the user closed the app before enrichment completed.
 */
export const fetchPendingEnrichments = async (
  memoryIds: string[]
): Promise<Record<string, EnrichmentData | null>> => {
  try {
    const response = await postProxy<EnrichmentResultsResponse>('/api/enrich/results', {
      memoryIds,
    });

    const result: Record<string, EnrichmentData | null> = {};
    for (const id of memoryIds) {
      const entry = response.results[id];
      if (entry?.status === 'completed' && entry.data) {
        result[id] = entry.data;
      } else {
        result[id] = null;
      }
    }
    return result;
  } catch (error) {
    console.error('Failed to fetch pending enrichments:', error);
    return {};
  }
};

/**
 * Sends a query + memory context to the server proxy for AI-powered recall.
 * The server owns the API key and decides which model to use.
 */
export const queryBrain = async (
  query: string,
  memories: Memory[]
): Promise<QueryResponse> => {
  try {
    // Strip attachment data from memories to reduce payload size.
    // The server only needs metadata for context building.
    const lightMemories = memories
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

    const result = await postProxy<QueryResponse>('/api/query', {
      query,
      memories: lightMemories,
    });
    return result;
  } catch (error) {
    console.error('Query Error:', error);
    return { answer: 'Unable to retrieve memory.', sources: [] };
  }
};
