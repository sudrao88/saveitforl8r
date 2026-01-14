
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Search, Filter, X, Tag, Tv, BookOpen, ShoppingBag, Music, Layers, AlertTriangle, Shield, Zap, Settings, Download, Upload, HelpCircle } from 'lucide-react';
import InputBuffer from './components/InputBuffer.tsx';
import MemoryCard from './components/MemoryCard.tsx';
import ChatInterface from './components/ChatInterface.tsx';
import MultiSelect from './components/MultiSelect.tsx';
import { getMemories, deleteMemory, saveMemory } from './services/storageService.ts';
import { enrichInput } from './services/geminiService.ts';
import { memoriesToCSV, csvToMemories } from './services/csvService.ts';
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

// KeyOff Icon Component from Google Material Design Icons
const KeyOff = ({ size = 24, className = "" }: { size?: number, className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    height={size} 
    width={size}
    viewBox="0 -960 960 960"
    fill="currentColor"
    className={className}
  >
    <path d="M790-57 488-359q-32 54-87 86.5T280-240q-100 0-170-70T40-480q0-66 32.5-121t86.5-87L57-790l57-56 732 733-56 56Zm50-543 120 120-183 183-127-126 50-37 72 54 75-74-40-40H553l-80-80h367ZM280-320q51 0 90.5-27.5T428-419l-56-56-48.5-48.5L275-572l-56-56q-44 18-71.5 57.5T120-480q0 66 47 113t113 47Zm0-80q-33 0-56.5-23.5T200-480q0-33 23.5-56.5T280-560q33 0 56.5 23.5T360-480q0 33-23.5 56.5T280-400Z"/>
  </svg>
);

const App: React.FC = () => {
  const [view, setView] = useState<ViewMode>(ViewMode.FEED);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [inputApiKey, setInputApiKey] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  // Export Filter State
  const [exportSelectedTypes, setExportSelectedTypes] = useState<string[]>([]);
  const [exportSelectedTags, setExportSelectedTags] = useState<string[]>([]);
  
  // Ref for file input
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setIsSettingsOpen(false);
  };

  const handleExport = async () => {
    let data = await getMemories();

    // 1. Filter by Types (OR logic within types)
    // If types are selected, keep memories that match ANY of those types.
    if (exportSelectedTypes.length > 0) {
        data = data.filter(m => {
            const type = m.enrichment?.entityContext?.type;
            return type && exportSelectedTypes.includes(type);
        });
    }

    // 2. Filter by Tags (OR logic within tags)
    // Keep memories that have AT LEAST ONE of the selected tags.
    if (exportSelectedTags.length > 0) {
        data = data.filter(m => {
            return m.tags.some(tag => exportSelectedTags.includes(tag));
        });
    }

    if (data.length === 0) {
        alert("No memories match the selected filters.");
        return;
    }

    const csvString = memoriesToCSV(data);
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `saveitforl8r-backup-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportClick = () => {
      fileInputRef.current?.click();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        
        if (file.name.endsWith('.csv')) {
            const parsedMemories = csvToMemories(content);
            if (parsedMemories.length > 0) {
                 let count = 0;
                 for (const mem of parsedMemories) {
                     await saveMemory(mem);
                     count++;
                 }
                 alert(`Successfully imported ${count} memories from CSV.`);
                 refreshMemories();
            } else {
                alert("No valid memories found in CSV.");
            }
        } else {
             alert("Please upload a valid .csv file.");
        }
      } catch (error) {
        console.error("Import failed:", error);
        alert("Failed to import file.");
      }
      // Reset file input
      if (fileInputRef.current) {
          fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
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
      <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4 sm:p-8">
        <div className="max-w-6xl w-full grid lg:grid-cols-2 gap-12 items-center">
          
          {/* Left Column: Marketing Content */}
          <div className="text-left order-1">
             <div className="mb-8">
                <div className="flex items-center gap-4 mb-4">
                     <div className="w-16 h-16 shadow-2xl rounded-2xl overflow-hidden animate-in fade-in zoom-in duration-500 hidden lg:block">
                        <Logo className="w-full h-full" />
                    </div>
                    <div>
                        <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-tight">SaveItForL8r</h1>
                        <p className="text-xl text-blue-400 font-medium">Your AI-Powered Second Brain</p>
                    </div>
                </div>
             </div>

             <div className="grid gap-6">
                <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700 hover:border-blue-500/50 transition-colors group flex gap-4 items-start">
                  <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-blue-500/20 transition-colors">
                    <Zap className="text-blue-400" size={24} />
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-lg mb-1">Smart Organization</h3>
                    <p className="text-gray-400 text-sm leading-relaxed">
                        Gemini automatically tags and categorizes your saved links, images, and notes so you can easily find them later.
                    </p>
                  </div>
                </div>

                <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700 hover:border-green-500/50 transition-colors group flex gap-4 items-start">
                  <div className="w-12 h-12 bg-green-500/10 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-green-500/20 transition-colors">
                    <Shield className="text-green-400" size={24} />
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-lg mb-1">Private & Local</h3>
                    <p className="text-gray-400 text-sm leading-relaxed">
                        Your data is stored locally on your device. We don't track your memories or store them on external servers.
                    </p>
                  </div>
                </div>
             </div>
          </div>

          {/* Right Column: Input Form */}
          <div className="bg-gray-800 p-8 rounded-3xl shadow-xl border border-gray-700 w-full max-w-md mx-auto lg:mx-0 lg:ml-auto order-2">
            
            <h2 className="text-xl font-bold text-white mb-2">Get Started</h2>
            <p className="text-gray-400 mb-6 text-sm leading-relaxed">Please enter your Gemini API Key to enable multimodal knowledge capture.</p>
            
            <div className="space-y-4">
               <input 
                  type="password"
                  value={inputApiKey}
                  onChange={(e) => setInputApiKey(e.target.value)}
                  placeholder="Enter Gemini API Key"
                  className="w-full bg-gray-700 text-white px-4 py-3 rounded-xl border border-gray-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
               />
               <button 
                 onClick={() => {
                   if (inputApiKey.trim()) {
                     localStorage.setItem('gemini_api_key', inputApiKey.trim());
                     setApiKeySet(true);
                   }
                 }}
                 className="w-full bg-blue-600 text-white px-6 py-4 rounded-2xl hover:bg-blue-700 transition-all font-bold shadow-lg shadow-blue-900/50 disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-95"
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
                onClick={() => setIsSettingsOpen(true)}
                className="p-2.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-xl transition-colors shrink-0"
                title="Settings"
              >
                <Settings size={20} />
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

      {/* Hidden File Input for Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportFile}
        className="hidden"
        accept=".csv"
      />

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

      {/* Settings Dialog */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-3xl p-6 max-w-md w-full shadow-2xl relative">
            <button 
              onClick={() => setIsSettingsOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
            
            <div className="flex flex-col text-left">
              <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 bg-gray-700/50 rounded-2xl flex items-center justify-center text-gray-300">
                    <Settings size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white">Settings</h3>
                    <p className="text-gray-400 text-sm">Manage your data and preferences</p>
                  </div>
              </div>
              
              <div className="space-y-6">
                   {/* Data Management Section */}
                   <div className="space-y-3">
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Data Management</h4>
                      
                      <div className="bg-gray-700/30 p-4 rounded-2xl border border-gray-700 space-y-4">
                          {/* Export */}
                          <div>
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-semibold text-gray-300">Export Memories</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 mb-3">
                                <MultiSelect 
                                  label="Type"
                                  options={availableTypes}
                                  selected={exportSelectedTypes}
                                  onChange={setExportSelectedTypes}
                                  placeholder="All Types"
                                />
                                <MultiSelect 
                                  label="Tags"
                                  options={availableTags}
                                  selected={exportSelectedTags}
                                  onChange={setExportSelectedTags}
                                  placeholder="All Tags"
                                />
                              </div>
                              <button
                                onClick={handleExport}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-750 text-white rounded-xl font-medium transition-colors border border-gray-600 hover:border-blue-500/50 group"
                              >
                                <Download size={16} className="text-blue-400 group-hover:text-blue-300" />
                                <span>Download CSV</span>
                              </button>
                          </div>

                          <div className="h-px bg-gray-700/50" />

                          {/* Import */}
                          <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-gray-300">Import Memories</span>
                                <div className="group relative">
                                    <HelpCircle size={14} className="text-gray-500 cursor-help" />
                                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-48 p-2 bg-black/90 text-xs text-gray-300 rounded-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity text-center">
                                        Import memories from a CSV file exported from SaveItForL8r. Useful for sharing with friends & family.
                                    </div>
                                </div>
                              </div>
                              <button
                                onClick={handleImportClick}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-750 text-white rounded-xl font-medium transition-colors border border-gray-600 hover:border-green-500/50 group text-sm"
                              >
                                <Upload size={16} className="text-green-400 group-hover:text-green-300" />
                                <span>Import CSV</span>
                              </button>
                          </div>
                      </div>
                   </div>

                   {/* Account Section */}
                   <div className="space-y-3">
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Account</h4>
                      <button
                        onClick={clearKey}
                        className="w-full flex items-center justify-between px-4 py-3 bg-red-900/10 hover:bg-red-900/20 text-red-400 rounded-xl font-medium transition-colors border border-red-900/20 hover:border-red-900/40 group"
                      >
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-red-900/20 rounded-lg group-hover:bg-red-900/30 transition-colors">
                                <KeyOff size={18} />
                            </div>
                            <div className="text-left">
                                <span className="block text-sm font-bold text-gray-200 group-hover:text-white">Disconnect API Key</span>
                                <span className="block text-xs text-red-400/70">Removes access from this device</span>
                            </div>
                        </div>
                      </button>
                   </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
