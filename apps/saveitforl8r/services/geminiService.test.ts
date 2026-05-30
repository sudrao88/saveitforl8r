/**
 * Tests for the >1.2 MB request fallback in queryBrain, submitMomentCreation,
 * and submitResynthesis. Small payloads send notes/memories inline; large
 * payloads chunk-upload the context to the Gemini File API and send only the
 * resulting fileUri to the server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Memory, Moment } from '../types';

// proxyService + chunkUploadService both live behind the @l8r/shared/ai barrel
// now, so their mocks are merged into a single factory.
vi.mock('@l8r/shared/ai', () => ({
  postProxy: vi.fn(),
  getProxyUrl: vi.fn(() => 'https://proxy.example.com'),
  uploadFileChunked: vi.fn(),
  // Use the real threshold value so the branch boundary stays meaningful.
  LARGE_PAYLOAD_THRESHOLD: 1_200_000,
}));

vi.mock('@l8r/shared/auth', () => ({
  getValidToken: vi.fn(async () => 'fake-token'),
}));

vi.mock('./backgroundSyncQueue', () => ({
  enqueue: vi.fn(),
}));

import { postProxy } from '@l8r/shared/ai';
import { uploadFileChunked } from '@l8r/shared/ai';
import { queryBrain, submitMomentCreation, submitResynthesis } from './geminiService';

const mockPostProxy = postProxy as unknown as ReturnType<typeof vi.fn>;
const mockUploadFileChunked = uploadFileChunked as unknown as ReturnType<typeof vi.fn>;

const FAKE_FILE_URI = 'https://generativelanguage.googleapis.com/v1beta/files/abc123';
const FAKE_FILE_NAME = 'files/abc123';

const makeMemory = (id: string, contentLength = 100): Memory => ({
  id,
  content: 'x'.repeat(contentLength),
  tags: ['t1'],
  timestamp: 1700000000000,
  attachments: [],
}) as Memory;

describe('geminiService — large-payload File API fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadFileChunked.mockResolvedValue({
      fileUri: FAKE_FILE_URI,
      geminiFileName: FAKE_FILE_NAME,
    });
  });

  describe('queryBrain', () => {
    it('sends memories inline when payload is small', async () => {
      mockPostProxy.mockResolvedValue({ answer: 'ok', sources: [] });
      const memories = [makeMemory('mem-1'), makeMemory('mem-2')];

      await queryBrain('what happened?', memories);

      expect(mockUploadFileChunked).not.toHaveBeenCalled();
      expect(mockPostProxy).toHaveBeenCalledTimes(1);
      const [path, body] = mockPostProxy.mock.calls[0];
      expect(path).toBe('/api/query');
      expect(body.memories).toBeDefined();
      expect(body.memoriesFileUri).toBeUndefined();
    });

    it('uploads context as text/plain and omits memories when payload exceeds threshold', async () => {
      mockPostProxy.mockResolvedValue({ answer: 'ok', sources: [] });
      // 200 memories × ~10KB content each ≈ 2 MB — well over the 1.2 MB threshold.
      const memories = Array.from({ length: 200 }, (_, i) => makeMemory(`mem-${i}`, 10_000));

      await queryBrain('what happened?', memories);

      expect(mockUploadFileChunked).toHaveBeenCalledTimes(1);
      const [blob, mimeType] = mockUploadFileChunked.mock.calls[0];
      expect(blob).toBeInstanceOf(Blob);
      expect(mimeType).toBe('text/plain');

      expect(mockPostProxy).toHaveBeenCalledTimes(1);
      const [path, body] = mockPostProxy.mock.calls[0];
      expect(path).toBe('/api/query');
      expect(body.memoriesFileUri).toBe(FAKE_FILE_URI);
      expect(body.memoriesFileName).toBe(FAKE_FILE_NAME);
      expect(body.memories).toBeUndefined();
      expect(body.query).toBe('what happened?');
    });
  });

  describe('submitMomentCreation', () => {
    it('sends notes inline when payload is small', async () => {
      mockPostProxy.mockResolvedValue({ status: 'accepted', momentId: 'mom-1' });
      const memories = [makeMemory('mem-1')];

      await submitMomentCreation('plan a trip', memories, 'mom-1');

      expect(mockUploadFileChunked).not.toHaveBeenCalled();
      const [path, body] = mockPostProxy.mock.calls[0];
      expect(path).toBe('/api/create-moment');
      expect(body.notes).toBeDefined();
      expect(body.notesFileUri).toBeUndefined();
    });

    it('uploads context and sends notesFileUri when payload exceeds threshold', async () => {
      mockPostProxy.mockResolvedValue({ status: 'accepted', momentId: 'mom-1' });
      const memories = Array.from({ length: 300 }, (_, i) => makeMemory(`mem-${i}`, 5_000));

      await submitMomentCreation('plan a trip', memories, 'mom-1');

      expect(mockUploadFileChunked).toHaveBeenCalledTimes(1);
      const [path, body] = mockPostProxy.mock.calls[0];
      expect(path).toBe('/api/create-moment');
      expect(body.notesFileUri).toBe(FAKE_FILE_URI);
      expect(body.notesFileName).toBe(FAKE_FILE_NAME);
      expect(body.noteCount).toBe(300);
      expect(body.notes).toBeUndefined();
      expect(body.objective).toBe('plan a trip');
    });
  });

  describe('submitResynthesis', () => {
    const moment = {
      id: 'mom-1',
      title: 'My Moment',
      type: 'general',
      objective: 'test objective',
      noteIds: [],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    } as unknown as Moment;

    it('sends notes inline when payload is small', async () => {
      mockPostProxy.mockResolvedValue({ status: 'accepted', momentId: 'mom-1' });
      const memories = [makeMemory('mem-1')];
      const m: Moment = { ...moment, noteIds: ['mem-1'] } as Moment;

      await submitResynthesis(m, memories);

      expect(mockUploadFileChunked).not.toHaveBeenCalled();
      const [path, body] = mockPostProxy.mock.calls[0];
      expect(path).toBe('/api/synthesize');
      expect(body.notes).toBeDefined();
      expect(body.notesFileUri).toBeUndefined();
    });

    it('uploads context and sends notesFileUri when payload exceeds threshold', async () => {
      mockPostProxy.mockResolvedValue({ status: 'accepted', momentId: 'mom-1' });
      const memories = Array.from({ length: 300 }, (_, i) => makeMemory(`mem-${i}`, 5_000));
      const m: Moment = { ...moment, noteIds: memories.map((mem) => mem.id) } as Moment;

      await submitResynthesis(m, memories);

      expect(mockUploadFileChunked).toHaveBeenCalledTimes(1);
      const [path, body] = mockPostProxy.mock.calls[0];
      expect(path).toBe('/api/synthesize');
      expect(body.notesFileUri).toBe(FAKE_FILE_URI);
      expect(body.notesFileName).toBe(FAKE_FILE_NAME);
      expect(body.noteCount).toBe(300);
      expect(body.notes).toBeUndefined();
      expect(body.momentId).toBe('mom-1');
    });
  });
});
