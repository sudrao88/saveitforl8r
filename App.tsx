
import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Search, Filter, X, Tag, Tv, BookOpen, ShoppingBag, Music, Layers, LogOut } from 'lucide-react';
import InputBuffer from './components/InputBuffer.tsx';
import MemoryCard from './components/MemoryCard.tsx';
import ChatInterface from './components/ChatInterface.tsx';
import { getMemories, deleteMemory, saveMemory } from './services/storageService.ts';
import { enrichInput } from './services/geminiService.ts';
import { Memory, ViewMode, Attachment } from './types.ts';

// Inline Logo Component with wrapper to guarantee specific sizing
const Logo = ({ className }: { className?: string }) => (
  <div className={`${className} shrink-0`}>
    <svg viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <rect width="512" height="512" rx="128" fill="#2563eb"/>
      <path d="M356.5 125.5C373.069 108.931 399.931 108.931 416.5 125.5C433.069 142.069 433.069 168.931 416.5 185.5L206.5 395.5L100 420L124.5 313.5L334.5 103.5L356.5 125.5Z" stroke="white" strokeWidth="36" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M312 170L372 230" stroke="white" strokeWidth="36" strokeLinecap="round"/>
      <path d="M100 420L180 440" stroke="white" strokeWidth="36" strokeLinecap="round" strokeOpacity="0.5"/>
    </svg>
  </div>
);

