
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
 */
export const enrichInput = async (
  text: string,
  attachments: Attachment[],
  location?: { latitude: number; longitude: number },
  tags: string[] = []
): Promise<EnrichmentData> => {
  try {
    const result = await postProxy<EnrichmentData>('/api/enrich', {
      text,
      attachments,
      location,
      tags,
    });
    return result;
  } catch (error: any) {
    console.error('Enrichment Error:', error);
    throw error;
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
