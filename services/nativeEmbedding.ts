/**
 * Native Embedding Bridge
 *
 * On native platforms (iOS / Android) this module delegates embedding
 * computation to the OS-provided ML runtime (Core ML / TensorFlow Lite)
 * via the existing IOSBridge / AndroidBridge message channels.
 *
 * On web it is a no-op — the embedding worker falls back to
 * @xenova/transformers (ONNX in WASM).
 *
 * The native runtimes use bge-base-en-v1.5 (768-dim) for higher quality
 * search, while the web fallback keeps bge-small-en-v1.5 (384-dim) for
 * browser memory constraints.
 */

import { Capacitor } from '@capacitor/core';

// ── Types ──────────────────────────────────────────────────────────────

export interface NativeEmbeddingResult {
  embedding: number[];
  dimensions: number;
}

export interface NativeModelStatus {
  status: 'not_available' | 'not_downloaded' | 'downloading' | 'ready' | 'error';
  progress?: number; // 0-100 download progress
  error?: string;
  modelName?: string;
  dimensions?: number;
}

// ── Platform detection ─────────────────────────────────────────────────

export const isNativeEmbeddingAvailable = (): boolean => {
  return Capacitor.isNativePlatform();
};

export const getNativePlatform = (): 'ios' | 'android' | 'web' => {
  const platform = Capacitor.getPlatform();
  if (platform === 'ios') return 'ios';
  if (platform === 'android') return 'android';
  return 'web';
};

/** Dimensions produced by the native model (bge-base-en-v1.5). */
export const NATIVE_EMBEDDING_DIMENSIONS = 768;

/** Dimensions produced by the web model (bge-small-en-v1.5). */
export const WEB_EMBEDDING_DIMENSIONS = 384;

/** Returns the embedding dimension for the current platform. */
export const getEmbeddingDimensions = (): number => {
  return isNativeEmbeddingAvailable()
    ? NATIVE_EMBEDDING_DIMENSIONS
    : WEB_EMBEDDING_DIMENSIONS;
};

// ── Callback registry ──────────────────────────────────────────────────
// Native code calls back into JS via window.dispatchEvent with
// CustomEvent payloads. We use a simple promise-based resolver map
// keyed by a monotonically increasing request ID.

let nextRequestId = 1;
const pendingRequests = new Map<
  number,
  { resolve: (value: any) => void; reject: (reason: any) => void }
>();

// Timeout for native calls (model loading can take a while on first run)
const NATIVE_CALL_TIMEOUT_MS = 60_000;

/** Listen for native → JS callback events. */
if (typeof window !== 'undefined') {
  window.addEventListener('nativeEmbeddingResult', ((event: CustomEvent) => {
    const { requestId, result, error } = event.detail;
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    pendingRequests.delete(requestId);
    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(result);
    }
  }) as EventListener);
}

// ── Bridge calls ───────────────────────────────────────────────────────

/**
 * Posts a message to the native bridge and returns a promise that
 * resolves when the native side dispatches the result event.
 */
const callNative = <T>(action: string, payload: Record<string, unknown> = {}): Promise<T> => {
  const requestId = nextRequestId++;
  const platform = getNativePlatform();

  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });

    // Auto-timeout
    const timer = setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error(`Native embedding call "${action}" timed out after ${NATIVE_CALL_TIMEOUT_MS}ms`));
      }
    }, NATIVE_CALL_TIMEOUT_MS);

    // Wrap resolve/reject to clear timer
    const originalResolve = resolve;
    const originalReject = reject;
    pendingRequests.set(requestId, {
      resolve: (value: T) => { clearTimeout(timer); originalResolve(value); },
      reject: (reason: any) => { clearTimeout(timer); originalReject(reason); },
    });

    try {
      if (platform === 'ios') {
        // iOS: single postMessage dispatcher via WKScriptMessageHandler
        const message = { action, requestId, ...payload };
        (window as any).webkit?.messageHandlers?.IOSBridge?.postMessage(message);
      } else if (platform === 'android') {
        // Android: direct @JavascriptInterface method calls
        const bridge = (window as any).AndroidBridge;
        if (!bridge) throw new Error('AndroidBridge not available');

        switch (action) {
          case 'embeddingModelStatus':
            bridge.embeddingModelStatus(requestId);
            break;
          case 'embeddingDownloadModel':
            bridge.embeddingDownloadModel(requestId);
            break;
          case 'embeddingGenerate':
            bridge.embeddingGenerate(requestId, payload.text as string);
            break;
          case 'embeddingGenerateBatch':
            bridge.embeddingGenerateBatch(requestId, JSON.stringify(payload.texts));
            break;
          default:
            throw new Error(`Unknown embedding action: ${action}`);
        }
      } else {
        pendingRequests.delete(requestId);
        clearTimeout(timer);
        reject(new Error('Native embedding not available on web'));
      }
    } catch (e) {
      pendingRequests.delete(requestId);
      clearTimeout(timer);
      reject(e);
    }
  });
};

// ── Public API ─────────────────────────────────────────────────────────

/** Check the native model status (downloaded, ready, etc.). */
export const getNativeModelStatus = async (): Promise<NativeModelStatus> => {
  if (!isNativeEmbeddingAvailable()) {
    return { status: 'not_available' };
  }
  return callNative<NativeModelStatus>('embeddingModelStatus');
};

/** Trigger model download on the native side. */
export const downloadNativeModel = async (): Promise<NativeModelStatus> => {
  return callNative<NativeModelStatus>('embeddingDownloadModel');
};

/** Generate an embedding for the given text. */
export const generateNativeEmbedding = async (text: string): Promise<NativeEmbeddingResult> => {
  return callNative<NativeEmbeddingResult>('embeddingGenerate', { text });
};

/** Generate embeddings for multiple texts in a single batch call. */
export const generateNativeEmbeddingBatch = async (texts: string[]): Promise<NativeEmbeddingResult[]> => {
  return callNative<NativeEmbeddingResult[]>('embeddingGenerateBatch', { texts });
};