const App: React.FC = () => {
  const [view, setView] = useState<ViewMode>(ViewMode.FEED);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [inputApiKey, setInputApiKey] = useState('');
  
  // Filter State
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);

  const refreshMemories = async () => {
    const loaded = await getMemories();
    setMemories(loaded);
  };

  useEffect(() => {
    refreshMemories();

    const checkKey = async () => {
        const storedKey = localStorage.getItem('gemini_api_key');
        if (storedKey) {
            setApiKeySet(true);
        }
    };
    checkKey();
  }, []);

  const clearKey = () => {
    localStorage.removeItem('gemini_api_key');
    localStorage.removeItem('saveitforl8r_access');
    setApiKeySet(false);
    setInputApiKey('');
  };

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

  // --- Filtering Logic ---

  // Helper to extract strictly user-entered tags (approximated by diffing total tags vs AI tags)
  const getUserTags = (memory: Memory): string[] => {
    const aiTags = new Set(memory.enrichment?.suggestedTags || []);
    return memory.tags.filter(t => !aiTags.has(t));
  };

  const { availableTypes, availableTags, filteredMemories } = useMemo(() => {
    // 1. Extract Filter Options
    const types = new Set<string>();
    const tags = new Set<string>();

    memories.forEach(m => {
        if (m.enrichment?.entityContext?.type) {
            types.add(m.enrichment.entityContext.type);
        }
        // Collect only user tags for the filter list
        getUserTags(m).forEach(t => tags.add(t));
    });

    // 2. Filter Memories
    const filtered = memories.filter(m => {
        if (filterType && m.enrichment?.entityContext?.type !== filterType) {
            return false;
        }
        if (filterTag && !m.tags.includes(filterTag)) {
            return false;
        }
        return true;
    });

    return {
        availableTypes: Array.from(types).sort(),
        availableTags: Array.from(tags).sort(),
        filteredMemories: filtered
    };
  }, [memories, filterType, filterTag]);

  const getTypeIcon = (type: string) => {
      const t = type.toLowerCase();
      if (t.includes('movie') || t.includes('tv')) return <Tv size={12} />;
      if (t.includes('book')) return <BookOpen size={12} />;
      if (t.includes('product')) return <ShoppingBag size={12} />;
      if (t.includes('music')) return <Music size={12} />;
      return <Layers size={12} />;
  };

  if (!apiKeySet) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
        <div className="max-w-md text-center bg-gray-800 p-8 rounded-3xl shadow-xl border border-gray-700 w-full">
          <div className="w-20 h-20 mx-auto mb-6 shadow-lg rounded-2xl overflow-hidden">
             <Logo className="w-full h-full" />
          </div>
          <h1 className="text-3xl font-black text-white mb-4 tracking-tight">Access SaveItForL8r</h1>
          <p className="text-gray-400 mb-8 leading-relaxed">Please enter your Gemini API Key to enable multimodal knowledge capture.</p>
          
          <div className="space-y-4">
             <input 
                type="password"
                value={inputApiKey}
                onChange={(e) => setInputApiKey(e.target.value)}
                placeholder="Enter Gemini API Key"
                className="w-full bg-gray-700 text-white px-4 py-3 rounded-xl border border-gray-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
             />
             <button 
               onClick={() => {
                 if (inputApiKey.trim()) {
                   localStorage.setItem('gemini_api_key', inputApiKey.trim());
                   setApiKeySet(true);
                 }
               }}
               className="w-full bg-blue-600 text-white px-6 py-4 rounded-2xl hover:bg-blue-700 transition-all font-bold shadow-lg shadow-blue-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
               disabled={!inputApiKey.trim()}
             >
               Connect API Key
             </button>
             <p className="text-xs text-gray-500 mt-4">
                Don't have a key? <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">Get one here</a>
             </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Sticky Header Wrapper */}
      <div className="sticky top-0 z-30 bg-gray-900/90 backdrop-blur-md border-b border-gray-800">
          {/* Top Navigation */}
          <nav className="px-4 py-3 sm:px-8 flex justify-center">
            <div className="w-full max-w-4xl flex items-center gap-4">
              <div 
                className="flex items-center gap-3 text-blue-500 font-black text-xl tracking-tighter shrink-0 cursor-pointer"
                onClick={() => { setFilterType(null); setFilterTag(null); setView(ViewMode.FEED); }}
              >
                <Logo className="w-8 h-8 rounded-lg shadow-sm" />
                <span className="hidden sm:inline">SaveItForL8r</span>
              </div>
              <div 
                onClick={() => setView(ViewMode.RECALL)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 transition-all cursor-text rounded-2xl flex items-center px-4 py-2.5 gap-3 group"
              >
                <Search size={18} className="text-gray-500 group-hover:text-blue-400" />
                <span className="text-gray-400 font-medium text-sm sm:text-base truncate">Search your second brain...</span>
              </div>

              <button
                onClick={clearKey}
                className="p-2.5 text-gray-500 hover:text-red-400 hover:bg-red-900/20 rounded-xl transition-colors shrink-0"
                title="Clear API Key"
              >
                <LogOut size={20} />
              </button>
            </div>
          </nav>

          {/* Filter Bar */}
          {(availableTypes.length > 0 || availableTags.length > 0) && (
             <div className="w-full max-w-4xl mx-auto px-4 sm:px-8 py-2 flex items-center gap-2 overflow-x-auto no-scrollbar mask-gradient">
                <div className="flex items-center gap-2 pr-3 shrink-0 border-r border-gray-700/50 mr-1">
                    <Filter size={14} className="text-gray-500" />
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest hidden sm:inline">Filter</span>
                </div>

                {(filterType || filterTag) && (
                    <button 
                        onClick={() => { setFilterType(null); setFilterTag(null); }} 
                        className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full bg-gray-800 text-gray-400 text-xs font-bold border border-red-900/30 hover:bg-red-900/20 hover:text-red-400 transition-colors"
                    >
                        <X size={12} /> Clear
                    </button>
                )}

                {/* Types */}
                {availableTypes.map(t => (
                    <button 
                        key={t} 
                        onClick={() => setFilterType(filterType === t ? null : t)}
                        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                            filterType === t 
                            ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-900/20' 
                            : 'bg-gray-800 text-gray-300 border-gray-700 hover:border-gray-500'
                        }`}
                    >
                        {getTypeIcon(t)} {t}
                    </button>
                ))}

                {/* Tags */}
                {availableTags.map(t => (
                    <button 
                        key={t} 
                        onClick={() => setFilterTag(filterTag === t ? null : t)}
                        className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                            filterTag === t 
                            ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-900/20' 
                            : 'bg-gray-800 text-gray-300 border-gray-700 hover:border-gray-500'
                        }`}
                    >
                        <Tag size={10} className={filterTag === t ? 'text-white' : 'text-emerald-500'} />
                        {t}
                    </button>
                ))}
             </div>
          )}
      </div>

      {/* Grid Content */}
      <main className="flex-1 p-4 sm:p-8 max-w-7xl mx-auto w-full">
        {filteredMemories.length === 0 ? (
          <div className="h-[60vh] flex flex-col items-center justify-center text-center px-6 relative">
             {memories.length === 0 ? (
                <>
                    <h2 className="text-3xl font-black text-white mb-4 tracking-tight">Build your knowledge base</h2>
                    <p className="text-gray-400 max-w-md text-lg leading-relaxed mb-8">
                    Capture thoughts, links, and images. 
                    <br className="hidden sm:block" />
                    SaveItForL8r organizes them for you.
                    </p>
                    <div className="fixed bottom-28 right-8 sm:bottom-32 sm:right-24 z-10 animate-bounce pointer-events-none opacity-50 sm:opacity-100">
                        <svg width="100" height="100" viewBox="0 0 100 100" fill="none" className="text-gray-600 rotate-12 drop-shadow-sm">
                            <path d="M20 20 C 50 20, 80 40, 90 90" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                            <path d="M90 90 L 65 80" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                            <path d="M90 90 L 100 65" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                        </svg>
                    </div>
                </>
             ) : (
                 <div className="flex flex-col items-center animate-in fade-in zoom-in-95">
                     <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center mb-4 border border-gray-700">
                         <Search size={32} className="text-gray-500" />
                     </div>
                     <h3 className="text-xl font-bold text-gray-200">No matching memories</h3>
                     <p className="text-gray-500 mt-2">Try adjusting your filters.</p>
                     <button 
                        onClick={() => { setFilterType(null); setFilterTag(null); }}
                        className="mt-6 px-4 py-2 bg-gray-800 text-blue-400 text-sm font-bold rounded-xl border border-gray-700 hover:bg-gray-700 transition-colors"
                     >
                         Clear Filters
                     </button>
                 </div>
             )}
          </div>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-6">
            {filteredMemories.map(mem => (
              <MemoryCard 
                key={mem.id} 
                memory={mem} 
                onDelete={handleDelete} 
                onRetry={handleRetry}
              />
            ))}
          </div>
        )}
      </main>

      {/* Floating Action Button */}
      <button 
        onClick={() => setIsCaptureOpen(true)}
        className="fixed bottom-6 right-4 sm:bottom-8 sm:right-8 z-20 w-14 h-14 sm:w-16 sm:h-16 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-2xl hover:bg-blue-700 hover:scale-110 active:scale-95 transition-all duration-300 shadow-blue-900/50"
      >
        <Plus size={32} strokeWidth={3} />
      </button>

      {/* Modals */}
      <InputBuffer 
        isOpen={isCaptureOpen} 
        onClose={() => setIsCaptureOpen(false)} 
        onMemoryCreated={refreshMemories} 
      />

      {view === ViewMode.RECALL && (
        <ChatInterface 
          memories={filteredMemories.filter(m => !m.isDeleting)} 
          onClose={() => setView(ViewMode.FEED)} 
        />
      )}
    </div>
  );
};

export default App;
