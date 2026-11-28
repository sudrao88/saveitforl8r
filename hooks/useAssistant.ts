import { useCallback, useEffect, useRef, useState } from 'react';
import { Memory } from '../types';
import {
  AssistantCancelledError,
  AssistantTurn,
  runAssistantTurn,
} from '../services/assistantService';
import { AssistantMessage, loadConversation, saveConversation } from '../services/assistantStore';

const ERROR_TEXT = "Sorry, I couldn't answer that. Check your connection and try again.";
const RATE_LIMIT_TEXT = "You're asking faster than I can keep up. Give it a minute and try again.";

const newId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const toTurns = (messages: AssistantMessage[]): AssistantTurn[] =>
  messages
    .filter(m => !m.isError)
    .map(m => ({
      role: m.role === 'user' ? 'user' as const : 'model' as const,
      text: m.role === 'user' ? m.text : [m.text, m.beyondNotes].filter(Boolean).join('\n\n'),
    }));

/**
 * State for the notes assistant: the conversation (restored from and saved to
 * this device), the current progress line, and send / stop / reset actions.
 */
export const useAssistant = (memories: Memory[]) => {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Latest values for use inside async callbacks without re-creating them.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const memoriesRef = useRef(memories);
  memoriesRef.current = memories;
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadConversation().then(saved => {
      if (cancelled) return;
      // Don't clobber a question asked before the saved conversation arrived.
      setMessages(current => (current.length > 0 ? current : saved));
      setIsLoaded(true);
    });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  const commit = useCallback((next: AssistantMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
    void saveConversation(next);
  }, []);

  const send = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || abortRef.current) return;

    const previous = messagesRef.current;
    const lastAnswer = [...previous].reverse().find(m => m.role === 'assistant' && !m.isError);
    commit([...previous, { id: newId(), role: 'user', text: question, timestamp: Date.now() }]);

    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('Searching your notes…');

    const reply = (fields: Partial<AssistantMessage> & { text: string }) =>
      commit([...messagesRef.current, { id: newId(), role: 'assistant', timestamp: Date.now(), ...fields }]);

    try {
      const answer = await runAssistantTurn({
        question,
        history: toTurns(previous),
        memories: memoriesRef.current,
        previousSourceIds: lastAnswer?.sourceIds,
        onStatus: setStatus,
        signal: controller.signal,
      });
      reply({ text: answer.answer, beyondNotes: answer.beyondNotes || undefined, sourceIds: answer.sourceIds });
    } catch (e) {
      if (!(e instanceof AssistantCancelledError)) {
        console.error('[Assistant] Turn failed', e);
        const isRateLimit = e instanceof Error && e.message.includes('429');
        reply({ text: isRateLimit ? RATE_LIMIT_TEXT : ERROR_TEXT, isError: true });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStatus(null);
    }
  }, [commit]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    commit([]);
  }, [commit]);

  return { messages, status, isBusy: status !== null, isLoaded, send, stop, reset };
};
