/**
 * Read one attachment out of a note stored in the user's Google Drive.
 *
 * The app syncs each note to the Drive appDataFolder as `<noteId>.json`, with
 * attachments inline as base64 data URIs. The assistant uses this to open a
 * file without the phone having to upload it again: the server downloads the
 * note with the user's own access token (scope `drive.appdata`, so only this
 * app's folder is reachable) and picks the attachment out.
 *
 * Nothing is stored: the note is held in memory for the request only.
 */

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

/** Largest attachment the assistant will read (decoded bytes). */
export const MAX_ASSISTANT_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/**
 * Largest note file fetched from Drive. A note holds all its attachments as
 * base64 (4/3 the size), so this fits one maximum-size attachment plus the
 * note's own text; bigger notes go through the app-upload fallback.
 */
export const MAX_DRIVE_NOTE_BYTES = 30 * 1024 * 1024;

/** Note IDs are interpolated into a Drive query, so keep them to a safe charset. */
export const NOTE_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Failure the client can act on. `code` values:
 *  - not_on_drive: the note or attachment isn't in Drive (sync off / not yet uploaded)
 *  - note_too_large: the note file exceeds MAX_DRIVE_NOTE_BYTES
 *  - too_large: the attachment itself exceeds MAX_ASSISTANT_ATTACHMENT_BYTES
 *  - drive_error: Drive refused or failed the request
 */
export class AttachmentError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'AttachmentError';
    this.code = code;
    this.status = status;
  }
}

/** Decoded size of a base64 string, without decoding it. */
export const base64Bytes = (b64) => {
  const len = b64.length;
  if (len === 0) return 0;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
};

/** Read a response body, giving up as soon as it passes `maxBytes`. */
const readCapped = async (response, maxBytes) => {
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new AttachmentError('note_too_large', 'Note file is too large to read from Drive', 413);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
};

/**
 * Fetch `<noteId>.json` from the user's Drive and return one attachment as
 * `{ name, mimeType, base64 }`. Throws AttachmentError on any failure.
 */
export const fetchNoteAttachment = async ({ accessToken, noteId, attachmentId, signal, fetchImpl = fetch }) => {
  if (!NOTE_ID_RE.test(noteId)) throw new AttachmentError('not_on_drive', 'Invalid note id', 400);
  const headers = { Authorization: `Bearer ${accessToken}` };

  // 1. Locate the note file. Drive allows duplicate names, so take the newest.
  const query = `name = '${noteId}.json' and 'appDataFolder' in parents and trashed = false`;
  const listUrl = `${DRIVE_FILES_URL}?spaces=appDataFolder&orderBy=modifiedTime desc&pageSize=1`
    + `&q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id,size)')}`;
  let listRes;
  try {
    listRes = await fetchImpl(listUrl, { headers, signal });
  } catch (err) {
    throw new AttachmentError('drive_error', `Drive lookup failed: ${err.message}`);
  }
  if (!listRes.ok) throw new AttachmentError('drive_error', `Drive lookup failed (${listRes.status})`);
  const file = (await listRes.json())?.files?.[0];
  if (!file?.id) throw new AttachmentError('not_on_drive', 'Note is not in Drive', 404);
  if (Number(file.size) > MAX_DRIVE_NOTE_BYTES) {
    throw new AttachmentError('note_too_large', 'Note file is too large to read from Drive', 413);
  }

  // 2. Download it (capped, in case the reported size was missing or stale).
  let note;
  try {
    const res = await fetchImpl(`${DRIVE_FILES_URL}/${encodeURIComponent(file.id)}?alt=media`, { headers, signal });
    if (!res.ok) throw new AttachmentError('drive_error', `Drive download failed (${res.status})`);
    note = JSON.parse((await readCapped(res, MAX_DRIVE_NOTE_BYTES)).toString('utf8'));
  } catch (err) {
    if (err instanceof AttachmentError) throw err;
    throw new AttachmentError('drive_error', `Drive download failed: ${err.message}`);
  }

  // 3. Pick the attachment out.
  const attachment = Array.isArray(note?.attachments)
    ? note.attachments.find((a) => a && a.id === attachmentId)
    : null;
  if (!attachment || typeof attachment.data !== 'string' || !attachment.data) {
    throw new AttachmentError('not_on_drive', 'Attachment is not in the Drive copy of this note', 404);
  }
  const base64 = attachment.data.includes(',') ? attachment.data.slice(attachment.data.indexOf(',') + 1) : attachment.data;
  if (base64Bytes(base64) > MAX_ASSISTANT_ATTACHMENT_BYTES) {
    throw new AttachmentError('too_large', 'Attachment is larger than the assistant can read', 413);
  }

  return {
    name: typeof attachment.name === 'string' ? attachment.name : 'attachment',
    mimeType: typeof attachment.mimeType === 'string' ? attachment.mimeType : '',
    base64,
  };
};
