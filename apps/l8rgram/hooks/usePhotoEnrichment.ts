import { useCallback, useEffect, useRef, useState } from 'react';
import {
  postProxy,
  uploadFileChunked,
  LARGE_PAYLOAD_THRESHOLD,
} from '@l8r/shared/ai';
import { getPhotoById, putPhotos } from '../services/storageService';
import type { EnrichmentStatus, Photo } from '../types';

// Background auto-enrichment of imported photos: for each photo still marked
// `pending`, fetch its bytes, send them to /api/enrich-photo (inline when small,
// or pre-uploaded via the shared chunked-upload service when large), poll the
// durable result, then write the caption + tags back to the encrypted store and
// expose them via `enrichedById` for an immediate UI merge.
//
// Throttled to stay within the server's 30/min per-user limit and capped at a
// few concurrent jobs so a 10k-photo library trickles through rather than
// stampeding the proxy.

const MAX_CONCURRENT = 4;
const MAX_PER_MINUTE = 30;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 120_000;

export interface EnrichmentPatch {
  caption?: string;
  tags: string[];
  enrichmentStatus: EnrichmentStatus;
}

interface PhotoEnrichResult {
  status: 'completed' | 'processing' | 'failed' | 'not_found' | string;
  data?: { caption: string; tags: string[] };
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      // readAsDataURL yields `data:<mime>;base64,<payload>` — keep the payload.
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read photo bytes'));
    reader.readAsDataURL(blob);
  });

/** Fetch a photo's displayable bytes (full-res URI, falling back to thumbnail). */
const resolvePhotoBlob = async (photo: Photo): Promise<Blob | null> => {
  const src = photo.uri || photo.thumbnailUri;
  if (!src) return null;
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Failed to load photo bytes (${res.status})`);
  return res.blob();
};

interface EnrichPhotoImage {
  mimeType: string;
  data?: string;
  fileUri?: string;
  geminiFileName?: string;
}

export const usePhotoEnrichment = (photos: Photo[]) => {
  const [enrichedById, setEnrichedById] = useState<Map<string, EnrichmentPatch>>(new Map());
  const [enrichingCount, setEnrichingCount] = useState(0);

  // Ids we've already picked up (in-flight or terminal) so re-renders of the
  // `photos` array never re-enqueue the same photo.
  const claimedRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<Photo[]>([]);
  const activeRef = useRef(0);
  const submitTimesRef = useRef<number[]>([]); // sliding 60s window of submissions
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const recordPatch = useCallback((id: string, patch: EnrichmentPatch) => {
    if (!mountedRef.current) return;
    setEnrichedById((prev) => {
      const next = new Map(prev);
      next.set(id, patch);
      return next;
    });
  }, []);

  // Persist the enrichment onto the stored photo (read-modify-write the single
  // record so we don't clobber albumIds written by the matcher).
  const persistPatch = useCallback(async (id: string, patch: EnrichmentPatch) => {
    try {
      const stored = await getPhotoById(id);
      if (!stored) return;
      await putPhotos([{
        ...stored,
        caption: patch.caption ?? stored.caption,
        tags: patch.tags,
        enrichmentStatus: patch.enrichmentStatus,
      }]);
    } catch (e) {
      console.error('[l8rgram] Failed to persist photo enrichment', e);
    }
  }, []);

  const pollResult = useCallback(async (jobId: string): Promise<PhotoEnrichResult> => {
    const start = Date.now();
    // First poll immediately; the result may already be cached server-side.
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      const res = await postProxy<{ results: Record<string, PhotoEnrichResult> }>(
        '/api/enrich-photo/results',
        { jobIds: [jobId] },
      );
      const entry = res.results[jobId];
      if (entry && entry.status !== 'processing' && entry.status !== 'not_found') return entry;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    return { status: 'failed' };
  }, []);

  const enrichOne = useCallback(async (photo: Photo) => {
    try {
      const blob = await resolvePhotoBlob(photo);
      if (!blob) {
        const patch: EnrichmentPatch = { tags: [], enrichmentStatus: 'skipped' };
        recordPatch(photo.id, patch);
        await persistPatch(photo.id, patch);
        return;
      }

      const mimeType = EXT_BY_MIME[blob.type] ? blob.type : photo.mimeType;
      const base64 = await blobToBase64(blob);

      let image: EnrichPhotoImage;
      if (base64.length > LARGE_PAYLOAD_THRESHOLD) {
        const ext = EXT_BY_MIME[mimeType] ?? 'jpg';
        const { fileUri, geminiFileName } = await uploadFileChunked(
          blob, mimeType, `${photo.id}.${ext}`, photo.id,
        );
        image = { mimeType, fileUri, geminiFileName };
      } else {
        image = { mimeType, data: base64 };
      }

      await postProxy('/api/enrich-photo', { jobId: photo.id, image });
      const result = await pollResult(photo.id);

      if (result.status === 'completed' && result.data) {
        const patch: EnrichmentPatch = {
          caption: result.data.caption,
          tags: result.data.tags ?? [],
          enrichmentStatus: 'enriched',
        };
        recordPatch(photo.id, patch);
        await persistPatch(photo.id, patch);
      } else {
        const patch: EnrichmentPatch = { tags: [], enrichmentStatus: 'failed' };
        recordPatch(photo.id, patch);
        await persistPatch(photo.id, patch);
      }
    } catch (e) {
      console.error('[l8rgram] Photo enrichment failed', photo.id, e);
      const patch: EnrichmentPatch = { tags: [], enrichmentStatus: 'failed' };
      recordPatch(photo.id, patch);
      await persistPatch(photo.id, patch);
    }
  }, [recordPatch, persistPatch, pollResult]);

  // Drain the queue under the concurrency + rate caps.
  const pump = useCallback(() => {
    while (activeRef.current < MAX_CONCURRENT && queueRef.current.length > 0) {
      // Rate gate: keep submissions under MAX_PER_MINUTE in any 60s window.
      const now = Date.now();
      submitTimesRef.current = submitTimesRef.current.filter((t) => now - t < 60_000);
      if (submitTimesRef.current.length >= MAX_PER_MINUTE) {
        const wait = 60_000 - (now - submitTimesRef.current[0]);
        setTimeout(() => pump(), Math.max(wait, 0));
        return;
      }

      const photo = queueRef.current.shift()!;
      submitTimesRef.current.push(now);
      activeRef.current += 1;
      if (mountedRef.current) setEnrichingCount(activeRef.current);

      void enrichOne(photo).finally(() => {
        activeRef.current -= 1;
        if (mountedRef.current) setEnrichingCount(activeRef.current);
        pump();
      });
    }
  }, [enrichOne]);

  // Enqueue freshly-pending photos whenever the set changes.
  useEffect(() => {
    let added = false;
    for (const photo of photos) {
      if (photo.enrichmentStatus !== 'pending') continue;
      if (claimedRef.current.has(photo.id)) continue;
      claimedRef.current.add(photo.id);
      queueRef.current.push(photo);
      added = true;
    }
    if (added) pump();
  }, [photos, pump]);

  return { enrichedById, enrichingCount };
};
