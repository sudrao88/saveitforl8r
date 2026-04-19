import { describe, it, expect, vi } from 'vitest';
import { processFileInputs, MAX_FILE_SIZE_BYTES, MAX_ATTACHMENTS } from './attachmentUtils';

/**
 * Build a File-like object whose `size` can be forced beyond real content
 * length (needed to exercise the MAX_FILE_SIZE_BYTES rejection without
 * allocating gigabytes of memory).
 */
const makeFile = (name: string, type: string, size: number, content: string = ''): File => {
  const blob = new Blob([content], { type });
  const file = new File([blob], name, { type });
  // jsdom computes size from content — override so tests can assert the
  // reject-by-size branch cheaply.
  Object.defineProperty(file, 'size', { value: size, configurable: true });
  return file;
};

describe('processFileInputs', () => {
  it('returns empty arrays for an empty input list', async () => {
    const result = await processFileInputs([]);
    expect(result.attachments).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('processes a single small text file as type "file"', async () => {
    const file = makeFile('notes.txt', 'text/plain', 100, 'hello');
    const { attachments, rejected } = await processFileInputs([file]);
    expect(rejected).toEqual([]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      type: 'file',
      name: 'notes.txt',
      mimeType: 'text/plain',
    });
    expect(attachments[0].data?.startsWith('data:text/plain')).toBe(true);
    expect(attachments[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('tags small image files as type "image" and skips compression', async () => {
    // Small PNG: under IMAGE_COMPRESSION_THRESHOLD so compressImage is not invoked.
    const file = makeFile('photo.png', 'image/png', 1024, 'fake-png-data');
    const { attachments, rejected } = await processFileInputs([file]);
    expect(rejected).toEqual([]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].type).toBe('image');
    expect(attachments[0].mimeType).toBe('image/png');
    expect(attachments[0].name).toBe('photo.png');
  });

  it('rejects files larger than MAX_FILE_SIZE_BYTES and keeps acceptable ones', async () => {
    const ok = makeFile('ok.txt', 'text/plain', 1024, 'ok');
    const tooBig = makeFile('huge.bin', 'application/octet-stream', MAX_FILE_SIZE_BYTES + 1);
    const { attachments, rejected } = await processFileInputs([ok, tooBig]);
    expect(rejected).toEqual([
      { name: 'huge.bin', size: MAX_FILE_SIZE_BYTES + 1 },
    ]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].name).toBe('ok.txt');
  });

  it('accepts files exactly at the size limit', async () => {
    const atLimit = makeFile('edge.txt', 'text/plain', MAX_FILE_SIZE_BYTES, 'x');
    const { attachments, rejected } = await processFileInputs([atLimit]);
    expect(rejected).toEqual([]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].name).toBe('edge.txt');
  });

  it('assigns a distinct id to each processed attachment', async () => {
    const files = [
      makeFile('a.txt', 'text/plain', 10, 'a'),
      makeFile('b.txt', 'text/plain', 10, 'b'),
      makeFile('c.txt', 'text/plain', 10, 'c'),
    ];
    const { attachments } = await processFileInputs(files);
    const ids = new Set(attachments.map(a => a.id));
    expect(ids.size).toBe(3);
  });

  it('preserves original filename when no compression happens', async () => {
    const file = makeFile('My Document (final).txt', 'text/plain', 10, 'x');
    const { attachments } = await processFileInputs([file]);
    expect(attachments[0].name).toBe('My Document (final).txt');
  });

  it('accepts a FileList-like array', async () => {
    const files = [
      makeFile('a.txt', 'text/plain', 10, 'a'),
      makeFile('b.txt', 'text/plain', 10, 'b'),
    ];
    // Simulate a FileList (array-like with length + Symbol.iterator via Array.from path)
    const fileList = files as unknown as FileList;
    const { attachments } = await processFileInputs(fileList);
    expect(attachments).toHaveLength(2);
  });

  it('still processes remaining files when one is rejected', async () => {
    const tooBig = makeFile('huge.bin', 'application/octet-stream', MAX_FILE_SIZE_BYTES + 100);
    const ok1 = makeFile('a.txt', 'text/plain', 10, 'a');
    const ok2 = makeFile('b.txt', 'text/plain', 10, 'b');
    const { attachments, rejected } = await processFileInputs([tooBig, ok1, ok2]);
    expect(rejected).toHaveLength(1);
    expect(attachments.map(a => a.name)).toEqual(['a.txt', 'b.txt']);
  });

  it('handles many small files in a single call', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeFile(`f${i}.txt`, 'text/plain', 10, String(i)),
    );
    const { attachments } = await processFileInputs(many);
    // processFileInputs itself does not enforce MAX_ATTACHMENTS — the caller
    // is expected to slice. This test pins the current contract so a future
    // change is explicit.
    expect(attachments.length).toBe(25);
    expect(attachments.length).toBeGreaterThan(MAX_ATTACHMENTS);
  });

  it('uses FileReader to produce a base64 data URL', async () => {
    const file = makeFile('hello.txt', 'text/plain', 5, 'hello');
    const { attachments } = await processFileInputs([file]);
    // "hello" encoded as base64 is "aGVsbG8=".
    expect(attachments[0].data).toBe('data:text/plain;base64,aGVsbG8=');
  });
});

describe('attachment limits', () => {
  it('exposes MAX_ATTACHMENTS matching the server-side cap', () => {
    // Mirror of the value in server/middleware/validation.js — if one
    // changes, the other must too. Pinning prevents silent drift.
    expect(MAX_ATTACHMENTS).toBe(20);
  });

  it('MAX_FILE_SIZE_BYTES is a round 50 MiB', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(50 * 1024 * 1024);
  });
});

// Silence unused-import warning for vi in environments that tree-shake.
void vi;
