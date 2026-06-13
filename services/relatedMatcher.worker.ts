import { RelatedMatcher, MemoryVector } from './relatedMemories';

/**
 * Off-main-thread Related Memories matcher. Receives vector deltas from the
 * main thread (derived from synced memory embeddings) and posts back the full
 * per-memory related map. No ML model — pure cosine math.
 */

declare const self: DedicatedWorkerGlobalScope;

const matcher = new RelatedMatcher();

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data || {};

  if (type === 'UPDATE_VECTORS') {
    const added: MemoryVector[] = payload?.added || [];
    const removed: string[] = payload?.removed || [];
    matcher.update(added, removed);
    self.postMessage({ type: 'RELATED_MAP', payload: { map: matcher.getMap() } });
  } else if (type === 'RESET') {
    matcher.reset();
    self.postMessage({ type: 'RELATED_MAP', payload: { map: {} } });
  }
};
