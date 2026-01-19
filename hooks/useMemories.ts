
import { useState, useEffect, useCallback } from 'react';
import { getMemories, deleteMemory, saveMemory } from '../services/storageService';
import { enrichInput } from '../services/geminiService';
import { Memory, Attachment } from '../types';
import { SAMPLE_MEMORIES } from '../services/sampleData';

export const useMemories = () => {
  const [memories, setMemories] = useState<Memory[]>([]);

  const refreshMemories = useCallback(async () => {
    let loaded = await getMemories();

    // Seed sample data for new users
    const samplesInitialized = localStorage.getItem('samples_initialized');
    if (!samplesInitialized && loaded.length === 0) {
        console.log("Seeding sample memories...");
        for (const sample of SAMPLE_MEMORIES) {
            await saveMemory(sample);
        }
        localStorage.setItem('samples_initialized', 'true');
        // Reload to ensure consistent state (or just use samples)
        // We use samples directly to avoid another DB read immediately, but DB read is safer for consistency
        loaded = [...SAMPLE_MEMORIES];
    }

    setMemories(loaded);
  }, []);

  useEffect(() => {
    refreshMemories();
  }, [refreshMemories]);

  const handleDelete = async (id: string) => {
    setMemories(prev => prev.map(m => m.id === id ? { ...m, isDeleting: true } : m));
    try {
      await deleteMemory(id);
      setMemories(prev => prev.filter(m => m.id !== id));
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
            attachments: attachments.filter(a => a.id !== 'legacy-img')
        };
        
        await saveMemory(updatedMemory);
        setMemories(prev => prev.map(m => m.id === id ? updatedMemory : m));
    } catch (error) {
        console.error("Retry failed for memory", id, error);
        const failedMemory = { ...memory, isPending: false, processingError: true };
        await saveMemory(failedMemory);
        setMemories(prev => prev.map(m => m.id === id ? failedMemory : m));
    }
  };

  useEffect(() => {
    const handleOnline = () => {
      console.log("App is back online. Retrying failed memories...");
      memories.forEach(m => {
        if (m.processingError && !m.isPending) {
          handleRetry(m.id);
        }
      });
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [memories]); // Re-bind when memories change so we have the latest list

  return {
    memories,
    refreshMemories,
    handleDelete,
    handleRetry
  };
};
