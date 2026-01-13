import React, { useState, useRef, useEffect } from 'react';
import { Send, Image as ImageIcon, FileText, X, Tag as TagIcon, Check, Paperclip, Loader2, MapPin } from 'lucide-react';
import { saveMemory } from '../services/storageService.ts';
import { enrichInput } from '../services/geminiService.ts';
import { Memory, Attachment } from '../types.ts';

interface InputBufferProps {
  isOpen: boolean;
  onClose: () => void;
  onMemoryCreated: () => void;
}

const SUGGESTED_TAGS = ["Book", "Restaurant", "Place to Visit", "Movie", "Podcast", "Stuff"];

const InputBuffer: React.FC<InputBufferProps> = ({ isOpen, onClose, onMemoryCreated }) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen && textAreaRef.current) {
      setTimeout(() => textAreaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      const newAttachments: Attachment[] = [];

      for (const file of files) {
        // Simple Base64 conversion
        const reader = new FileReader();
        const result = await new Promise<string>((resolve) => {
          reader.onload = (evt) => resolve(evt.target?.result as string);
          reader.readAsDataURL(file);
        });

        const type = file.type.startsWith('image/') ? 'image' : 'file';
        
        newAttachments.push({
          id: crypto.randomUUID(),
          type,
          mimeType: file.type,
          data: result,
          name: file.name
        });
      }
      
      setAttachments(prev => [...prev, ...newAttachments]);
      // Reset input so same file can be selected again if needed
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const toggleTag = (tag: string) => {
    if (tags.includes(tag)) {
      setTags(tags.filter(t => t !== tag));
    } else {
      setTags([...tags, tag]);
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  const handleSubmit = async () => {
    if ((!text.trim() && attachments.length === 0) || isProcessing) return;

    setIsProcessing(true);
    
    try {
      // 1. Get Location (if available)
      let location: { latitude: number; longitude: number; accuracy?: number } | undefined;
      try {
        if (navigator.geolocation) {
            // Add a timeout to geolocation to prevent hanging
            const pos = await Promise.race([
                new Promise<GeolocationPosition>((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
                }),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
            ]) as GeolocationPosition | null;

            if (pos) {
                location = {
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                };
            }
        }
      } catch (e) {
        console.warn("Location access denied or unavailable", e);
      }

      // 2. Create Initial Memory Object (Pending State)
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

      // Save immediately to DB
      await saveMemory(newMemory);
      
      // Close UI immediately for responsiveness
      onMemoryCreated(); // Trigger refresh in parent
      handleClose();

      // 3. Process Enrichment in Background (Async)
      enrichInput(text, attachments, location, tags)
        .then(async (enrichment) => {
            const allTags = Array.from(new Set([...tags, ...enrichment.suggestedTags]));
            const updatedMemory: Memory = {
                ...newMemory,
                enrichment,
                tags: allTags,
                isPending: false
            };
            await saveMemory(updatedMemory);
            onMemoryCreated(); // Refresh again with enriched data
        })
        .catch(async (err) => {
            console.error("Enrichment failed:", err);
            const failedMemory: Memory = {
                ...newMemory,
                isPending: false,
                processingError: true
            };
            await saveMemory(failedMemory);
            onMemoryCreated();
        });

    } catch (error) {
        console.error("Error creating memory:", error);
        setIsProcessing(false); 
        alert("Failed to save memory. Please try again.");
    }
  };

  const handleClose = () => {
    setText('');
    setAttachments([]);
    setTags([]);
    setTagInput('');
    setIsProcessing(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" style={{ zIndex: 100 }}>
        {/* Backdrop */}
        <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={handleClose}
        />

        {/* Modal Content */}
        <div className="relative w-full max-w-2xl bg-gray-900 border-t sm:border border-gray-700 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-300 max-h-[90vh]">
            
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900/95 backdrop-blur">
                <h3 className="text-gray-100 font-bold text-sm">New Memory</h3>
                <button onClick={handleClose} className="p-1.5 rounded-full hover:bg-gray-800 text-gray-500 hover:text-white transition-colors">
                    <X size={20} />
                </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto custom-scrollbar">
                {/* Text Input */}
                <textarea
                    ref={textAreaRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Capture a thought, idea, or observation..."
                    className="w-full h-32 sm:h-40 bg-transparent text-lg text-white placeholder-gray-500 resize-none focus:outline-none leading-relaxed"
                />

                {/* Attachments Preview */}
                {attachments.length > 0 && (
                    <div className="flex gap-3 overflow-x-auto py-2 no-scrollbar">
                        {attachments.map((att) => (
                            <div key={att.id} className="relative group shrink-0 animate-in zoom-in-90 duration-200">
                                {att.type === 'image' ? (
                                    <div className="w-20 h-20 rounded-xl overflow-hidden border border-gray-700 bg-black/50">
                                        <img src={att.data} alt="preview" className="w-full h-full object-cover" />
                                    </div>
                                ) : (
                                    <div className="w-20 h-20 rounded-xl border border-gray-700 bg-gray-800/50 flex flex-col items-center justify-center p-2 text-center">
                                        <FileText size={20} className="text-gray-400 mb-1" />
                                        <span className="text-[9px] text-gray-400 w-full truncate px-1">{att.name}</span>
                                    </div>
                                )}
                                <button 
                                    onClick={() => removeAttachment(att.id)}
                                    className="absolute -top-2 -right-2 bg-gray-800 text-gray-400 hover:text-red-400 border border-gray-600 rounded-full p-1 shadow-lg transition-colors"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Tags Interface */}
                <div className="pt-2 space-y-3">
                    
                    {/* Suggested Tags */}
                    <div className="flex flex-wrap gap-2">
                        {SUGGESTED_TAGS.map(tag => {
                            const isSelected = tags.includes(tag);
                            return (
                                <button
                                    key={tag}
                                    onClick={() => toggleTag(tag)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
                                        isSelected 
                                        ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-900/20' 
                                        : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500 hover:text-gray-200'
                                    }`}
                                >
                                    {tag}
                                </button>
                            );
                        })}
                    </div>

                    {/* Active Tags & Input */}
                    <div className="flex flex-wrap items-center gap-2">
                        {tags.map(tag => (
                            <span key={tag} className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 animate-in fade-in">
                                #{tag}
                                <button onClick={() => removeTag(tag)} className="hover:text-blue-200 ml-1"><X size={12} /></button>
                            </span>
                        ))}
                        <div className="flex items-center gap-2 bg-gray-800/50 px-3 py-1.5 rounded-xl border border-gray-700/50 focus-within:border-blue-500/50 focus-within:bg-gray-800 transition-all">
                            <TagIcon size={14} className="text-gray-500" />
                            <input 
                                type="text" 
                                value={tagInput}
                                onChange={(e) => setTagInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleAddTag();
                                    }
                                }}
                                onBlur={handleAddTag} 
                                placeholder="Add custom tag..."
                                className="bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none w-28 sm:w-32"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer / Actions */}
            <div className="p-4 bg-gray-900 border-t border-gray-800 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="p-3 text-gray-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-xl transition-colors border border-transparent hover:border-blue-900/30"
                        title="Add Image or File"
                    >
                        <ImageIcon size={20} />
                    </button>
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileSelect} 
                        className="hidden" 
                        multiple 
                        accept="image/*,.pdf,.txt,.md"
                    />
                </div>

                <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 font-medium hidden sm:inline-block">
                        {isProcessing ? 'Saving to brain...' : ''}
                    </span>
                    <button 
                        onClick={handleSubmit}
                        disabled={(!text.trim() && attachments.length === 0) || isProcessing}
                        className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all shadow-lg
                            ${(!text.trim() && attachments.length === 0) || isProcessing 
                                ? 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700' 
                                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-900/20 hover:scale-[1.02] active:scale-95'
                            }`}
                    >
                        {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                        {isProcessing ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    </div>
  );
};

export default InputBuffer;