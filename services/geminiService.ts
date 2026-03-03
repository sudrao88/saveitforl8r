
import { EnrichmentData, Memory, Attachment, Moment, SynthesisResponse } from '../types.ts';
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
  usedNoteIds: string[];
  synthesis: SynthesisResponse;
}

/**
 * Sends memory content to the server proxy for AI enrichment.
 * Optionally includes moments metadata for moment-matching phase.
 */
export const enrichInput = async (
  text: string,
  attachments: Attachment[],
  location?: { latitude: number; longitude: number },
  tags: string[] = [],
  moments?: { id: string; objective: string }[]
): Promise<EnrichmentData> => {
  try {
    const result = await postProxy<EnrichmentData>('/api/enrich', {
      text,
      attachments,
      location,
      tags,
      moments,
    });
    return result;
  } catch (error: any) {
    console.error('Enrichment Error:', error);
    throw error;
  }
};

/**
 * Creates a new moment by sending the user's objective and all notes to the server.
 * The server uses Gemini to select relevant notes and build an initial synthesis.
 */
export const createMoment = async (
  objective: string,
  memories: Memory[]
): Promise<CreateMomentResponse> => {
  const lightNotes = memories
    .filter(m => !m.isPending && !m.processingError && !m.isDeleted && !m.isSample)
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

  const result = await postProxy<CreateMomentResponse>('/api/create-moment', {
    objective,
    notes: lightNotes,
  }, { timeout: 90000 });
  return result;
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
  memories: Memory[]
): Promise<QueryResponse> => {
  try {
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
