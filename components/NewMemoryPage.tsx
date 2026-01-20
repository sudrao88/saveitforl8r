import React, { useState, useRef, useEffect } from 'react';
import { Send, Image as ImageIcon, FileText, X, Tag as TagIcon, Loader2, ArrowLeft } from 'lucide-react';
import { Attachment } from '../types';

interface NewMemoryPageProps {
  onClose: () => void;
  // Updated prop: takes data, returns Promise (void)
  onCreate: (
    text: string, 
    attachments: Attachment[], 
    tags: string[], 
    location?: { latitude: number; longitude: number; accuracy?: number }
  ) => Promise<void>; 
  initialContent?: {
    text: string;
    attachments: Attachment[];
  };
}

const SUGGESTED_TAGS = ["Book", "Restaurant", "Place to Visit", "Movie", "Podcast", "Stuff"];

const NewMemoryPage: React.FC<NewMemoryPageProps> = ({ onClose, onCreate, initialContent }) => {
  const [text, setText] = useState(initialContent?.text || '');
  const [attachments, setAttachments] = useState<Attachment[]>(initialContent?.attachments || []);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialContent) {
        setText(initialContent.text || '');
        setAttachments(initialContent.attachments || []);
    }
  }, [initialContent]);

  useEffect(() => {
    if (textAreaRef.current) {
      setTimeout(() => textAreaRef.current?.focus(), 100);
    }
  }, []);

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

      // 2. Delegate creation to parent (hooks/useMemories)
      await onCreate(text, attachments, tags, location);
      
      handleClose();

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

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-30 bg-gray-900/90 backdrop-blur-md border-b border-gray-800 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
                <button 
                    onClick={handleClose} 
                    className="p-2 -ml-2 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                >
                    <ArrowLeft size={24} />
                </button>
                <h1 className="text-xl font-bold text-gray-100">New Memory</h1>
            </div>
        </div>

        <main className="flex-1 p-4 sm:p-8 max-w-3xl mx-auto w-full space-y-6">
            {/* Text Input */}
            <div className="space-y-2">
                <textarea
                    ref={textAreaRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Capture a thought, idea, or observation..."
                    className="w-full min-h-[200px] bg-transparent text-lg text-white placeholder-gray-500 resize-y focus:outline-none leading-relaxed"
                />
            </div>

            {/* Attachments Preview */}
            {attachments.length > 0 && (
                <div className="flex gap-3 flex-wrap">
                    {attachments.map((att) => (
                        <div key={att.id} className="relative group animate-in zoom-in-90 duration-200">
                            {att.type === 'image' ? (
                                <div className="w-24 h-24 rounded-xl overflow-hidden border border-gray-700 bg-black/50">
                                    <img src={att.data} alt="preview" className="w-full h-full object-cover" />
                                </div>
                            ) : (
                                <div className="w-24 h-24 rounded-xl border border-gray-700 bg-gray-800/50 flex flex-col items-center justify-center p-2 text-center">
                                    <FileText size={24} className="text-gray-400 mb-2" />
                                    <span className="text-[10px] text-gray-400 w-full truncate px-1">{att.name}</span>
                                </div>
                            )}
                            <button 
                                onClick={() => removeAttachment(att.id)}
                                className="absolute -top-2 -right-2 bg-gray-800 text-gray-400 hover:text-red-400 border border-gray-600 rounded-full p-1.5 shadow-lg transition-colors"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Actions: Image Button */}
            <div className="flex items-center gap-2 pt-2">
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2.5 text-gray-300 bg-gray-800 hover:bg-gray-700 hover:text-white rounded-xl transition-colors border border-gray-700"
                >
                    <ImageIcon size={20} />
                    <span>Add Attachment</span>
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

            <hr className="border-gray-800 my-6" />

            {/* Tags Interface */}
            <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Tags</h3>
                
                {/* Active Tags & Input */}
                <div className="flex flex-wrap items-center gap-2">
                    {tags.map(tag => (
                        <span key={tag} className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2 animate-in fade-in">
                            #{tag}
                            <button onClick={() => removeTag(tag)} className="hover:text-blue-200"><X size={14} /></button>
                        </span>
                    ))}
                    <div className="flex items-center gap-2 bg-gray-800/50 px-3 py-1.5 rounded-xl border border-gray-700/50 focus-within:border-blue-500/50 focus-within:bg-gray-800 transition-all">
                        <TagIcon size={16} className="text-gray-500" />
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
                            className="bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none min-w-[120px]"
                        />
                    </div>
                </div>

                {/* Suggested Tags */}
                <div className="flex flex-wrap gap-2">
                    {SUGGESTED_TAGS.map(tag => {
                        const isSelected = tags.includes(tag);
                        if (isSelected) return null; // Hide if already selected
                        return (
                            <button
                                key={tag}
                                onClick={() => toggleTag(tag)}
                                className="px-3 py-1.5 rounded-full text-xs font-bold bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-gray-200 transition-all"
                            >
                                + {tag}
                            </button>
                        );
                    })}
                </div>
            </div>

            <hr className="border-gray-800 my-6" />

            {/* Save Button - Moved to bottom */}
            <div className="flex justify-end pt-2 pb-6">
                <button 
                    onClick={handleSubmit}
                    disabled={(!text.trim() && attachments.length === 0) || isProcessing}
                    className={`flex items-center justify-center gap-2 px-8 py-3 rounded-xl font-bold transition-all shadow-lg w-full sm:w-auto
                        ${(!text.trim() && attachments.length === 0) || isProcessing 
                            ? 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700' 
                            : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-900/20 hover:scale-[1.02] active:scale-95'
                        }`}
                >
                    {isProcessing ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                    {isProcessing ? 'Saving...' : 'Save Memory'}
                </button>
            </div>
        </main>
    </div>
  );
};

export default NewMemoryPage;