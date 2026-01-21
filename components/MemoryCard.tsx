import React, { useState, useEffect } from 'react';
import { Trash2, MapPin, Loader2, Clock, ExternalLink, X, Check, Star, ShoppingBag, Tv, BookOpen, RefreshCcw, WifiOff, FileText, Paperclip, ChevronDown, ChevronUp, FileCode, MoreVertical, Search, AlertTriangle, Key } from 'lucide-react';
import { Memory } from '../types.ts';

interface MemoryCardProps {
  memory: Memory;
  onDelete?: (id: string) => void;
  onRetry?: (id: string) => void;
  isDialog?: boolean;
  hasApiKey?: boolean;
  onAddApiKey?: () => void;
}

const MemoryCard: React.FC<MemoryCardProps> = ({ memory, onDelete, onRetry, isDialog, hasApiKey = true, onAddApiKey }) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [dismissedError, setDismissedError] = useState(false);
  
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

  // Calculate Target URI (Maps or Search)
  const locationContext = memory.enrichment?.locationContext;
  let targetUri = locationContext?.mapsUri;
  
  // If no direct Maps URI from AI, but we have a name and coords, construct one.
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

  // Fallback to Search if no Maps URI
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
    : (hasLegacyImage ? [{ data: memory.image!, name: 'Image', type: 'image' }] : []);
  const documents = memory.attachments?.filter(a => a.type === 'file') || [];
  
  const aiText = entity?.description || memory.enrichment?.summary;
  const shouldTruncate = aiText && aiText.length > 120;

  const showErrorOverlay = memory.processingError && onRetry && !dismissedError;

  return (
    <>
      <div 
        className={`group relative w-full mb-6 rounded-xl transition-all duration-300 overflow-hidden
        ${isDialog ? 'bg-gray-900 border border-gray-800' : 'bg-gray-800/40 border border-gray-700/30 hover:bg-gray-800/60 hover:border-gray-600/50 hover:shadow-lg'}
        ${memory.isPending ? 'opacity-70 border-blue-900/30' : ''}
        ${memory.processingError ? 'border-amber-900/30 bg-amber-900/5' : ''}
        ${showErrorOverlay ? 'min-h-[350px]' : ''}
        `}
      >
        {/* Error / Retry Overlay */}
        {showErrorOverlay && (
            <div className="absolute inset-0 z-20 bg-gray-900/95 backdrop-blur-sm flex flex-col items-center justify-center p-4 text-center animate-in fade-in duration-300">
                <div className="mb-4 p-3 bg-white rounded-full border-2 border-red-500 shadow-lg scale-110">
                    {!hasApiKey ? <Key size={24} className="text-red-600" /> : isOffline ? <WifiOff size={24} className="text-red-600" /> : <AlertTriangle size={24} className="text-red-600" />}
                </div>
                <h3 className="text-gray-100 font-bold text-lg mb-2">
                    {!hasApiKey ? "API Key Required" : isOffline ? "Connection Lost" : "Analysis Failed"}
                </h3>
                <p className="text-gray-400 text-sm mb-6 max-w-[240px] leading-relaxed">
                    {!hasApiKey
                        ? "You need a Gemini API Key to analyze and tag your memories."
                        : isOffline 
                            ? "Internet is required to enrich this memory with AI context." 
                            : "The AI could not process this memory. Please try again."}
                </p>
                <div className="flex flex-col gap-3 w-full max-w-[200px]">
                    {!hasApiKey ? (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onAddApiKey?.(); }}
                            className="w-full py-3 px-4 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30 hover:scale-[1.02] active:scale-95 border border-blue-500"
                        >
                            <Key size={16} /> 
                            Add API Key
                        </button>
                    ) : (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onRetry?.(memory.id); }}
                            disabled={isOffline}
                            className={`w-full py-3 px-4 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg
                                ${isOffline 
                                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700' 
                                    : 'bg-red-600 hover:bg-red-500 text-white shadow-red-900/30 hover:scale-[1.02] active:scale-95 border border-red-500'
                                }`}
                        >
                            <RefreshCcw size={16} /> 
                            {isOffline ? "Waiting for Network" : "Retry Analysis"}
                        </button>
                    )}
                    
                    <button 
                        onClick={(e) => { e.stopPropagation(); setDismissedError(true); }}
                        className="text-gray-500 hover:text-gray-300 text-xs font-semibold py-2 hover:underline decoration-gray-500 underline-offset-4 transition-all"
                    >
                        View Raw Note
                    </button>
                </div>
            </div>
        )}

        {/* Loading Overlay */}
        {memory.isDeleting && (
          <div className="absolute inset-0 z-30 bg-gray-900/80 backdrop-blur-[1px] flex items-center justify-center rounded-xl animate-in fade-in">
             <Loader2 className="animate-spin text-red-500" size={20} />
          </div>
        )}

        {/* Delete Confirmation Overlay */}
        {isConfirming && (
           <div className="absolute inset-0 z-40 bg-gray-900/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 rounded-xl animate-in fade-in duration-200 text-center" onClick={(e) => e.stopPropagation()}>
               <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mb-3">
                   <Trash2 size={24} className="text-red-500" />
               </div>
               <h3 className="text-gray-100 font-bold text-lg mb-1">Delete Memory?</h3>
               <p className="text-gray-400 text-sm mb-6">This action cannot be undone.</p>
               <div className="flex gap-3 w-full">
                   <button 
                       onClick={cancelDelete}
                       className="flex-1 py-2 bg-gray-800 text-gray-300 font-bold rounded-xl text-xs hover:bg-gray-700 transition-colors border border-gray-700"
                   >
                       Cancel
                   </button>
                   <button 
                       onClick={confirmDelete}
                       className="flex-1 py-2 bg-red-600 text-white font-bold rounded-xl text-xs hover:bg-red-700 transition-colors shadow-lg shadow-red-900/20"
                   >
                       Delete
                   </button>
               </div>
           </div>
        )}

        {/* Image - Edge to edge on top */}
        {displayImages.length > 0 && (
            <div className="relative overflow-hidden rounded-t-xl bg-gray-900/50 aspect-video sm:aspect-[2/1] group/image">
                <img 
                    src={displayImages[0].data} 
                    alt="User content" 
                    className="w-full h-full object-cover transition-transform duration-700 group-hover/image:scale-105"
                />
                {displayImages.length > 1 && (
                  <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur-md">
                      +{displayImages.length - 1}
                  </div>
                )}
            </div>
        )}
        
        <div className="p-5">
          {/* Header Row: Type Icon & Date (Visual Hierarchy) */}
          <div className="flex items-center justify-between mb-3">
             <div className="flex items-center gap-2">
                 {entity?.type && (
                    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        {getEntityIcon(entity.type)}
                        {entity.type}
                    </span>
                 )}
                 {!entity?.type && <Clock size={12} className="text-gray-600" />}
                 <span className="text-[10px] text-gray-600 font-medium">{dateStr}</span>
             </div>
             
             {/* Status Indicators */}
             {memory.isPending && <span className="flex h-2 w-2 rounded-full bg-blue-500 animate-pulse" title="Processing" />}
             {memory.processingError && <WifiOff size={12} className="text-amber-500" />}
          </div>

          <div className="space-y-3">
            {/* User Content */}
            {memory.content && (
                <p className={`text-gray-200 font-normal leading-relaxed whitespace-pre-wrap ${memory.content.length < 80 ? 'text-base' : 'text-sm'}`}>
                {memory.content}
                </p>
            )}

            {/* Entity Title & Subtitle - Hyperlinked Title */}
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
                        {entity.rating && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/10 text-yellow-500 rounded font-medium">
                                ★ {entity.rating}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* AI Summary / Description */}
            {aiText && (
                <div className="text-sm text-gray-400 font-light leading-relaxed">
                    <span className={(!isExpanded && shouldTruncate) ? 'line-clamp-2' : ''}>
                        {aiText}
                    </span>
                    {shouldTruncate && (
                        <button 
                        onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                        className="text-[10px] font-bold text-gray-500 hover:text-blue-400 uppercase tracking-wide mt-1"
                        >
                        {isExpanded ? 'Show Less' : 'Read More'}
                        </button>
                    )}
                </div>
            )}

            {/* Documents */}
            {documents.length > 0 && (
                <div className="flex flex-col gap-1.5 pt-1">
                    {documents.map((doc, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-gray-900/30 border border-gray-700/30 group/doc">
                            <FileText size={14} className="text-gray-500" />
                            <span className="text-xs text-gray-300 truncate flex-1">{doc.name}</span>
                            <a href={doc.data} download={doc.name} onClick={e => e.stopPropagation()} className="text-gray-500 hover:text-white transition-colors">
                                <Paperclip size={12} />
                            </a>
                        </div>
                    ))}
                </div>
            )}

            {/* Footer Information: Tags Only (Location moved to links) */}
            <div className="flex flex-wrap items-center gap-y-2 gap-x-4 pt-2 border-t border-gray-700/20 mt-2">
                
                {/* Tags - Minimal */}
                <div className="flex flex-wrap gap-1.5 flex-1">
                    {memory.tags.map((tag, idx) => (
                        <span key={idx} className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors">#{tag}</span>
                    ))}
                </div>

                {/* Actions Menu Area */}
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
                                {onDelete && (
                                        <button 
                                        onClick={startDelete} 
                                        className="w-full px-3 py-2.5 text-left text-xs font-medium text-red-400 hover:bg-red-900/10 hover:text-red-300 flex items-center gap-2"
                                    >
                                        <Trash2 size={14} />
                                        Delete
                                        </button>
                                )}
                            </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default MemoryCard;
