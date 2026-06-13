import { useEffect } from 'react';
import { Memory, isMemoryInFlight, isMemoryFailed, EMBEDDING_MODEL_ID } from '../types';
import { embedTexts, buildEmbeddingText } from '../services/geminiService';
import { getMemory, saveMemory } from '../services/storageService';

const BATCH_SIZE = 50;
// Cap notes processed per run so a large backfill yields between runs (each run
// ends with a refresh that re-triggers this effect to pick up the next slice).
const MAX_PER_RUN = 200;

interface BackfillOptions {
  memories: Memory[];
  enabled: boolean;                 // online + authed + initial load complete
  syncMemory: (m: Memory) => Promise<void>;
  onRefresh: () => void;            // reload memories from storage after a run
}

const needsEmbedding = (m: Memory): boolean =>
  !m.isDeleted &&
  !isMemoryInFlight(m) &&
  !isMemoryFailed(m) &&
  !!m.enrichment &&
  // Missing a vector, or one produced by a superseded embedding model.
  // Re-embedding stale-model notes keeps every synced vector in the SAME
  // space — mixing models (same 768 dims) would silently yield bogus
  // similarities and irrelevant "related" notes.
  !(
    Array.isArray(m.enrichment.embedding) &&
    m.enrichment.embedding.length > 0 &&
    m.enrichment.embeddingModel === EMBEDDING_MODEL_ID
  );

/**
 * Backfills similarity embeddings for notes enriched before the feature
 * existed. Newly enriched notes already carry their vector from /api/enrich;
 * this fills the gap by calling /api/embed in batches, persisting the vector
 * onto the (full, attachment-complete) memory, and syncing it. Bounded and
 * best-effort — stops on error and resumes on the next trigger.
 */
export const useRelatedEmbeddingBackfill = ({ memories, enabled, syncMemory, onRefresh }: BackfillOptions) => {
  useEffect(() => {
    if (!enabled) return;

    const candidateIds = memories.filter(needsEmbedding).map(m => m.id);
    if (candidateIds.length === 0) return;

    // Per-run cancellation only. React guarantees the previous effect's cleanup
    // runs before the next effect, so there's no true concurrency; a guarding
    // ref would survive React 18 StrictMode's synchronous remount and
    // permanently stall the backfill.
    let cancelled = false;

    const run = async () => {
      let processed = 0;
      let didWork = false;
      try {
        for (let i = 0; i < candidateIds.length && processed < MAX_PER_RUN; i += BATCH_SIZE) {
          if (cancelled) break;
          const batchIds = candidateIds.slice(i, i + BATCH_SIZE);

          // Load FULL memories (state copies may have deferred/stripped
          // attachments — saving those would wipe attachment data).
          const fulls: Memory[] = [];
          const texts: string[] = [];
          for (const id of batchIds) {
            const full = await getMemory(id);
            if (!full || !needsEmbedding(full)) continue;
            const text = buildEmbeddingText(full);
            if (!text) continue;
            fulls.push(full);
            texts.push(text);
          }
          if (texts.length === 0) continue;

          const vectors = await embedTexts(texts);
          if (vectors.length !== fulls.length) {
            console.warn('[Backfill] embedding count mismatch; skipping batch');
            continue;
          }

          for (let j = 0; j < fulls.length; j++) {
            if (cancelled) break;
            const m = fulls[j];
            m.enrichment = { ...m.enrichment!, embedding: vectors[j], embeddingModel: EMBEDDING_MODEL_ID };
            await saveMemory(m);
            await syncMemory(m).catch(e => console.warn(`[Backfill] sync failed for ${m.id}:`, e));
            processed++;
            didWork = true;
          }
        }
      } catch (e) {
        console.warn('[Backfill] embedding backfill failed (will retry):', e);
      } finally {
        if (didWork && !cancelled) onRefresh();
      }
    };

    run();
    return () => { cancelled = true; };
  }, [memories, enabled, syncMemory, onRefresh]);
};
