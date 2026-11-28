import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Memory } from '../types';

vi.mock('./proxyService', () => ({ postProxy: vi.fn() }));
vi.mock('./chunkUploadService', () => ({ uploadFileChunked: vi.fn(), LARGE_PAYLOAD_THRESHOLD: 1_200_000 }));
vi.mock('./storageService', () => ({ getMemory: vi.fn() }));

import { postProxy } from './proxyService';
import { uploadFileChunked } from './chunkUploadService';
import { getMemory } from './storageService';
import { AssistantCancelledError } from './assistantApi';
import { MAX_ASSISTANT_ATTACHMENT_BYTES, readAttachment } from './assistantAttachments';

const post = vi.mocked(postProxy);
const upload = vi.mocked(uploadFileChunked);
const stored = vi.mocked(getMemory);

const NOTE_ID = '3f2b8c1e-6a4d-4e2b-9c1a-0d5e7f8a9b10';
const att = (extra = {}) => ({ id: 'att-1', type: 'file' as const, mimeType: 'application/pdf', name: 'Lease.pdf', ...extra });
const note = (attachments: any[] = [att()]): Memory => ({ id: NOTE_ID, timestamp: 1, content: 'Lease', tags: [], attachments });
const call = { tool: 'read_attachment' as const, noteId: NOTE_ID, attachment: 'lease.pdf', query: 'notice period?' };
const notOnDrive = () => new Error('Proxy error 404: {"error":"Note is not in Drive","code":"not_on_drive"}');
const bodyOf = (n: number) => post.mock.calls[n][1] as any;

beforeEach(() => {
  post.mockReset();
  upload.mockReset();
  stored.mockReset();
});

describe('readAttachment', () => {
  it('asks the server to read the file from Drive, sending no file data', async () => {
    post.mockResolvedValueOnce({ text: 'Notice period is 60 days.' });
    const out = await readAttachment(call, [note()]);

    expect(out.tool).toBe('read_attachment');
    expect(out.result).toBe(`FILE: Lease.pdf (note ${NOTE_ID})\nNotice period is 60 days.`);
    expect(post.mock.calls[0][0]).toBe('/api/assistant/attachment');
    expect(bodyOf(0)).toEqual({ noteId: NOTE_ID, attachmentId: 'att-1', name: 'Lease.pdf', question: 'notice period?' });
    expect(stored).not.toHaveBeenCalled();
  });

  it('falls back to sending a small file inline when the note is not in Drive', async () => {
    post.mockRejectedValueOnce(notOnDrive()).mockResolvedValueOnce({ text: 'From the device copy.' });
    stored.mockResolvedValueOnce(note([att({ data: 'data:application/pdf;base64,QUJD' })]));

    const out = await readAttachment(call, [note()]);

    expect(out.result).toContain('From the device copy.');
    expect(bodyOf(1)).toMatchObject({ mimeType: 'application/pdf', data: 'QUJD' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('falls back to a chunked upload for a large file', async () => {
    const b64 = 'A'.repeat(1_600_000);
    post.mockRejectedValueOnce(notOnDrive()).mockResolvedValueOnce({ text: 'From the upload.' });
    stored.mockResolvedValueOnce(note([att({ data: `data:application/pdf;base64,${b64}` })]));
    upload.mockResolvedValueOnce({ fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', geminiFileName: 'files/abc' });
    const statuses: string[] = [];

    const out = await readAttachment(call, [note()], { onStatus: s => statuses.push(s) });

    expect(out.result).toContain('From the upload.');
    expect(upload.mock.calls[0].slice(1, 4)).toEqual(['application/pdf', 'Lease.pdf', NOTE_ID]);
    expect(bodyOf(1)).toMatchObject({ fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', fileName: 'files/abc' });
    expect(bodyOf(1).data).toBeUndefined();
    expect(statuses).toEqual(['Opening Lease.pdf…', 'Uploading Lease.pdf…', 'Reading Lease.pdf…']);
  });

  it('does not upload a file over the size cap', async () => {
    const b64 = 'A'.repeat(Math.ceil((MAX_ASSISTANT_ATTACHMENT_BYTES + 3) / 3) * 4);
    post.mockRejectedValueOnce(notOnDrive());
    stored.mockResolvedValueOnce(note([att({ data: b64 })]));

    const out = await readAttachment(call, [note()]);

    expect(out.result).toContain('larger than the 20 MB');
    expect(upload).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('reports a file the server says is too large, without falling back', async () => {
    post.mockRejectedValueOnce(new Error('Proxy error 413: {"error":"x","code":"too_large"}'));
    const out = await readAttachment(call, [note()]);
    expect(out.result).toContain('larger than the 20 MB');
    expect(stored).not.toHaveBeenCalled();
  });

  it('tells the model when the file is missing, unreadable or unsupported', async () => {
    expect((await readAttachment({ ...call, noteId: 'nope' }, [note()])).result).toContain('No note has this ID');
    expect((await readAttachment(call, [note([])])).result).toBe('This note has no attachments.');
    expect((await readAttachment({ ...call, attachment: 'other' }, [note([att(), att({ id: 'a2', name: 'Scan.png' })])])).result)
      .toContain('Its attachments: Lease.pdf, Scan.png');
    expect((await readAttachment(call, [note([att({ mimeType: 'application/zip' })])])).result).toContain('cannot open');
    expect(post).not.toHaveBeenCalled();

    post.mockRejectedValueOnce(new Error('Proxy error 502: {"error":"x","code":"read_failed"}'));
    expect((await readAttachment(call, [note()])).result).toContain('could not be opened right now');

    post.mockRejectedValueOnce(notOnDrive());
    stored.mockResolvedValueOnce(note([att()])); // no data on this device either
    expect((await readAttachment(call, [note()])).result).toContain('not available on this device or in Drive');
  });

  it('throws when the user cancels', async () => {
    const controller = new AbortController();
    post.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error('Request timed out');
    });
    await expect(readAttachment(call, [note()], { signal: controller.signal })).rejects.toBeInstanceOf(AssistantCancelledError);
  });
});
