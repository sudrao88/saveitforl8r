/**
 * Canonical Gemini schema for a moment synthesis, shared by the create-moment
 * agent (services/momentAgent.js), the re-synthesis endpoint, and the
 * create-moment response schema (server/index.js). Keeping one definition here
 * prevents the agent's `finalize` output schema from drifting away from the
 * server's stored/validated synthesis shape.
 */
import { Type } from '@google/genai';

export const synthesisItemSchema = {
  type: Type.OBJECT,
  properties: {
    label: { type: Type.STRING, description: 'Item label.' },
    detail: { type: Type.STRING, description: 'Optional detail or description.' },
    link: { type: Type.STRING, description: 'Optional link/URL.' },
    sourceType: { type: Type.STRING, description: "Where this fact came from: 'note' or 'web'." },
    sourceNoteId: { type: Type.STRING, description: "ID of the source note (when sourceType is 'note')." },
    sourceUrl: { type: Type.STRING, description: "Source URL (when sourceType is 'web')." },
    completable: { type: Type.BOOLEAN, description: 'Whether this item can be marked complete.' },
    completed: { type: Type.BOOLEAN, description: 'Whether this item is completed.' },
  },
  required: ['label'],
};

export const synthesisSchema = {
  type: Type.OBJECT,
  properties: {
    format: { type: Type.STRING, description: 'The format/type of the synthesized output.' },
    title: { type: Type.STRING, description: 'Title of the synthesized moment.' },
    subtitle: { type: Type.STRING, description: 'Optional subtitle for additional context.' },
    sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          heading: { type: Type.STRING, description: 'Section heading.' },
          items: { type: Type.ARRAY, items: synthesisItemSchema },
        },
        required: ['heading', 'items'],
      },
    },
    generatedFrom: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'IDs of the notes used to generate this synthesis.',
    },
  },
  required: ['format', 'title', 'sections', 'generatedFrom'],
};
