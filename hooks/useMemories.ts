import { useState, useEffect, useCallback, useRef } from 'react';
import { getMemories, deleteMemory, saveMemory, getMemory } from '../services/storageService';
import { submitEnrichment, fetchPendingEnrichments } from '../services/geminiService';
import { Memory, Attachment } from '../types';
import { SAMPLE_MEMORIES } from '../services/sampleData';
import { useSync } from './useSync';
import { useAuth } from './useAuth';
import { storage } from '../services/platform';

// Module-level lock to prevent concurrent sample seeding
let seedingPromise: Promise<Memory[]> | null = null;

// Sample memory IDs for idempotency check
const SAMPLE_IDS = new Set(SAMPLE_MEMORIES.map(s => s.id));

/**
 * Seeds sample memories atomically with proper locking.
 * Returns the seeded memories or existing samples if already present.
 */
const seedSampleMemories = async (): Promise<Memory[]> => {
  // If seeding is already in progress, wait for it
  if (seedingPromise) {
    console.log("[Samples] Seeding already in progress, waiting...");
    return seedingPromise;
  }

  // Check if already initialized (double-check after acquiring "lock")
  const alreadyInitialized = await storage.get('samples_initialized');
  if (alreadyInitialized === 'true') {
    console.log("[Samples] Already initialized (flag set)");
    const loaded = await getMemories();
    return loaded.filter(m => SAMPLE_IDS.has(m.id) && !m.isDeleted);
  }

  // Start seeding with a promise lock
  seedingPromise = (async () => {
    try {
      // Set flag FIRST (optimistically) to prevent other calls from starting
      await storage.set('samples_initialized', 'true');
      console.log("[Samples] Seeding sample memories...");

      // Check if any samples already exist (idempotency)
      const existing = await getMemories();
      const existingSampleIds = new Set(existing.filter(m => SAMPLE_IDS.has(m.id)).map(m => m.id));

      // Only seed samples that don't exist yet
      const samplesToSeed = SAMPLE_MEMORIES.filter(s => !existingSampleIds.has(s.id));

      if (samplesToSeed.length === 0) {
        console.log("[Samples] All samples already exist, skipping seeding");
        return existing.filter(m => SAMPLE_IDS.has(m.id) && !m.isDeleted);
      }

      console.log(`[Samples] Seeding ${samplesToSeed.length} samples...`);

      // Save all samples
      for (const sample of samplesToSeed) {
        await saveMemory(sample);
      }

      console.log("[Samples] Sample seeding complete");
      return [...SAMPLE_MEMORIES];
    } catch (error) {
      // If seeding fails, clear the flag so it can be retried
      console.error("[Samples] Seeding failed, clearing flag:", error);
      await storage.remove('samples_initialized');
      throw error;
    } finally {
      // Clear the lock
      seedingPromise = null;
    }
  })();

  return seedingPromise;
};

