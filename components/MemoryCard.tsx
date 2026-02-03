import React, { useState, useEffect, useRef } from 'react';
import { Trash2, MapPin, Loader2, Clock, ExternalLink, X, Check, Star, ShoppingBag, Tv, BookOpen, RefreshCcw, WifiOff, FileText, Paperclip, ChevronDown, ChevronUp, FileCode, MoreVertical, Search, AlertTriangle, Key, Square, CheckSquare, Maximize2, Eye, Pin } from 'lucide-react';
import { Memory, Attachment } from '../types.ts';

interface MemoryCardProps {
  memory: Memory;
  onDelete?: (id: string) => void;
  onRetry?: (id: string) => void;
  onUpdate?: (id: string, content: string) => void;
  onExpand?: (memory: Memory) => void;
  onViewAttachment?: (attachment: Attachment) => void;
  onTogglePin?: (id: string, isPinned: boolean) => void;
  isDialog?: boolean;
  hasApiKey?: boolean;
  onAddApiKey?: () => void;
}


// Convert plain-text URLs into clickable <a> tags, skipping URLs already inside anchors.
const linkifyHtml = (html: string): string => {
    const urlRegex = /(https?:\/\/[^\s<>"')\]]+)/g;
    const parts = html.split(/(<[^>]+>)/g);

    let insideAnchor = false;
    return parts.map(part => {
        if (part.startsWith('<')) {
            if (/^<a[\s>]/i.test(part)) insideAnchor = true;
            if (/^<\/a>/i.test(part)) insideAnchor = false;
            return part;
        }
        if (insideAnchor) return part;
        return part.replace(urlRegex,
            '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline break-all">$1</a>'
        );
    }).join('');
};

const MemoryCard: React.FC<MemoryCardProps> = ({ memory, onDelete, onRetry, onUpdate, onExpand, onViewAttachment, onTogglePin, isDialog, hasApiKey = true, onAddApiKey }) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [dismissedError, setDismissedError] = useState(false);
  
  const [isTruncated, setIsTruncated] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDialog && contentRef.current) {
      const hasOverflow = contentRef.current.scrollHeight > 300;
      setIsTruncated(hasOverflow);
    }
  }, [memory.content, isDialog]);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const dateStr = new Date(memory.timestamp).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric'
  });

  const locationContext = memory.enrichment?.locationContext;
  let targetUri = locationContext?.mapsUri;
  
  if (!targetUri && locationContext?.name) {
     const lat = memory.location?.latitude;
     const lng = memory.location?.longitude;
     const name = locationContext.name;
     if (lat && lng) {
        targetUri = `https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat},${lng},17z`;
    } else {
        targetUri = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
    }
  }

  const entity = memory.enrichment?.entityContext;

  if (!targetUri) {
      const query = entity?.title || memory.enrichment?.summary;
      if (query) {
           targetUri = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      }
  }

  const startDelete = (e: React.MouseEvent) => { 
      e.stopPropagation(); 
      setIsConfirming(true); 
      setIsMenuOpen(false);
  };
  
  const cancelDelete = (e: React.MouseEvent) => { e.stopPropagation(); setIsConfirming(false); };
  const confirmDelete = (e: React.MouseEvent) => { e.stopPropagation(); onDelete?.(memory.id); };

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin?.(memory.id, !memory.isPinned);
    setIsMenuOpen(false);
  };

  const getEntityIcon = (type?: string) => {
    const t = type?.toLowerCase() || '';
    if (t.includes('movie') || t.includes('tv') || t.includes('show')) return <Tv size={14} className="text-purple-400" />;
    if (t.includes('book')) return <BookOpen size={14} className="text-amber-500" />;
    if (t.includes('product')) return <ShoppingBag size={14} className="text-green-500" />;
    return <Star size={14} className="text-yellow-500" />;
  };

  const userAttachments = memory.attachments?.filter(a => a.type === 'image') || [];
  const hasLegacyImage = !memory.attachments && memory.image;
  
  const displayImages = userAttachments.length > 0 
    ? userAttachments 
    : (hasLegacyImage ? [{ id: 'legacy', data: memory.image!, name: 'Image', type: 'image', mimeType: 'image/jpeg' } as Attachment] : []);
  
  const documents = memory.attachments?.filter(a => a.type === 'file') || [];
  
  const aiText = entity?.description || memory.enrichment?.summary;
  const shouldTruncateAI = aiText && aiText.length > 120;

  const showErrorOverlay = memory.processingError && onRetry && !dismissedError;
  const showAddKeyOverlay = !hasApiKey && (memory.isPending || !!memory.processingError) && !dismissedError;

  const isChecklist = memory.content.startsWith('<ul class="checklist">');
  
  const handleToggleCheck = (index: number) => {
      if (!onUpdate) return;
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(memory.content, 'text/html');
      const items = doc.querySelectorAll('li');
      
      if (items[index]) {
          const current = items[index].getAttribute('data-checked') === 'true';
          items[index].setAttribute('data-checked', String(!current));
          
          const listItems = Array.from(items).map(li => 
              `<li data-checked="${li.getAttribute('data-checked')}">${li.innerHTML}</li>`
          ).join('');
          const newContent = `<ul class="checklist">${listItems}</ul>`;
          
          onUpdate(memory.id, newContent);
      }
  };

  const renderContent = () => {
      if (isChecklist) {
          const parser = new DOMParser();
          const doc = parser.parseFromString(memory.content, 'text/html');
          const items = Array.from(doc.querySelectorAll('li'));
          
          return (
              <div className="space-y-2 mt-2">
                  {items.map((item, idx) => {
                      const checked = item.getAttribute('data-checked') === 'true';
                      const text = item.textContent || '';
                      
                      return (
                        <div 
                            key={idx} 
                            className="flex items-start gap-3 group/item cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); handleToggleCheck(idx); }}
                        >
                            <div className={`mt-0.5 transition-colors ${checked ? 'text-blue-500' : 'text-gray-500 group-hover/item:text-gray-400'}`}>
                                {checked ? <CheckSquare size={18} /> : <Square size={18} />}
                            </div>
                            <span className={`text-sm leading-relaxed transition-all ${checked ? 'text-gray-500 line-through decoration-gray-600' : 'text-gray-200'}`}>
                                {text}
                            </span>
                        </div>
                      );
                  })}
              </div>
          );
      }
      
      return (
          <div 
            className={`prose prose-invert prose-sm max-w-none text-gray-200 font-normal leading-relaxed break-words 
                prose-p:my-1 prose-headings:mb-1 prose-headings:mt-3 prose-headings:text-gray-100 prose-ul:my-1
                ${memory.content.length < 80 ? 'text-base' : 'text-sm'}
            `}
            dangerouslySetInnerHTML={{ __html: linkifyHtml(memory.content) }}
          />
      );
  };

  return (
    <>
      <div 
        className={`group relative w-full ${isDialog ? 'mb-0' : 'mb-6'} rounded-xl transition-all duration-300 overflow-hidden flex flex-col
        ${isDialog ? 'bg-gray-900 border border-gray-800' : 'bg-gray-800/40 border border-gray-700/30 hover:bg-gray-800/60 hover:border-gray-600/50 hover:shadow-lg'}
        ${memory.isPending ? 'opacity-70 border-blue-900/30' : ''}
        ${memory.processingError ? 'border-amber-900/30 bg-amber-900/5' : ''}
        ${showErrorOverlay || showAddKeyOverlay ? 'min-h-[350px]' : ''}
        `}
      >
        {/* API Key Overlay */}
        {showAddKeyOverlay && (
            <div className="absolute inset-0 z-20 bg-gray-900/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
                <div className="w-12 h-12 bg-blue-900/50 border-4 border-blue-800 rounded-full mb-4 flex items-center justify-center">
                    <Key size={24} className="text-blue-300" />
                </div>
                <h4 className="text-gray-100 font-bold mb-1">AI Enrichment Requires an API Key</h4>
                <p className="text-xs text-gray-400 mb-4">
                    Add your Gemini API key to enable automatic summaries, tagging, and contextual search for this memory.
                </p>
                <button
                    onClick={(e) => { e.stopPropagation(); onAddApiKey?.(); }}
                    className="w-full max-w-[200px] py-2.5 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors shadow-lg shadow-blue-500/20"
                >
                    Add API Key
                </button>
            </div>
        )}

        {/* Image Preview */}
        {displayImages.length > 0 && (
            <div 
                className={`relative overflow-hidden rounded-t-xl bg-gray-900/50 group/image cursor-zoom-in ${isDialog ? 'max-h-[50vh]' : 'aspect-video sm:aspect-[2/1]'}`}
                onClick={(e) => { e.stopPropagation(); onViewAttachment?.(displayImages[0]); }}
            >
                <img 
                    src={displayImages[0].data} 
                    alt="User content" 
                    className="w-full h-full object-cover transition-transform duration-700 group-hover/image:scale-105"
                />
                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/image:opacity-100 transition-opacity flex items-center justify-center">
                    <Maximize2 className="text-white" size={24} />
                </div>
                {displayImages.length > 1 && (
                  <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur-md">
                      +{displayImages.length - 1}
                  </div>
                )}
            </div>
        )}
        
        <div className="p-5 flex-1 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
             <div className="flex items-center gap-2">
                 {memory.isPinned && <Pin size={12} className="text-blue-400 rotate-45" />}
                 {entity?.type && (
                    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        {getEntityIcon(entity.type)}
                        {entity.type}
                    </span>
                 )}
                 {!entity?.type && <Clock size={12} className="text-gray-600" />}
                 <span className="text-[10px] text-gray-600 font-medium">{dateStr}</span>
             </div>
             {memory.isPending && <span className="text-xs font-medium text-blue-400">Enriching...</span>}
             {memory.processingError && <WifiOff size={12} className="text-amber-500" />}
          </div>

          <div className="space-y-3 flex-1 flex flex-col">
            {/* User Content with Mask-based Fade */}
            {memory.content && (
                <div className="relative">
                    <div 
                        ref={contentRef}
                        className={`transition-all duration-300 ${!isDialog && isTruncated ? 'max-h-[300px] overflow-hidden' : ''}`}
                        style={!isDialog && isTruncated ? {
                            WebkitMaskImage: 'linear-gradient(to bottom, black 150px, transparent 300px)',
                            maskImage: 'linear-gradient(to bottom, black 150px, transparent 300px)'
                        } : {}}
                    >
                        {renderContent()}
                    </div>
                    
                    {!isDialog && isTruncated && (
                        <div className="absolute bottom-0 left-0 right-0 flex justify-center pb-2">
                            <button 
                                onClick={(e) => { e.stopPropagation(); onExpand?.(memory); }}
                                className="flex items-center gap-2 px-4 py-1.5 bg-gray-800/90 backdrop-blur-md border border-gray-700 rounded-full text-[10px] font-bold text-blue-400 hover:text-blue-300 hover:bg-gray-700 transition-all shadow-lg"
                            >
                                <Maximize2 size={12} /> READ FULL MEMORY
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* AI Summary */}
            <div className="space-y-3 mt-auto">
                {(entity?.title) && (
                    <div className="pt-1">
                        {targetUri ? (
                            <a href={targetUri} target="_blank" rel="noopener noreferrer" className="group/link inline-flex items-start gap-2 active:opacity-70 transition-all">
                                <h3 className="text-lg font-bold text-blue-400 leading-tight underline decoration-blue-500/30 underline-offset-4 decoration-2">
                                    {entity.title}
                                </h3>
                                <ExternalLink size={16} className="mt-0.5 text-blue-500/70 shrink-0" />
                            </a>
                        ) : (
                            <h3 className="text-lg font-semibold text-gray-100 leading-tight">{entity.title}</h3>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                            {entity.subtitle && <span className="text-xs text-gray-400">{entity.subtitle}</span>}
                            {entity.rating && <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/10 text-yellow-500 rounded font-medium">★ {entity.rating}</span>}
                        </div>
                    </div>
                )}

                {aiText && (
                    <div className="text-sm text-gray-400 font-light leading-relaxed">
                        <span className={(!isExpanded && shouldTruncateAI) ? 'line-clamp-2' : ''}>{aiText}</span>
                        {shouldTruncateAI && (
                            <button 
                                onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                                className="text-[10px] font-bold text-gray-500 hover:text-blue-400 uppercase tracking-wide mt-1"
                            >
                                {isExpanded ? 'Show Less' : 'Read More'}
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Documents */}
            {documents.length > 0 && (
                <div className="flex flex-col gap-1.5 pt-1">
                    {documents.map((doc, idx) => (
                        <div 
                            key={idx} 
                            onClick={(e) => { e.stopPropagation(); onViewAttachment?.(doc); }}
                            className="flex items-center gap-2 p-2 rounded-lg bg-gray-900/30 border border-gray-700/30 hover:bg-gray-700/50 transition-colors cursor-pointer group/doc"
                        >
                            <FileText size={14} className="text-gray-500 group-hover/doc:text-blue-400" />
                            <span className="text-xs text-gray-300 truncate flex-1 group-hover/doc:text-white">{doc.name}</span>
                            <div className="flex items-center gap-2">
                                <Eye size={12} className="text-gray-500 opacity-0 group-hover/doc:opacity-100" />
                                <a 
                                    href={doc.data} 
                                    download={doc.name} 
                                    onClick={e => e.stopPropagation()} 
                                    className="p-1 text-gray-500 hover:text-white transition-colors"
                                >
                                    <Paperclip size={12} />
                                </a>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Footer */}
            <div className="flex flex-wrap items-center gap-y-2 gap-x-4 pt-2 border-t border-gray-700/20 mt-2">
                <div className="flex flex-wrap gap-1.5 flex-1">
                    {memory.tags.map((tag, idx) => (
                        <span key={idx} className="text-[10px] text-gray-500 hover:text-gray-300">#{tag}</span>
                    ))}
                </div>
                <div className="flex items-center gap-2 ml-auto relative">
                    {onRetry && memory.processingError && (
                        <button onClick={() => onRetry(memory.id)} className="text-amber-500 hover:text-amber-400 transition-colors">
                            <RefreshCcw size={14} />
                        </button>
                    )}
                    <div className="relative">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setIsMenuOpen(!isMenuOpen); }} 
                            className={`p-1 rounded-full hover:bg-gray-700/50 transition-colors ${isMenuOpen ? 'text-gray-200 bg-gray-700/50' : 'text-gray-500'}`}
                        >
                            <MoreVertical size={16} />
                        </button>
                        {isMenuOpen && (
                            <>
                            <div className="fixed inset-0 z-10 cursor-default" onClick={(e) => { e.stopPropagation(); setIsMenuOpen(false); }} />
                            <div className="absolute bottom-full right-0 mb-1 w-32 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-200">
                                {onTogglePin && (
                                    <button onClick={handlePin} className="w-full px-3 py-2.5 text-left text-xs font-medium text-gray-300 hover:bg-gray-800 hover:text-white flex items-center gap-2">
                                        <Pin size={14} className={memory.isPinned ? "fill-current" : ""} /> 
                                        {memory.isPinned ? 'Unpin' : 'Pin'}
                                    </button>
                                )}
                                {onDelete && (
                                    <button onClick={startDelete} className="w-full px-3 py-2.5 text-left text-xs font-medium text-red-400 hover:bg-red-900/10 hover:text-red-300 flex items-center gap-2 border-t border-gray-800">
                                        <Trash2 size={14} /> Delete
                                    </button>
                                )}
                            </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
            {/* Confirmation Dialog */}
            {isConfirming && (
                <div className="absolute inset-0 z-30 bg-gray-900/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-200">
                    <AlertTriangle size={32} className="text-amber-500 mb-3" />
                    <h4 className="text-gray-100 font-bold mb-1">Delete Memory?</h4>
                    <p className="text-xs text-gray-400 mb-4">This action cannot be undone.</p>
                    <div className="flex gap-2 w-full">
                        <button onClick={cancelDelete} className="flex-1 py-2 text-xs font-medium text-gray-300 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
                            Cancel
                        </button>
                        <button onClick={confirmDelete} className="flex-1 py-2 text-xs font-bold text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20">
                            Delete
                        </button>
                    </div>
                </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default MemoryCard;