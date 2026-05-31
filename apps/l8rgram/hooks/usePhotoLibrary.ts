import { useCallback, useEffect, useState } from 'react';
import {
  ensurePermission,
  enumerateAll,
  type PermissionResult,
} from '../services/photoLibrary';
import {
  getPhotos,
  putPhotos,
  setLastImportedAt,
} from '../services/storageService';
import type { Photo } from '../types';

export type ImportStatus = 'idle' | 'requesting' | 'importing' | 'ready' | 'error';

export interface ImportProgress {
  imported: number;
  total: number | null;
}

const byCapturedAtDesc = (a: Photo, b: Photo) => b.capturedAt - a.capturedAt;

/**
 * Drives the photo-library import pipeline: permission → paginated enumeration
 * → dedupe by `assetId` → encrypted persist → progressive UI update. Re-import
 * is incremental and idempotent (the dedupe set is built from the current store,
 * so the same library cannot produce duplicates across runs — albums in M4
 * depend on this invariant).
 */
export const usePhotoLibrary = () => {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [permission, setPermission] = useState<PermissionResult | null>(null);
  const [progress, setProgress] = useState<ImportProgress>({ imported: 0, total: null });
  const [error, setError] = useState<string | null>(null);

  // Surface whatever's already in the encrypted store so the grid renders
  // instantly on launch, before any new import has a chance to run.
  useEffect(() => {
    let cancelled = false;
    getPhotos()
      .then((existing) => {
        if (cancelled) return;
        setPhotos(existing.sort(byCapturedAtDesc));
        if (existing.length > 0) setStatus('ready');
      })
      .catch((e) => {
        if (cancelled) return;
        console.error('[l8rgram] Failed to load persisted photos', e);
      });
    return () => { cancelled = true; };
  }, []);

  const importLibrary = useCallback(async () => {
    try {
      setStatus('requesting');
      setError(null);
      const perm = await ensurePermission();
      setPermission(perm);
      if (perm.state === 'denied') {
        setStatus('error');
        setError('Photo library access was denied. Update your settings to import photos.');
        return;
      }

      setStatus('importing');

      // Build the seen-set from the current store so re-import is incremental
      // and idempotent across runs (the cursor alone can't dedupe rearranged
      // libraries — assetId is the authoritative key).
      const existing = await getPhotos();
      const seen = new Set(existing.map((p) => p.assetId));
      const collected: Photo[] = [...existing];
      let imported = 0;

      for await (const page of enumerateAll()) {
        const fresh = page.photos.filter((p) => !seen.has(p.assetId));
        if (fresh.length === 0) continue;
        await putPhotos(fresh);
        fresh.forEach((p) => seen.add(p.assetId));
        collected.push(...fresh);
        imported += fresh.length;
        setProgress({ imported, total: null });
        setPhotos([...collected].sort(byCapturedAtDesc));
      }

      await setLastImportedAt(Date.now());
      setStatus('ready');
    } catch (e) {
      console.error('[l8rgram] Import failed', e);
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Import failed.');
    }
  }, []);

  return { photos, status, permission, progress, error, importLibrary };
};
