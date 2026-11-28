/**
 * assistantService.ts
 *
 * Runs one question through the notes assistant.
 *
 * The loop is driven from the device because the notes live here: the server
 * (a stateless Gemini proxy) decides each step, asking for more notes through
 * read-only tools or giving the final answer, and this module runs those tools
 * locally. Only the note text a tool returns is sent to the server.
 */
import { Memory } from '../types';
import { embedTexts } from './geminiService';
import { AssistantCancelledError, postAssistant } from './assistantApi';
import { readAttachment } from './assistantAttachments';
import {
  AssistantToolCall,
  AssistantToolResult,
  appendToolResult,
  describeToolCall,
  localDate,
  runAssistantTool,
} from '../utils/assistantTools';

/** Mirrors MAX_ASSISTANT_STEPS in server/lib/assistant.js. */
export const MAX_ASSISTANT_STEPS = 4;
/** Mirrors the server's history limits (server/middleware/validation.js). */
export const MAX_HISTORY_TURNS = 12;
export const MAX_TURN_LENGTH = 6000;
export const MAX_QUESTION_LENGTH = 2000;
/** Notes cited by the previous answer that are re-read for a follow-up. */
const MAX_FOLLOW_UP_NOTES = 3;
/** Files opened per question; each one is a slow round trip. */
export const MAX_ATTACHMENT_READS = 3;
// Each step is one Gemini call; the hosting layer cuts requests off at 60s.
const STEP_TIMEOUT_MS = 55_000;

export interface AssistantTurn {
  role: 'user' | 'model';
  text: string;
}

export interface AssistantAnswer {
  /** What the notes say. */
  answer: string;
  /** Additions from the model's general knowledge, shown separately. */
  beyondNotes: string;
  /** IDs of the notes the answer relies on (only notes that exist). */
  sourceIds: string[];
}

type StepResponse =
  | { type: 'tools'; calls: AssistantToolCall[] }
  | { type: 'answer'; answer: string; beyondNotes?: string; sources?: string[] };

interface StepRequest {
  question: string;
  history: AssistantTurn[];
  toolResults: AssistantToolResult[];
  step: number;
  context: { today: string; noteCount: number };
}

export { AssistantCancelledError };

const postStep = (body: StepRequest, signal?: AbortSignal): Promise<StepResponse> =>
  postAssistant<StepResponse>('/api/assistant/step', body, STEP_TIMEOUT_MS, signal);

const todayLabel = (now: Date): string =>
  `${localDate(now.getTime())} (${now.toLocaleDateString('en-US', { weekday: 'long' })})`;

/** Complete user → model exchanges only, newest last, within the server's limits. */
export const buildHistory = (turns: AssistantTurn[]): AssistantTurn[] => {
  const pairs: AssistantTurn[] = [];
  let pendingUser: AssistantTurn | null = null;
  for (const turn of turns) {
    if (!turn.text) continue;
    if (turn.role === 'user') {
      pendingUser = turn;
    } else if (pendingUser) {
      pairs.push(pendingUser, turn);
      pendingUser = null;
    }
  }
  return pairs
    .slice(-MAX_HISTORY_TURNS)
    .map(t => ({ role: t.role, text: t.text.slice(0, MAX_TURN_LENGTH) }));
};

export interface RunAssistantOptions {
  question: string;
  /** Earlier turns of this conversation, oldest first. */
  history: AssistantTurn[];
  memories: Memory[];
  /** Notes cited by the previous answer; re-read so follow-ups have context. */
  previousSourceIds?: string[];
  onStatus?: (status: string) => void;
  signal?: AbortSignal;
  now?: Date;
}

/**
 * Answer one question. Throws AssistantCancelledError when `signal` aborts,
 * or the underlying error when a step fails.
 */
export const runAssistantTurn = async ({
  question,
  history,
  memories,
  previousSourceIds = [],
  onStatus,
  signal,
  now = new Date(),
}: RunAssistantOptions): Promise<AssistantAnswer> => {
  const ask = question.trim().slice(0, MAX_QUESTION_LENGTH);
  const live = memories.filter(m => !m.isDeleted && !m.isDeleting);
  const liveIds = new Set(live.map(m => m.id));
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new AssistantCancelledError();
  };

  let results: AssistantToolResult[] = [];
  let attachmentReads = 0;

  // Seed the first step with a search for the question itself, so most
  // questions are answered in a single model call.
  onStatus?.('Searching your notes…');
  let queryVector: number[] | undefined;
  try {
    [queryVector] = await embedTexts([ask.slice(0, 500)]);
  } catch (e) {
    console.warn('[Assistant] Query embedding failed, using keyword search only', e);
  }
  throwIfCancelled();
  results = appendToolResult(results, runAssistantTool({ tool: 'search_notes', query: ask.slice(0, 500), queryVector }, live));

  const followUpIds = previousSourceIds.filter(id => liveIds.has(id)).slice(0, MAX_FOLLOW_UP_NOTES);
  if (followUpIds.length > 0) {
    results = appendToolResult(results, runAssistantTool({ tool: 'get_notes', ids: followUpIds }, live));
  }

  const request = {
    question: ask,
    history: buildHistory(history),
    context: { today: todayLabel(now), noteCount: live.length },
  };

  for (let step = 1; step <= MAX_ASSISTANT_STEPS; step++) {
    onStatus?.(step === 1 ? 'Thinking…' : 'Putting it together…');
    const response = await postStep({ ...request, toolResults: results, step }, signal);
    throwIfCancelled();

    if (response.type === 'answer') {
      return {
        answer: response.answer || '',
        beyondNotes: response.beyondNotes || '',
        sourceIds: Array.from(new Set(response.sources || [])).filter(id => liveIds.has(id)),
      };
    }

    for (const call of response.calls || []) {
      onStatus?.(describeToolCall(call));
      if (call.tool !== 'read_attachment') {
        results = appendToolResult(results, runAssistantTool(call, live));
      } else if (attachmentReads >= MAX_ATTACHMENT_READS) {
        results = appendToolResult(results, {
          tool: 'read_attachment',
          args: `${call.noteId}, ${JSON.stringify((call.attachment || "").slice(0, 200))}`,
          result: 'No more files can be opened for this question. Answer with what you have.',
        });
      } else {
        attachmentReads++;
        results = appendToolResult(results, await readAttachment(call, live, { signal, onStatus }));
        throwIfCancelled();
      }
    }
  }

  // The server always answers on the last step; this is a safety net.
  throw new Error('The assistant did not produce an answer');
};
