/**
 * Tests for the >1.2 MB request fallback in queryBrain (small payloads send
 * memories inline; large payloads chunk-upload the context to the Gemini File
 * API and send only the resulting fileUri), and for embedMomentTerms.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Memory } from '../types';

vi.mock('./proxyService', () => ({
  postProxy: vi.fn(),
  getProxyUrl: vi.fn(() => 'https://proxy.example.com'),
}));

vi.mock('./googleAuth', () => ({
  getValidToken: vi.fn(async () => 'fake-token'),
}));

vi.mock('./backgroundSyncQueue', () => ({
  enqueue: vi.fn(),
}));

vi.mock('./chunkUploadService', () => ({
  uploadFileChunked: vi.fn(),
  // Use the real threshold value so the branch boundary stays meaningful.
  LARGE_PAYLOAD_THRESHOLD: 1_200_000,
}));

import { postProxy } from './proxyService';
import { uploadFileChunked } from './chunkUploadService';
import { queryBrain, embedMomentTerms } from './geminiService';

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

  describe('embedMomentTerms', () => {
    it('posts the terms and returns one vector per term plus the emoji', async () => {
      mockPostProxy.mockResolvedValue({ vectors: [[1, 0], [0, 1]], intentVector: [0.6, 0.8], emoji: '🇸🇬', model: 'gemini-embedding-2' });

      const result = await embedMomentTerms(['Singapore', 'hawker food']);

      const [path, body] = mockPostProxy.mock.calls[0];
      expect(path).toBe('/api/moment/embed');
      expect(body).toEqual({ terms: ['Singapore', 'hawker food'] });
      expect(result.vectors).toHaveLength(2);
      expect(result.intentVector).toEqual([0.6, 0.8]);
      expect(result.emoji).toBe('🇸🇬');
    });

    it('throws on a malformed intent vector', async () => {
      mockPostProxy.mockResolvedValue({ vectors: [[1, 0]], intentVector: [], emoji: '✨', model: 'gemini-embedding-2' });
      await expect(embedMomentTerms(['a'])).rejects.toThrow();
    });

    it('throws when the vector count does not match the terms', async () => {
      mockPostProxy.mockResolvedValue({ vectors: [[1, 0]], emoji: '✨', model: 'gemini-embedding-2' });
      await expect(embedMomentTerms(['a', 'b'])).rejects.toThrow();
    });
  });
});
