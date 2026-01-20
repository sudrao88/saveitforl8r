
import { useState, useEffect, useCallback } from 'react';
import { getMemories, deleteMemory, saveMemory, getMemory } from '../services/storageService';
import { enrichInput } from '../services/geminiService';
import { Memory, Attachment } from '../types';
import { SAMPLE_MEMORIES } from '../services/sampleData';
import { useSync } from './useSync';

export const useMemories = () => {
  const [memories, setMemories] = useState<Memory[]>([]);
  const { sync, isLinked } = useSync();

  const refreshMemories = useCallback(async () => {
    console.log('[useMemories] Refreshing memories from DB...');
    const loaded = await getMemories();

    // Filter out soft-deleted items
    const activeMemories = loaded.filter(m => !m.isDeleted);
    console.log(`[useMemories] Loaded ${activeMemories.length} active memories.`);

    // Seed sample data for new users
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

  // Helper to trigger sync if linked
  const trySync = async (reason: string) => {
      if (isLinked()) {
          console.log(`[Auto-Sync] Triggering sync due to: ${reason}`);
          // We don't await this so UI stays responsive
          sync().catch(err => console.error("Auto-sync failed:", err));
      }
  };

  const handleDelete = async (id: string) => {
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
      } else if (!existing) {
          await deleteMemory(id);
      }

      setMemories(prev => prev.filter(m => m.id !== id));
      trySync('Delete Memory');
    } catch (error) {
      console.error("Failed to delete memory:", error);
      alert("Could not delete memory. Please try again.");
      await refreshMemories();
    }
  };

  const handleRetry = async (id: string) => {
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
        trySync('Retry Success');
    } catch (error) {
        console.error("Retry failed for memory", id, error);
        const failedMemory = { ...memory, isPending: false, processingError: true };
        await saveMemory(failedMemory);
        setMemories(prev => prev.map(m => m.id === id ? failedMemory : m));
    }
  };

  const createMemory = async (
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
      
      // Removed initial sync

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
            console.log("Enrichment complete, syncing...");
            trySync('Enrichment Complete');
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
  };

  useEffect(() => {
    const handleOnline = () => {
      console.log("App is back online. Retrying failed memories...");
      memories.forEach(m => {
        if (m.processingError && !m.isPending) {
          handleRetry(m.id);
        }
      });
      trySync('Online Status Change');
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [memories]); 

  return {
    memories,
    refreshMemories,
    handleDelete,
    handleRetry,
    createMemory 
  };
};
