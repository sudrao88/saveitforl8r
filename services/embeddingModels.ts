import { EmbeddingModelId } from '../types';

/**
 * Embedding model registry shared by the worker, the adaptive-search hook,
 * and the native model manager. Web runs the small ONNX model inside the
 * worker; native devices run EmbeddingGemma through the TextEmbedder
 * Capacitor plugin once the model has been downloaded.
 */
export interface EmbeddingModelInfo {
  modelId: EmbeddingModelId;
  dim: number;
}

export const WEB_EMBEDDING_MODEL: EmbeddingModelInfo = {
  modelId: 'bge-small-en-v1.5',
  dim: 384,
};

export const NATIVE_EMBEDDING_MODEL: EmbeddingModelInfo = {
  modelId: 'embeddinggemma-300m',
  dim: 768,
};
