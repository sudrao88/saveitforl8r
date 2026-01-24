
import { useState, useEffect, useCallback } from 'react';
import { getMemories, deleteMemory, saveMemory, getMemory } from '../services/storageService';
import { enrichInput } from '../services/geminiService';
import { Memory, Attachment } from '../types';
import { SAMPLE_MEMORIES } from '../services/sampleData';
import { useSync } from './useSync';

export const useMemories = () => {
  const [memories, setMemories] = useState<Memory[]>([]);
  const { sync, syncFile, isLinked } = useSync();

  const refreshMemories = useCallback(async () => {
    const loaded = await getMemories();
    const activeMemories = loaded.filter(m => !m.isDeleted);

    const samplesInitialized = localStorage.getItem('samples_initialized');
    if (!samplesInitialized && loaded.length === 0) {
        console.log("Seeding sample memories...");
        for (const sample of SAMPLE_MEMORIES) {
            await saveMemory(sample);
        }
        localStorage.setItem('samples_initialized', 'true');
        setMemories([...SAMPLE_MEMORIES]);
        return;
    }

    setMemories(activeMemories);
  }, []);

  useEffect(() => {
    refreshMemories();
  }, [refreshMemories]);

  // Helper for single file sync - Memoized
  const trySyncFile = useCallback(async (memory: Memory) => {
      if (isLinked()) {
          console.log(`[Auto-Sync] Triggering single file sync for ${memory.id}`);
          syncFile(memory).catch(err => console.error("Single file sync failed:", err));
      }
  }, [isLinked, syncFile]);

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
        let finalLocation = memory.location; 
        if (enrichment.locationIsRelevant && memory.location) {
             finalLocation = memory.location;
        }
        
        const updatedMemory: Memory = {
            ...memory,
            enrichment,
            tags: allTags,
            isPending: false,
            processingError: false,
            location: finalLocation,
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
      const memoryId = crypto.randomUUID();
      const timestamp = Date.now();
      
      const newMemory: Memory = {
        id: memoryId,
        timestamp,
        content: text,
        attachments,
        tags,
        location,
        isPending: true
      };

      await saveMemory(newMemory);
      setMemories(prev => [newMemory, ...prev]);
      
      // Do NOT sync pending memory (as per requirement)

      enrichInput(text, attachments, location, tags)
        .then(async (enrichment) => {
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
  }, [trySyncFile]);

  useEffect(() => {
    const handleOnline = () => {
      console.log("App is back online.");
      // Just full sync on online status change is safer
      if (isLinked()) sync();
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [sync, isLinked]); 

  return {
    memories,
    refreshMemories,
    handleDelete,
    handleRetry,
    createMemory 
  };
};
