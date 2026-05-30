/**
 * Chunked resumable file upload service.
 *
 * Splits large files into ~1MB chunks and uploads them sequentially
 * to the server's /api/upload endpoint. Each chunk is retried on failure
 * with exponential backoff. After all chunks arrive, the server assembles
 * the file and uploads it to Gemini File API. This service polls for the
 * result and returns the Gemini file URI.
 */

import { getValidToken } from '../auth/googleAuth';

const getProxyUrl = (): string => {
  const url = import.meta.env.VITE_PROXY_URL;
  if (!url) throw new Error('VITE_PROXY_URL is not configured');
  return url.replace(/\/+$/, '');
};

const CHUNK_SIZE = 900 * 1024; // 900KB — must stay under Firestore's 1 MiB document size limit
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 60_000;

/**
 * Payloads larger than this (in bytes/chars) should be uploaded via the
 * chunked upload endpoint and referenced by Gemini File API URI rather
 * than inlined. Used by attachments (see hooks/useMemories.ts) and by
 * search/synthesis context payloads (see services/geminiService.ts).
 */
export const LARGE_PAYLOAD_THRESHOLD = 1_200_000;

export interface ChunkUploadResult {
  fileUri: string;
  geminiFileName: string;
}

type ProgressCallback = (bytesUploaded: number, totalBytes: number) => void;

interface UploadSessionStatus {
  status: 'uploading' | 'assembling' | 'completed' | 'failed';
  receivedChunks: number[];
  totalChunks: number;
  fileUri: string | null;
  geminiFileName: string | null;
}

/**
 * Upload a file to the server in chunks.
 * Returns the Gemini File API URI and file name once the server has
 * assembled the chunks and uploaded to Gemini.
 */
export const uploadFileChunked = async (
  file: Blob,
  mimeType: string,
  fileName: string,
  memoryId: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<ChunkUploadResult> => {
  const totalBytes = file.size;
  const totalChunks = Math.ceil(totalBytes / CHUNK_SIZE);
  let token = await getValidToken();
  const baseUrl = getProxyUrl();

  // 1. Initialize session
  const initRes = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ fileName, fileSize: totalBytes, mimeType, totalChunks, memoryId }),
    signal,
  });
  if (!initRes.ok) {
    const errBody = await initRes.text().catch(() => '');
    throw new Error(`Upload init failed (${initRes.status}): ${errBody}`);
  }
  const { sessionId } = await initRes.json();

  // 2. Upload chunks sequentially
  let bytesUploaded = 0;
  onProgress?.(0, totalBytes);

  for (let i = 0; i < totalChunks; i++) {
    if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');

    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalBytes);
    const chunk = file.slice(start, end);
    const chunkBuffer = await chunk.arrayBuffer();

    token = await uploadChunkWithRetry(baseUrl, sessionId, i, chunkBuffer, token, signal);

    bytesUploaded = end;
    onProgress?.(bytesUploaded, totalBytes);
  }

  // 3. Poll for assembly completion
  return pollSessionCompletion(baseUrl, sessionId, token, signal);
};

/**
 * Upload a single chunk with retry logic.
 * Returns the (possibly refreshed) auth token.
 */
const uploadChunkWithRetry = async (
  baseUrl: string,
  sessionId: string,
  chunkIndex: number,
  data: ArrayBuffer,
  token: string,
  signal?: AbortSignal,
): Promise<string> => {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/api/upload/${sessionId}/${chunkIndex}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': `Bearer ${token}`,
        },
        body: data,
        signal,
      });
      if (res.ok) return token;
      // 409 = chunk already received (idempotent) — treat as success
      if (res.status === 409) return token;
      throw new Error(`Chunk upload failed: ${res.status}`);
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      if (attempt === MAX_RETRIES - 1) throw err;
      // Exponential backoff: 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, BASE_BACKOFF_MS * Math.pow(2, attempt)));
      // Refresh token in case it expired during retries
      try { token = await getValidToken(); } catch (e) { console.warn('[ChunkUpload] Token refresh failed during retry:', e); }
    }
  }
  return token;
};

/**
 * Poll the server for upload session completion.
 * The server assembles chunks and uploads to Gemini File API after
 * all chunks are received — this can take a few seconds.
 */
const pollSessionCompletion = async (
  baseUrl: string,
  sessionId: string,
  token: string,
  signal?: AbortSignal,
): Promise<ChunkUploadResult> => {
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');

    const res = await fetch(`${baseUrl}/api/upload/${sessionId}/status`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal,
    });
    if (!res.ok) throw new Error(`Status check failed: ${res.status}`);

    const status: UploadSessionStatus = await res.json();

    if (status.status === 'completed' && status.fileUri && status.geminiFileName) {
      return { fileUri: status.fileUri, geminiFileName: status.geminiFileName };
    }
    if (status.status === 'failed') {
      throw new Error('Server-side file assembly failed');
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error('Upload assembly timed out');
};
