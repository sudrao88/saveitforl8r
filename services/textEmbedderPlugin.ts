import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { isNative } from './platform';

/**
 * Native on-device text embedding (EmbeddingGemma via Google AI Edge /
 * MediaPipe). Implemented by TextEmbedderPlugin.java / TextEmbedderPlugin.swift.
 * On web every method reports the model as unavailable — the embedding worker
 * uses its own in-worker ONNX model there.
 */
export interface ModelAvailability {
  available: boolean;
  modelId?: string;
  sizeBytes?: number;
}

export interface DownloadProgressEvent {
  bytesDownloaded: number;
  totalBytes: number;
}

export interface EmbedResult {
  vectors: number[][];
  modelId: string;
  dim: number;
}

export interface TextEmbedderPlugin {
  isModelAvailable(): Promise<ModelAvailability>;
  downloadModel(): Promise<{ modelId: string }>;
  cancelDownload(): Promise<void>;
  deleteModel(): Promise<void>;
  embed(options: { texts: string[] }): Promise<EmbedResult>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (event: DownloadProgressEvent) => void,
  ): Promise<PluginListenerHandle>;
}

const TextEmbedder = registerPlugin<TextEmbedderPlugin>('TextEmbedder', {
  web: () => ({
    isModelAvailable: async () => ({ available: false }),
    downloadModel: async () => { throw new Error('Native embedding model is not available on web'); },
    cancelDownload: async () => {},
    deleteModel: async () => {},
    embed: async () => { throw new Error('Native embedding model is not available on web'); },
    addListener: async () => ({ remove: async () => {} }),
  }) as unknown as TextEmbedderPlugin,
});

/** Whether the native EmbeddingGemma model is downloaded and ready to use. */
export const isNativeEmbedderReady = async (): Promise<boolean> => {
  if (!isNative()) return false;
  try {
    const { available } = await TextEmbedder.isModelAvailable();
    return available;
  } catch (e) {
    console.warn('[TextEmbedder] availability check failed:', e);
    return false;
  }
};

export default TextEmbedder;
