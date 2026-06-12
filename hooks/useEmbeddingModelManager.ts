import { useState, useEffect, useCallback, useRef } from 'react';
import TextEmbedder, { DownloadProgressEvent } from '../services/textEmbedderPlugin';
import { isNative } from '../services/platform';
import { forceReindexAll } from '../services/storageService';

export type EmbeddingModelManagerStatus =
  | 'unavailable'     // Web, or plugin missing — section hidden
  | 'checking'
  | 'not_downloaded'
  | 'downloading'
  | 'ready';

export interface EmbeddingModelManagerState {
  status: EmbeddingModelManagerStatus;
  progress: DownloadProgressEvent | null;
  sizeBytes?: number;
  error: string | null;
}

/**
 * Manages the native EmbeddingGemma model lifecycle (Settings UI): download
 * with progress, delete, and the full re-index that a model switch requires.
 * `onModelChanged` should recreate the embedding worker so it re-detects the
 * platform model (useAdaptiveSearch.reinitializeWorker).
 */
export const useEmbeddingModelManager = (onModelChanged?: () => void) => {
  const [state, setState] = useState<EmbeddingModelManagerState>({
    status: isNative() ? 'checking' : 'unavailable',
    progress: null,
    error: null,
  });
  const listenerRef = useRef<{ remove: () => Promise<void> } | null>(null);

  const checkAvailability = useCallback(async () => {
    if (!isNative()) return;
    try {
      const { available, sizeBytes } = await TextEmbedder.isModelAvailable();
      setState(s => ({ ...s, status: available ? 'ready' : 'not_downloaded', sizeBytes }));
    } catch (e) {
      // Plugin not present in this native build — hide the section
      console.warn('[EmbeddingModel] Plugin unavailable:', e);
      setState(s => ({ ...s, status: 'unavailable' }));
    }
  }, []);

  useEffect(() => {
    checkAvailability();
    return () => {
      listenerRef.current?.remove().catch(() => {});
      listenerRef.current = null;
    };
  }, [checkAvailability]);

  const download = useCallback(async () => {
    setState(s => ({ ...s, status: 'downloading', progress: null, error: null }));
    try {
      listenerRef.current = await TextEmbedder.addListener('downloadProgress', (event) => {
        setState(s => (s.status === 'downloading' ? { ...s, progress: event } : s));
      });
      await TextEmbedder.downloadModel();
      // Model switch invalidates every existing vector — re-embed everything
      // with EmbeddingGemma and let the worker restart under the new config.
      await forceReindexAll();
      onModelChanged?.();
      setState(s => ({ ...s, status: 'ready', progress: null }));
    } catch (e: any) {
      setState(s => ({ ...s, status: 'not_downloaded', progress: null, error: e?.message || 'Download failed' }));
    } finally {
      await listenerRef.current?.remove().catch(() => {});
      listenerRef.current = null;
    }
  }, [onModelChanged]);

  const cancel = useCallback(async () => {
    try {
      await TextEmbedder.cancelDownload();
    } catch (e) {
      console.warn('[EmbeddingModel] Cancel failed:', e);
    }
    setState(s => ({ ...s, status: 'not_downloaded', progress: null }));
  }, []);

  const remove = useCallback(async () => {
    try {
      await TextEmbedder.deleteModel();
      // Back to the web model: re-embed at its dimensionality
      await forceReindexAll();
      onModelChanged?.();
      setState(s => ({ ...s, status: 'not_downloaded', progress: null, error: null }));
    } catch (e: any) {
      setState(s => ({ ...s, error: e?.message || 'Failed to delete model' }));
    }
  }, [onModelChanged]);

  return { ...state, download, cancel, remove, refresh: checkAvailability };
};
