/**
 * assistantAttachments.ts
 *
 * The assistant's read_attachment tool: ask the server what one file of a
 * note says about a question.
 *
 * The server first tries to read the file from the user's Drive, so the phone
 * doesn't have to upload it. When the note isn't there (sync off, not yet
 * uploaded, or the note file is too big to fetch whole), the app sends the
 * file itself: inline when small, otherwise through the chunked upload used
 * for enrichment.
 */
import { Memory } from '../types';
import { AssistantToolCall, AssistantToolResult, findAttachment } from '../utils/assistantTools';
import { AssistantApiError, AssistantCancelledError, postAssistant } from './assistantApi';
import { LARGE_PAYLOAD_THRESHOLD, uploadFileChunked } from './chunkUploadService';
import { getMemory } from './storageService';

type ReadAttachmentCall = Extract<AssistantToolCall, { tool: 'read_attachment' }>;

/** Mirrors MAX_ASSISTANT_ATTACHMENT_BYTES in server/lib/driveNotes.js. */
export const MAX_ASSISTANT_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** Mirrors ALLOWED_MIME_TYPES in server/middleware/validation.js. */
export const READABLE_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/markdown',
];
// Drive download + Gemini read; the hosting layer cuts requests off at 60s.
const READ_TIMEOUT_MS = 58_000;
// Server codes that mean "the Drive copy can't be used, send the file yourself".
const FALLBACK_CODES = new Set(['not_on_drive', 'note_too_large', 'drive_error']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOO_LARGE = 'This file is larger than the 20 MB the assistant can read. Answer from the note\'s text and summary instead, and tell the user the file was too large to open.';

const base64Of = (dataUri: string): string => (dataUri.includes(',') ? dataUri.slice(dataUri.indexOf(',') + 1) : dataUri);
const base64Bytes = (b64: string): number =>
  Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

const base64ToBlob = async (b64: string, mimeType: string): Promise<Blob> => {
  try {
    return await (await fetch(`data:${mimeType};base64,${b64}`)).blob();
  } catch {
    return new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: mimeType });
  }
};

interface ReadOptions {
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}

/**
 * Run one read_attachment call. Always resolves to a tool result (problems are
 * reported to the model as text) unless the user cancels.
 */
export const readAttachment = async (
  call: ReadAttachmentCall,
  memories: Memory[],
  { signal, onStatus }: ReadOptions = {},
): Promise<AssistantToolResult> => {
  const result = (text: string): AssistantToolResult => ({
    tool: 'read_attachment',
    args: `${call.noteId}, ${JSON.stringify((call.attachment || "").slice(0, 200))}`,
    result: text,
  });

  const memory = memories.find(m => m.id === call.noteId && !m.isDeleted && !m.isDeleting);
  if (!memory) return result(`[ID: ${call.noteId}] No note has this ID.`);
  const attachment = findAttachment(memory, call.attachment);
  if (!attachment) {
    const names = (memory.attachments || []).map(a => a.name).join(', ');
    return result(names ? `This note has no attachment with that name. Its attachments: ${names}` : 'This note has no attachments.');
  }
  if (!READABLE_MIME_TYPES.includes(attachment.mimeType)) {
    return result(`${attachment.name} is a ${attachment.mimeType || 'file'} that the assistant cannot open. Answer from the note's text and summary instead.`);
  }

  const request = { noteId: memory.id, attachmentId: attachment.id, name: attachment.name, question: call.query };
  const read = (extra: Record<string, unknown> = {}) =>
    postAssistant<{ text: string }>('/api/assistant/attachment', { ...request, ...extra }, READ_TIMEOUT_MS, signal);
  const wrap = (text: string) => result(`FILE: ${attachment.name} (note ${memory.id})\n${text}`);

  try {
    onStatus?.(`Opening ${attachment.name}…`);
    try {
      return wrap((await read()).text);
    } catch (e) {
      if (!(e instanceof AssistantApiError) || !e.code || !FALLBACK_CODES.has(e.code)) throw e;
    }

    // Fallback: the Drive copy isn't usable, so send the file from this device.
    const full = await getMemory(memory.id);
    const data = full?.attachments?.find(a => a.id === attachment.id)?.data;
    if (!data) return result(`${attachment.name} is not available on this device or in Drive, so it could not be opened.`);
    const b64 = base64Of(data);
    if (base64Bytes(b64) > MAX_ASSISTANT_ATTACHMENT_BYTES) return result(TOO_LARGE);

    if (b64.length <= LARGE_PAYLOAD_THRESHOLD) {
      return wrap((await read({ mimeType: attachment.mimeType, data: b64 })).text);
    }
    onStatus?.(`Uploading ${attachment.name}…`);
    const blob = await base64ToBlob(b64, attachment.mimeType);
    const ownerId = UUID_RE.test(memory.id) ? memory.id : crypto.randomUUID();
    const uploaded = await uploadFileChunked(blob, attachment.mimeType, attachment.name.slice(0, 256), ownerId, undefined, signal);
    onStatus?.(`Reading ${attachment.name}…`);
    return wrap((await read({
      mimeType: attachment.mimeType, fileUri: uploaded.fileUri, fileName: uploaded.geminiFileName,
    })).text);
  } catch (e) {
    if (e instanceof AssistantCancelledError || signal?.aborted) throw new AssistantCancelledError();
    if (e instanceof AssistantApiError && e.code === 'too_large') return result(TOO_LARGE);
    console.warn('[Assistant] Could not read attachment', e);
    return result(`${attachment.name} could not be opened right now. Answer from the note's text and summary instead, and tell the user the file could not be opened.`);
  }
};