export const useMemories = () => {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { sync, syncFile } = useSync();
  const { authStatus } = useAuth();
  const mounted = useRef(false);
  const recoveryAttemptedRef = useRef(false);
  const pollingActiveRef = useRef(false);
  const memoriesRef = useRef(memories);

  // Keep memoriesRef in sync for use inside polling closure
  useEffect(() => { memoriesRef.current = memories; }, [memories]);

  const refreshMemories = useCallback(async () => {
    try {
        const loaded = await getMemories();
        const activeMemories = loaded.filter(m => !m.isDeleted);

        // Check if we need to seed samples
        const samplesInitialized = await storage.get('samples_initialized');
        const hasSampleMemories = loaded.some(m => SAMPLE_IDS.has(m.id));

        if (!samplesInitialized && (loaded.length === 0 || !hasSampleMemories)) {
            const seededSamples = await seedSampleMemories();
            const nonSampleMemories = activeMemories.filter(m => !SAMPLE_IDS.has(m.id));
            setMemories([...seededSamples, ...nonSampleMemories]);
            return;
        }

        setMemories(activeMemories);
    } catch (error) {
        console.error("Failed to refresh memories:", error);
    } finally {
        setIsLoading(false);
    }
  }, []);

  // Initial load only
  useEffect(() => {
    if (!mounted.current) {
        refreshMemories();
        mounted.current = true;
    }
  }, [refreshMemories]);

  // Auto-recover pending enrichments on app load
  useEffect(() => {
    if (isLoading || recoveryAttemptedRef.current) return;
    recoveryAttemptedRef.current = true;

    const pendingMemories = memories.filter(m => m.isPending && !m.isSample);
    if (pendingMemories.length === 0) return;

    console.log(`[Recovery] Found ${pendingMemories.length} pending memories, attempting recovery...`);

    const recover = async () => {
      try {
        const ids = pendingMemories.map(m => m.id);
        const results = await fetchPendingEnrichments(ids);

        for (const memory of pendingMemories) {
          const result = results[memory.id];
          if (result?.status === 'completed') {
            // Result found in server — apply it
            const allTags = Array.from(new Set([...memory.tags, ...result.data.suggestedTags]));
            const updatedMemory: Memory = {
              ...memory,
              enrichment: result.data,
              tags: allTags,
              isPending: false,
              processingError: false,
              timestamp: Date.now(),
            };
            await saveMemory(updatedMemory);
            setMemories(prev => prev.map(m => m.id === memory.id ? updatedMemory : m));
            console.log(`[Recovery] Recovered enrichment for ${memory.id}`);
          } else if (result?.status === 'processing') {
            // Still processing — leave as pending, polling will pick it up
            console.log(`[Recovery] ${memory.id} still processing, will poll`);
          } else {
            // Not found or failed — mark for retry
            const failedMemory: Memory = { ...memory, isPending: false, processingError: true };
            await saveMemory(failedMemory);
            setMemories(prev => prev.map(m => m.id === memory.id ? failedMemory : m));
            console.log(`[Recovery] No result for ${memory.id}, marked for retry`);
          }
        }
      } catch (err) {
        console.error('[Recovery] Auto-recovery failed:', err);
      }
    };

    recover();
  }, [isLoading, memories]);

  // Helper for single file sync - Memoized
  const trySyncFile = useCallback(async (memory: Memory) => {
      if (authStatus === 'linked') {
          console.log(`[Auto-Sync] Triggering single file sync for ${memory.id}`);
          syncFile(memory).catch(err => console.error("Single file sync failed:", err));
      }
  }, [authStatus, syncFile]);

  // --- Enrichment polling ---
  // Polls the server for completed enrichment results when memories are pending.
  // Uses a single batched request for all pending memories.
  // Fibonacci backoff: 2s, 3s, 4s, 6s, 9s, 13s, 19s, 28s, ... up to 2 min total.
  const ENRICHMENT_TIMEOUT_MS = 120_000;

  const startEnrichmentPolling = useCallback(() => {
    if (pollingActiveRef.current) return;
    pollingActiveRef.current = true;

    let prevDelay = 1_000;
    let currDelay = 2_000;

    const poll = async () => {
      if (!pollingActiveRef.current) return;

      const pending = memoriesRef.current.filter(m => m.isPending && !m.isSample);
      if (pending.length === 0) {
        pollingActiveRef.current = false;
        return;
      }

      try {
        const ids = pending.map(m => m.id);
        const results = await fetchPendingEnrichments(ids);

        for (const memory of pending) {
          const result = results[memory.id];
          if (result?.status === 'completed') {
            const current = await getMemory(memory.id);
            if (!current || current.isDeleted) continue;

            const allTags = Array.from(new Set([...current.tags, ...result.data.suggestedTags]));
            const updatedMemory: Memory = {
              ...current,
              enrichment: result.data,
              tags: allTags,
              isPending: false,
              processingError: false,
              timestamp: Date.now(),
            };
            await saveMemory(updatedMemory);
            setMemories(prev => prev.map(m => m.id === memory.id ? updatedMemory : m));
            console.log(`[Poll] Enrichment complete for ${memory.id}`);

            if (authStatus === 'linked') {
              syncFile(updatedMemory).catch(err => console.error("Sync failed:", err));
            }
          } else if (result?.status === 'failed') {
            const current = await getMemory(memory.id);
            if (!current || current.isDeleted) continue;

            const failedMemory: Memory = { ...current, isPending: false, processingError: true };
            await saveMemory(failedMemory);
            setMemories(prev => prev.map(m => m.id === memory.id ? failedMemory : m));
            console.log(`[Poll] Enrichment failed for ${memory.id}`);
          } else if (Date.now() - memory.timestamp > ENRICHMENT_TIMEOUT_MS) {
            // Timed out waiting for result
            const current = await getMemory(memory.id);
            if (!current || current.isDeleted) continue;

            const failedMemory: Memory = { ...current, isPending: false, processingError: true };
            await saveMemory(failedMemory);
            setMemories(prev => prev.map(m => m.id === memory.id ? failedMemory : m));
            console.log(`[Poll] Enrichment timed out for ${memory.id}`);
          }
          // status === 'processing' or 'not_found' (not timed out) → keep polling
        }
      } catch (err) {
        console.error('[Poll] Failed to poll for enrichment results:', err);
      }

      // Re-check if there are still pending items before scheduling next poll
      const stillPending = memoriesRef.current.filter(m => m.isPending && !m.isSample);
      if (stillPending.length > 0 && pollingActiveRef.current) {
        const nextDelay = prevDelay + currDelay;
        prevDelay = currDelay;
        currDelay = nextDelay;
        setTimeout(poll, nextDelay);
      } else {
        pollingActiveRef.current = false;
      }
    };

    // First poll at 2s
    setTimeout(poll, 2_000);
  }, [authStatus, syncFile]);

  // Auto-start polling if there are pending memories (e.g., after recovery leaves some as "processing")
  useEffect(() => {
    const hasPending = memories.some(m => m.isPending && !m.isSample);
    if (hasPending && !pollingActiveRef.current) {
      startEnrichmentPolling();
    }
  }, [memories, startEnrichmentPolling]);

  const handleDelete = useCallback(async (id: string) => {
    setMemories(prev => prev.map(m => m.id === id ? { ...m, isDeleting: true } : m));

    try {
      const existing = await getMemory(id);
      if (existing && !existing.isDeleted) {
          const tombstone: Memory = {
              ...existing,
              isDeleted: true,
              timestamp: Date.now(),
              content: '',
              attachments: [],
              image: undefined
          };
          await saveMemory(tombstone);
          // Sync just this tombstone
          await trySyncFile(tombstone);
      } else if (!existing) {
          await deleteMemory(id);
      }

      setMemories(prev => prev.filter(m => m.id !== id));
    } catch (error) {
      console.error("Failed to delete memory:", error);
      alert("Could not delete memory. Please try again.");
      await refreshMemories();
    }
  }, [refreshMemories, trySyncFile]);

  const handleRetry = useCallback(async (id: string) => {
    // Clear error state but don't show "Enriching..." yet
    setMemories(prev => prev.map(m => m.id === id ? { ...m, processingError: false } : m));
    const memory = memories.find(m => m.id === id);
    if (!memory) return;

    try {
        const attachments: Attachment[] = memory.attachments ? [...memory.attachments] : [];
        if (attachments.length === 0 && memory.image) {
            attachments.push({
                id: 'legacy-img',
                type: 'image',
                mimeType: 'image/jpeg',
                data: memory.image,
                name: 'Captured Image'
            });
        }

        // Submit enrichment — only set isPending after the server confirms receipt
        await submitEnrichment(
            memory.content,
            attachments,
            memory.location,
            memory.tags,
            memory.id
        );

        // Server accepted (200) — now show "Enriching..." and poll for results
        const pendingMemory: Memory = {
            ...memory,
            isPending: true,
            processingError: false,
            attachments: attachments.filter(a => a.id !== 'legacy-img'),
        };
        await saveMemory(pendingMemory);
        setMemories(prev => prev.map(m => m.id === id ? pendingMemory : m));
        startEnrichmentPolling();
    } catch (error) {
        console.error("Retry failed for memory", id, error);
        const failedMemory = { ...memory, isPending: false, processingError: true };
        await saveMemory(failedMemory);
        setMemories(prev => prev.map(m => m.id === id ? failedMemory : m));
    }
  }, [memories, trySyncFile, startEnrichmentPolling]);

  const createMemory = useCallback(async (
    text: string,
    attachments: Attachment[],
    tags: string[],
    location?: { latitude: number; longitude: number; accuracy?: number }
  ) => {
      // 1. Prepare initial memory object — no isPending yet
      const memoryId = crypto.randomUUID();
      const timestamp = Date.now();

      const newMemory: Memory = {
        id: memoryId,
        timestamp,
        content: text,
        attachments,
        tags,
        location,
        isPending: false,
        processingError: false
      };

      // 2. Show the card immediately (without "Enriching..." state) and save locally
      setMemories(prev => [newMemory, ...prev]);
      saveMemory(newMemory).catch(err => console.error("Failed to save pending memory", err));

      // 3. Submit enrichment to server — show "Enriching..." only after 200 confirmed
      submitEnrichment(text, attachments, location, tags, memoryId)
        .then(async () => {
            // Server accepted (200) — now show "Enriching..." and start polling
            const current = await getMemory(memoryId);
            if (!current || current.isDeleted) return;

            const pendingMemory: Memory = {
                ...newMemory,
                isPending: true,
            };
            await saveMemory(pendingMemory);
            setMemories(prev => prev.map(m => m.id === memoryId ? pendingMemory : m));
            startEnrichmentPolling();
        })
        .catch(async (err) => {
            console.error("Enrichment submission failed:", err);
            const current = await getMemory(memoryId);
            if (!current || current.isDeleted) return;

            const failedMemory: Memory = {
                ...newMemory,
                isPending: false,
                processingError: true
            };
            await saveMemory(failedMemory);
            setMemories(prev => prev.map(m => m.id === memoryId ? failedMemory : m));
        });

      // Return immediately so the modal can close
      return Promise.resolve();
  }, [trySyncFile, startEnrichmentPolling]);

  const updateMemoryContent = useCallback(async (id: string, newContent: string) => {
      setMemories(prev => prev.map(m => m.id === id ? { ...m, content: newContent } : m));

      try {
          const current = await getMemory(id);
          if (current) {
            const updated = { ...current, content: newContent, timestamp: Date.now() };
            await saveMemory(updated);
            await trySyncFile(updated);
          }
      } catch (e) {
          console.error("Update failed", e);
      }
  }, [trySyncFile]);

  const togglePin = useCallback(async (id: string, isPinned: boolean) => {
    setMemories(prev => prev.map(m => m.id === id ? { ...m, isPinned } : m));
    try {
        const current = await getMemory(id);
        if (current) {
            const updated = { ...current, isPinned };
            await saveMemory(updated);
            await trySyncFile(updated);
        }
    } catch (e) {
        console.error("Failed to toggle pin", e);
        // Revert on error
        setMemories(prev => prev.map(m => m.id === id ? { ...m, isPinned: !isPinned } : m));
    }
  }, [trySyncFile]);

  const updateMemory = useCallback(async (
    id: string,
    text: string,
    attachments: Attachment[],
    tags: string[],
    location?: { latitude: number; longitude: number; accuracy?: number }
  ) => {
      const existing = await getMemory(id);
      if (!existing) {
          console.error("Memory not found for update:", id);
          return;
      }

      // Update content immediately — no isPending yet
      const updatedMemory: Memory = {
        ...existing,
        content: text,
        attachments,
        tags,
        location: location || existing.location,
        enrichment: undefined, // Clear old enrichment to force re-processing
        isPending: false,
        processingError: false,
        timestamp: Date.now()
      };

      // Update UI with new content (without "Enriching..." state)
      setMemories(prev => prev.map(m => m.id === id ? updatedMemory : m));

      // Save locally so if app closes, we at least have the text update
      await saveMemory(updatedMemory);

      // Sync immediately (save the text changes even before enrichment finishes)
      await trySyncFile(updatedMemory);

      // Submit enrichment — show "Enriching..." only after the server confirms receipt
      console.log(`[Update] Submitting enrichment for ${id}`);
      submitEnrichment(text, attachments, updatedMemory.location, tags, id)
        .then(async () => {
            // Server accepted (200) — now show "Enriching..." and start polling
            const current = await getMemory(id);
            if (!current || current.isDeleted) return;

            const pendingMemory: Memory = {
                ...updatedMemory,
                isPending: true,
            };
            await saveMemory(pendingMemory);
            setMemories(prev => prev.map(m => m.id === id ? pendingMemory : m));
            startEnrichmentPolling();
        })
        .catch(async (err) => {
            console.error("Update enrichment submission failed:", err);
            const current = await getMemory(id);
            if (!current || current.isDeleted) return;

            const failedMemory: Memory = {
                ...updatedMemory,
                isPending: false,
                processingError: true
            };
            await saveMemory(failedMemory);
            setMemories(prev => prev.map(m => m.id === id ? failedMemory : m));
        });

      return Promise.resolve();
  }, [trySyncFile, startEnrichmentPolling]);

  useEffect(() => {
    const handleOnline = async () => {
      console.log("App is back online.");
      // Trigger sync if linked
      if (authStatus === 'linked') sync();

      // Recover pending enrichments from server
      const pendingItems = memories.filter(m => m.isPending && !m.isSample);
      if (pendingItems.length > 0) {
          console.log(`[Online-Recovery] Recovering ${pendingItems.length} pending items...`);
          try {
              const ids = pendingItems.map(m => m.id);
              const results = await fetchPendingEnrichments(ids);
              for (const memory of pendingItems) {
                  const result = results[memory.id];
                  if (result?.status === 'completed') {
                      const allTags = Array.from(new Set([...memory.tags, ...result.data.suggestedTags]));
                      const updatedMemory: Memory = {
                          ...memory, enrichment: result.data, tags: allTags,
                          isPending: false, processingError: false, timestamp: Date.now(),
                      };
                      await saveMemory(updatedMemory);
                      setMemories(prev => prev.map(m => m.id === memory.id ? updatedMemory : m));
                  } else if (result?.status === 'processing') {
                      // Still processing — polling will pick it up
                      startEnrichmentPolling();
                  } else {
                      // Not found or failed — mark for retry
                      const failedMemory: Memory = { ...memory, isPending: false, processingError: true };
                      await saveMemory(failedMemory);
                      setMemories(prev => prev.map(m => m.id === memory.id ? failedMemory : m));
                  }
              }
          } catch (err) {
              console.error('[Online-Recovery] Failed:', err);
          }
      }

      // Auto-retry enrichment for failed memories
      const failures = memories.filter(m => m.processingError);
      if (failures.length > 0) {
          console.log(`[Auto-Retry] Retrying ${failures.length} items...`);
          failures.forEach(m => handleRetry(m.id));
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [sync, authStatus, memories, handleRetry, startEnrichmentPolling]);

  return {
    memories,
    refreshMemories,
    handleDelete,
    handleRetry,
    createMemory,
    updateMemory,
    updateMemoryContent,
    togglePin,
    isLoading
  };
};
