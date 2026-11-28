/**
 * assistantStore.ts
 *
 * Keeps the most recent assistant conversation on this device so reopening the
 * assistant resumes it. Stored encrypted with the same key as notes. It is
 * never synced to Drive.
 */
import { encryptData, decryptData, EncryptedPayload } from './encryptionService';
import { storage } from './platform';

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  /** The question, or the part of the answer drawn from the notes. */
  text: string;
  /** Additions from general knowledge (assistant messages only). */
  beyondNotes?: string;
  /** IDs of the notes the answer relies on (assistant messages only). */
  sourceIds?: string[];
  /** True when the turn failed; shown as an error and left out of history. */
  isError?: boolean;
  timestamp: number;
}

export const ASSISTANT_CONVERSATION_KEY = 'assistant_conversation_v1';
/** Older messages are dropped so the stored conversation stays small. */
export const MAX_STORED_MESSAGES = 60;

const isMessage = (m: unknown): m is AssistantMessage => {
  const v = m as AssistantMessage;
  return !!v && typeof v.id === 'string' && (v.role === 'user' || v.role === 'assistant') && typeof v.text === 'string';
};

export const loadConversation = async (): Promise<AssistantMessage[]> => {
  try {
    const raw = await storage.get(ASSISTANT_CONVERSATION_KEY);
    if (!raw) return [];
    const data = await decryptData(JSON.parse(raw) as EncryptedPayload);
    return Array.isArray(data?.messages) ? data.messages.filter(isMessage) : [];
  } catch (e) {
    console.warn('[Assistant] Could not load the saved conversation', e);
    return [];
  }
};

export const saveConversation = async (messages: AssistantMessage[]): Promise<void> => {
  try {
    if (messages.length === 0) {
      await storage.remove(ASSISTANT_CONVERSATION_KEY);
      return;
    }
    const payload = await encryptData({ messages: messages.slice(-MAX_STORED_MESSAGES) });
    await storage.set(ASSISTANT_CONVERSATION_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('[Assistant] Could not save the conversation', e);
  }
};
