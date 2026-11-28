/**
 * Tests for embedMomentTerms and the search query embedding call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { postProxy } from './proxyService';
import { embedMomentTerms, embedTexts } from './geminiService';

const mockPostProxy = postProxy as unknown as ReturnType<typeof vi.fn>;
describe('geminiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('embedTexts', () => {
    it('posts only the given texts to /api/embed and returns the vectors', async () => {
      mockPostProxy.mockResolvedValue({ embeddings: [[0.6, 0.8]], model: 'gemini-embedding-2' });

      const result = await embedTexts(['coffee in bangalore']);

      expect(mockPostProxy).toHaveBeenCalledWith('/api/embed', { texts: ['coffee in bangalore'] });
      expect(result).toEqual([[0.6, 0.8]]);
    });

    it('skips the request for an empty batch', async () => {
      expect(await embedTexts([])).toEqual([]);
      expect(mockPostProxy).not.toHaveBeenCalled();
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
