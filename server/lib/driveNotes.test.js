import { describe, it, expect, vi } from 'vitest';
import {
  AttachmentError,
  base64Bytes,
  fetchNoteAttachment,
  MAX_ASSISTANT_ATTACHMENT_BYTES,
  MAX_DRIVE_NOTE_BYTES,
} from './driveNotes.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const pdf = Buffer.from('%PDF-1.4 hello').toString('base64');
const note = {
  id: 'note-1',
  content: 'Lease',
  attachments: [
    { id: 'att-1', name: 'lease.pdf', mimeType: 'application/pdf', data: `data:application/pdf;base64,${pdf}` },
    { id: 'att-2', name: 'stub.pdf', mimeType: 'application/pdf', fileUri: 'https://x' },
  ],
};

/** A fetch that answers the Drive list call, then the download call. */
const drive = (listBody, downloadResponse) => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(json(listBody))
    .mockResolvedValueOnce(downloadResponse);
  return fetchImpl;
};
const call = (fetchImpl, extra = {}) =>
  fetchNoteAttachment({ accessToken: 'tok', noteId: 'note-1', attachmentId: 'att-1', fetchImpl, ...extra });
const codeOf = async (promise) => {
  try {
    await promise;
    return 'resolved';
  } catch (e) {
    expect(e).toBeInstanceOf(AttachmentError);
    return e.code;
  }
};

describe('base64Bytes', () => {
  it('gives the decoded size', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'hello world']) {
      expect(base64Bytes(Buffer.from(s).toString('base64'))).toBe(s.length);
    }
  });
});

describe('fetchNoteAttachment', () => {
  it('finds the note in the app folder with the user token and returns the attachment', async () => {
    const fetchImpl = drive({ files: [{ id: 'file-9', size: '2048' }] }, json(note));
    const out = await call(fetchImpl);

    expect(out).toEqual({ name: 'lease.pdf', mimeType: 'application/pdf', base64: pdf });
    const [listUrl, listOpts] = fetchImpl.mock.calls[0];
    expect(listUrl).toContain('spaces=appDataFolder');
    expect(decodeURIComponent(listUrl)).toContain("name = 'note-1.json' and 'appDataFolder' in parents");
    expect(listOpts.headers.Authorization).toBe('Bearer tok');
    expect(fetchImpl.mock.calls[1][0]).toContain('/files/file-9?alt=media');
  });

  it('rejects note ids that could alter the Drive query, without calling Drive', async () => {
    const fetchImpl = vi.fn();
    expect(await codeOf(call(fetchImpl, { noteId: "x' or name contains '" }))).toBe('not_on_drive');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a note that is not in Drive', async () => {
    expect(await codeOf(call(vi.fn().mockResolvedValueOnce(json({ files: [] }))))).toBe('not_on_drive');
  });

  it('reports an attachment missing from the Drive copy, or stored without data', async () => {
    const list = { files: [{ id: 'f', size: '10' }] };
    expect(await codeOf(call(drive(list, json(note)), { attachmentId: 'nope' }))).toBe('not_on_drive');
    expect(await codeOf(call(drive(list, json(note)), { attachmentId: 'att-2' }))).toBe('not_on_drive');
  });

  it('refuses a note file over the size cap before downloading it', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ files: [{ id: 'f', size: String(MAX_DRIVE_NOTE_BYTES + 1) }] }));
    expect(await codeOf(call(fetchImpl))).toBe('note_too_large');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('stops a download that turns out larger than the cap', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (sent++ > MAX_DRIVE_NOTE_BYTES / chunk.length + 1) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const fetchImpl = drive({ files: [{ id: 'f' }] }, new Response(body));
    expect(await codeOf(call(fetchImpl))).toBe('note_too_large');
  });

  it('refuses an attachment over the per-file cap', async () => {
    const big = 'A'.repeat(Math.ceil((MAX_ASSISTANT_ATTACHMENT_BYTES + 3) / 3) * 4);
    const bigNote = { attachments: [{ id: 'att-1', name: 'big.pdf', mimeType: 'application/pdf', data: big }] };
    expect(await codeOf(call(drive({ files: [{ id: 'f', size: '10' }] }, json(bigNote))))).toBe('too_large');
  });

  it('reports Drive failures', async () => {
    expect(await codeOf(call(vi.fn().mockResolvedValueOnce(json({}, 403))))).toBe('drive_error');
    expect(await codeOf(call(vi.fn().mockRejectedValueOnce(new Error('network'))))).toBe('drive_error');
    expect(await codeOf(call(drive({ files: [{ id: 'f', size: '10' }] }, json({}, 500))))).toBe('drive_error');
    expect(await codeOf(call(drive({ files: [{ id: 'f', size: '10' }] }, new Response('not json'))))).toBe('drive_error');
  });
});
