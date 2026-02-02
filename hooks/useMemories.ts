import { useState, useEffect, useCallback, useRef } from 'react';
import { getMemories, deleteMemory, saveMemory, getMemory } from '../services/storageService';
import { enrichInput } from '../services/geminiService';
import { Memory, Attachment } from '../types';
import { SAMPLE_MEMORIES } from '../services/sampleData';
import { useSync } from './useSync';
import { useAuth } from './useAuth';
import { storage } from '../services/platform';

export const useMemories = () => {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { sync, syncFile } = useSync();
  const { authStatus } = useAuth();
  const mounted = useRef(false);

  const refreshMemories = useCallback(async () => {
    try {
        const loaded = await getMemories();
        const activeMemories = loaded.filter(m => !m.isDeleted);

        const samplesInitialized = await storage.get('samples_initialized');
        if (!samplesInitialized && loaded.length === 0) {
            console.log("Seeding sample memories...");
            for (const sample of SAMPLE_MEMORIES) {
                await saveMemory(sample);
            }
            await storage.set('samples_initialized', 'true');
            setMemories([...SAMPLE_MEMORIES]);
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

  // Helper for single file sync - Memoized
  const trySyncFile = useCallback(async (memory: Memory) => {
      if (authStatus === 'linked') {
          console.log(`[Auto-Sync] Triggering single file sync for ${memory.id}`);
          syncFile(memory).catch(err => console.error("Single file sync failed:", err));
      }
  }, [authStatus, syncFile]);

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
    setMemories(prev => prev.map(m => m.id === id ? { ...m, isPending: true, processingError: false } : m));
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

        const enrichment = await enrichInput(
            memory.content,
            attachments,
            memory.location,
            memory.tags
        );

        const allTags = Array.from(new Set([...memory.tags, ...enrichment.suggestedTags]));
        const updatedMemory: Memory = {
            ...memory,
            enrichment,
            tags: allTags,
            isPending: false,
            processingError: false,
            location: memory.location, // Keep original location if enrichment doesn't override or just keep as is
            attachments: attachments.filter(a => a.id !== 'legacy-img'),
            timestamp: Date.now() 
        };
        
        await saveMemory(updatedMemory);
        setMemories(prev => prev.map(m => m.id === id ? updatedMemory : m));
        
        // Sync enriched file
        await trySyncFile(updatedMemory);
    } catch (error) {
        console.error("Retry failed for memory", id, error);
        const failedMemory = { ...memory, isPending: false, processingError: true };
        await saveMemory(failedMemory);
        setMemories(prev => prev.map(m => m.id === id ? failedMemory : m));
    }
  }, [memories, trySyncFile]);

  const createMemory = useCallback(async (
    text: string, 
    attachments: Attachment[], 
    tags: string[], 
    location?: { latitude: number; longitude: number; accuracy?: number }
  ) => {
      // 1. Prepare initial memory object
      const memoryId = crypto.randomUUID();
      const timestamp = Date.now();
      
      const apiKey = await storage.get('gemini_api_key');
      const hasKey = !!apiKey && apiKey.trim().length > 0;

      const newMemory: Memory = {
        id: memoryId,
        timestamp,
        content: text,
        attachments,
        tags,
        location,
        isPending: hasKey,
        processingError: !hasKey
      };

      // 2. Schedule background API call (if key exists)
      const enrichmentPromise = hasKey 
          ? enrichInput(text, attachments, location, tags)
          : Promise.resolve(null);

      // 3. Update UI immediately (showing loading state) and save local pending state
      setMemories(prev => [newMemory, ...prev]);
      saveMemory(newMemory).catch(err => console.error("Failed to save pending memory", err));

      // 4. Handle Enrichment Result (asynchronously)
      if (hasKey) {
          enrichmentPromise
            .then(async (enrichment) => {
                if (!enrichment) return; // Should not happen given hasKey check

                // Check if memory still exists (wasn't deleted while enriching)
                const current = await getMemory(memoryId);
                if (!current || current.isDeleted) {
                    console.log("Memory deleted during enrichment, aborting save.");
                    return;
                }

                const allTags = Array.from(new Set([...tags, ...enrichment.suggestedTags]));
                const updatedMemory: Memory = {
                    ...newMemory,
                    enrichment,
                    tags: allTags,
                    isPending: false,
                    timestamp: Date.now() 
                };
                
                // Save and update UI with enriched data
                await saveMemory(updatedMemory);
                setMemories(prev => prev.map(m => m.id === memoryId ? updatedMemory : m));
                console.log("Enrichment complete, syncing single file...");
                
                // Sync Enriched File
                await trySyncFile(updatedMemory);
            })
            .catch(async (err) => {
                console.error("Enrichment failed:", err);
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
      }
      
      // Return immediately so the modal can close
      return Promise.resolve();
  }, [trySyncFile]);

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

  useEffect(() => {
    const handleOnline = async () => {
      console.log("App is back online.");
      // Trigger sync if linked
      if (authStatus === 'linked') sync();

      // Auto-retry enrichment for failed memories if API key exists
      const apiKey = await storage.get('gemini_api_key');
      if (apiKey && apiKey.trim().length > 0) {
          const failures = memories.filter(m => m.processingError);
          if (failures.length > 0) {
              console.log(`[Auto-Retry] Retrying ${failures.length} items...`);
              failures.forEach(m => handleRetry(m.id));
          }
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [sync, authStatus, memories, handleRetry]); 

  return {
    memories,
    refreshMemories,
    handleDelete,
    handleRetry,
    createMemory,
    updateMemoryContent,
    togglePin,
    isLoading
  };
};
