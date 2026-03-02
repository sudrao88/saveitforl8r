import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Trash2, Loader2, Clock, ExternalLink, Star, ShoppingBag, Tv, BookOpen, RefreshCcw, WifiOff, FileText, Paperclip, MoreVertical, AlertTriangle, LogIn, Square, CheckSquare, Maximize2, Eye, Pin, Pencil, Lightbulb, CircleCheck, UtensilsCrossed, ListOrdered, ThumbsUp, ThumbsDown, DollarSign, MapPin, CalendarDays, ClipboardList, MessageSquare, Users, Mic, Code, Heart, Scale, GraduationCap, Briefcase, Music, Film, BookOpenCheck, Bookmark, Phone, Mail, ScrollText, Tag, Clock3, Flame, Quote } from 'lucide-react';
import { Memory, Attachment } from '../types.ts';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface EnrichmentSectionProps {
  icon: React.ReactNode;
  label: string;
  items: string[];
  textClass?: string;
  bulletClass?: string;
}

const EnrichmentSection: React.FC<EnrichmentSectionProps> = ({ icon, label, items, textClass = 'text-gray-400', bulletClass = 'text-gray-600' }) => (
  <div className="pt-1 space-y-1.5">
    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
      {icon}
      {label}
    </span>
    <ul className="space-y-1">
      {items.map((item, idx) => (
        <li key={idx} className={`flex items-start gap-2 text-sm ${textClass} font-light leading-relaxed`}>
          <span className={`${bulletClass} mt-1.5 shrink-0`}>&#8226;</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  </div>
);

interface EnrichmentDetailProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  textClass?: string;
}

const EnrichmentDetail: React.FC<EnrichmentDetailProps> = ({ icon, label, value, textClass = 'text-gray-400' }) => (
  <div className="pt-1 space-y-1">
    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
      {icon}
      {label}
    </span>
    <p className={`text-sm ${textClass} font-light leading-relaxed`}>{value}</p>
  </div>
);

interface SectionConfig {
  key: string;
  label: string;
  icon: React.ReactNode;
  type: 'list' | 'detail';
  textClass?: string;
  bulletClass?: string;
}

type EnrichmentFields = Record<string, string | string[] | undefined>;

const getContentTypeSections = (contentType: string | undefined, enrichment: EnrichmentFields): SectionConfig[] => {
  const sections: SectionConfig[] = [];

  const has = (field: string) => {
    const v = enrichment[field];
    if (Array.isArray(v)) return v.length > 0;
    return typeof v === 'string' && v.length > 0;
  };

  switch (contentType) {
    case 'recipe':
      if (has('ingredients')) sections.push({ key: 'ingredients', label: 'Ingredients', icon: <UtensilsCrossed size={12} className="text-orange-400" />, type: 'list', textClass: 'text-orange-300/80', bulletClass: 'text-orange-500/50' });
      if (has('instructions')) sections.push({ key: 'instructions', label: 'Instructions', icon: <ListOrdered size={12} className="text-green-400" />, type: 'list', textClass: 'text-green-300/80', bulletClass: 'text-green-500/50' });
      break;

    case 'article_blog':
      if (has('keyPoints')) sections.push({ key: 'keyPoints', label: 'Key Points', icon: <Lightbulb size={12} className="text-amber-500" />, type: 'list' });
      break;

    case 'product':
      if (has('pros')) sections.push({ key: 'pros', label: 'Pros', icon: <ThumbsUp size={12} className="text-green-400" />, type: 'list', textClass: 'text-green-300/80', bulletClass: 'text-green-500/50' });
      if (has('cons')) sections.push({ key: 'cons', label: 'Cons', icon: <ThumbsDown size={12} className="text-red-400" />, type: 'list', textClass: 'text-red-300/80', bulletClass: 'text-red-500/50' });
      if (has('price')) sections.push({ key: 'price', label: 'Price', icon: <DollarSign size={12} className="text-emerald-400" />, type: 'detail' });
      if (has('whereToBuy')) sections.push({ key: 'whereToBuy', label: 'Where to Buy', icon: <ShoppingBag size={12} className="text-blue-400" />, type: 'detail' });
      break;

    case 'event':
      if (has('date')) sections.push({ key: 'date', label: 'Date', icon: <CalendarDays size={12} className="text-blue-400" />, type: 'detail' });
      if (has('rsvpStatus')) sections.push({ key: 'rsvpStatus', label: 'RSVP Status', icon: <ClipboardList size={12} className="text-purple-400" />, type: 'detail' });
      break;

    case 'place_restaurant':
      if (has('menuHighlights')) sections.push({ key: 'menuHighlights', label: 'Menu Highlights', icon: <UtensilsCrossed size={12} className="text-orange-400" />, type: 'list', textClass: 'text-orange-300/80', bulletClass: 'text-orange-500/50' });
      if (has('ratings')) sections.push({ key: 'ratings', label: 'Ratings', icon: <Star size={12} className="text-yellow-500" />, type: 'detail' });
      break;

    case 'video':
      if (has('keyMoments')) sections.push({ key: 'keyMoments', label: 'Key Moments', icon: <Film size={12} className="text-purple-400" />, type: 'list', textClass: 'text-purple-300/80', bulletClass: 'text-purple-500/50' });
      if (has('transcriptSummary')) sections.push({ key: 'transcriptSummary', label: 'Transcript Summary', icon: <FileText size={12} className="text-gray-400" />, type: 'detail' });
      break;

    case 'social_media_post':
      if (has('author')) sections.push({ key: 'author', label: 'Author', icon: <Users size={12} className="text-blue-400" />, type: 'detail' });
      if (has('engagement')) sections.push({ key: 'engagement', label: 'Engagement', icon: <MessageSquare size={12} className="text-pink-400" />, type: 'detail' });
      if (has('relatedPosts')) sections.push({ key: 'relatedPosts', label: 'Related Posts', icon: <Bookmark size={12} className="text-gray-400" />, type: 'list' });
      break;

    case 'research_academic':
      if (has('methodology')) sections.push({ key: 'methodology', label: 'Methodology', icon: <ClipboardList size={12} className="text-indigo-400" />, type: 'detail' });
      if (has('keyFindings')) sections.push({ key: 'keyFindings', label: 'Key Findings', icon: <Lightbulb size={12} className="text-amber-500" />, type: 'list' });
      if (has('citations')) sections.push({ key: 'citations', label: 'Citations', icon: <BookOpenCheck size={12} className="text-gray-400" />, type: 'list' });
      break;

    case 'job_listing':
      if (has('company')) sections.push({ key: 'company', label: 'Company', icon: <Briefcase size={12} className="text-blue-400" />, type: 'detail' });
      if (has('role')) sections.push({ key: 'role', label: 'Role', icon: <Users size={12} className="text-purple-400" />, type: 'detail' });
      if (has('requirements')) sections.push({ key: 'requirements', label: 'Requirements', icon: <ClipboardList size={12} className="text-amber-400" />, type: 'list' });
      if (has('salary')) sections.push({ key: 'salary', label: 'Salary', icon: <DollarSign size={12} className="text-emerald-400" />, type: 'detail' });
      break;

    case 'travel':
      if (has('itinerary')) sections.push({ key: 'itinerary', label: 'Itinerary', icon: <MapPin size={12} className="text-blue-400" />, type: 'list', textClass: 'text-blue-300/80', bulletClass: 'text-blue-500/50' });
      if (has('costEstimate')) sections.push({ key: 'costEstimate', label: 'Cost Estimate', icon: <DollarSign size={12} className="text-emerald-400" />, type: 'detail' });
      if (has('packingList')) sections.push({ key: 'packingList', label: 'Packing List', icon: <ClipboardList size={12} className="text-orange-400" />, type: 'list' });
      break;

    case 'music':
      if (has('artist')) sections.push({ key: 'artist', label: 'Artist', icon: <Music size={12} className="text-pink-400" />, type: 'detail' });
      if (has('album')) sections.push({ key: 'album', label: 'Album', icon: <Music size={12} className="text-purple-400" />, type: 'detail' });
      if (has('genre')) sections.push({ key: 'genre', label: 'Genre', icon: <Tag size={12} className="text-blue-400" />, type: 'detail' });
      if (has('mood')) sections.push({ key: 'mood', label: 'Mood', icon: <Flame size={12} className="text-orange-400" />, type: 'detail' });
      break;

    case 'book':
      if (has('author')) sections.push({ key: 'author', label: 'Author', icon: <Users size={12} className="text-amber-500" />, type: 'detail' });
      if (has('genre')) sections.push({ key: 'genre', label: 'Genre', icon: <Tag size={12} className="text-blue-400" />, type: 'detail' });
      if (has('themes')) sections.push({ key: 'themes', label: 'Themes', icon: <Lightbulb size={12} className="text-purple-400" />, type: 'list' });
      if (has('ratings')) sections.push({ key: 'ratings', label: 'Rating', icon: <Star size={12} className="text-yellow-500" />, type: 'detail' });
      break;

    case 'movie_tv':
      if (has('cast')) sections.push({ key: 'cast', label: 'Cast', icon: <Users size={12} className="text-purple-400" />, type: 'list' });
      if (has('genre')) sections.push({ key: 'genre', label: 'Genre', icon: <Tag size={12} className="text-blue-400" />, type: 'detail' });
      if (has('ratings')) sections.push({ key: 'ratings', label: 'Rating', icon: <Star size={12} className="text-yellow-500" />, type: 'detail' });
      if (has('whereToWatch')) sections.push({ key: 'whereToWatch', label: 'Where to Watch', icon: <Tv size={12} className="text-green-400" />, type: 'detail' });
      break;

    case 'podcast':
      if (has('host')) sections.push({ key: 'host', label: 'Host', icon: <Mic size={12} className="text-red-400" />, type: 'detail' });
      if (has('keyTopics')) sections.push({ key: 'keyTopics', label: 'Key Topics', icon: <Lightbulb size={12} className="text-amber-500" />, type: 'list' });
      if (has('episodeLength')) sections.push({ key: 'episodeLength', label: 'Episode Length', icon: <Clock3 size={12} className="text-gray-400" />, type: 'detail' });
      break;

    case 'personal_note':
      if (has('actionItems')) sections.push({ key: 'actionItems', label: 'Action Items', icon: <CircleCheck size={12} className="text-blue-400" />, type: 'list', textClass: 'text-blue-300/80', bulletClass: 'text-blue-500/50' });
      if (has('keyPoints')) sections.push({ key: 'keyPoints', label: 'Key Points', icon: <Lightbulb size={12} className="text-amber-500" />, type: 'list' });
      break;

    case 'quote':
      if (has('author')) sections.push({ key: 'author', label: 'Author', icon: <Quote size={12} className="text-amber-500" />, type: 'detail' });
      if (has('source')) sections.push({ key: 'source', label: 'Source', icon: <BookOpen size={12} className="text-blue-400" />, type: 'detail' });
      if (has('context')) sections.push({ key: 'context', label: 'Context', icon: <FileText size={12} className="text-gray-400" />, type: 'detail' });
      break;

    case 'snippet':
      if (has('language')) sections.push({ key: 'language', label: 'Language', icon: <Code size={12} className="text-green-400" />, type: 'detail' });
      if (has('purpose')) sections.push({ key: 'purpose', label: 'Purpose', icon: <FileText size={12} className="text-blue-400" />, type: 'detail' });
      if (has('dependencies')) sections.push({ key: 'dependencies', label: 'Dependencies', icon: <ClipboardList size={12} className="text-orange-400" />, type: 'list' });
      break;

    case 'contact':
      if (has('contactName')) sections.push({ key: 'contactName', label: 'Name', icon: <Users size={12} className="text-blue-400" />, type: 'detail' });
      if (has('phone')) sections.push({ key: 'phone', label: 'Phone', icon: <Phone size={12} className="text-green-400" />, type: 'detail' });
      if (has('email')) sections.push({ key: 'email', label: 'Email', icon: <Mail size={12} className="text-purple-400" />, type: 'detail' });
      if (has('contactNotes')) sections.push({ key: 'contactNotes', label: 'Notes', icon: <FileText size={12} className="text-gray-400" />, type: 'detail' });
      break;

    case 'health':
      if (has('condition')) sections.push({ key: 'condition', label: 'Condition', icon: <Heart size={12} className="text-red-400" />, type: 'detail' });
      if (has('recommendations')) sections.push({ key: 'recommendations', label: 'Recommendations', icon: <ClipboardList size={12} className="text-green-400" />, type: 'list' });
      if (has('followUp')) sections.push({ key: 'followUp', label: 'Follow-up', icon: <CalendarDays size={12} className="text-blue-400" />, type: 'detail' });
      break;

    case 'financial':
      if (has('amount')) sections.push({ key: 'amount', label: 'Amount', icon: <DollarSign size={12} className="text-emerald-400" />, type: 'detail' });
      if (has('category')) sections.push({ key: 'category', label: 'Category', icon: <Tag size={12} className="text-blue-400" />, type: 'detail' });
      if (has('dueDate')) sections.push({ key: 'dueDate', label: 'Due Date', icon: <CalendarDays size={12} className="text-red-400" />, type: 'detail' });
      break;

    case 'legal':
      if (has('documentType')) sections.push({ key: 'documentType', label: 'Document Type', icon: <ScrollText size={12} className="text-amber-500" />, type: 'detail' });
      if (has('keyClauses')) sections.push({ key: 'keyClauses', label: 'Key Clauses', icon: <ClipboardList size={12} className="text-blue-400" />, type: 'list' });
      if (has('deadlines')) sections.push({ key: 'deadlines', label: 'Deadlines', icon: <CalendarDays size={12} className="text-red-400" />, type: 'list' });
      break;

    case 'educational':
      if (has('subject')) sections.push({ key: 'subject', label: 'Subject', icon: <GraduationCap size={12} className="text-blue-400" />, type: 'detail' });
      if (has('keyConcepts')) sections.push({ key: 'keyConcepts', label: 'Key Concepts', icon: <Lightbulb size={12} className="text-amber-500" />, type: 'list' });
      if (has('studyNotes')) sections.push({ key: 'studyNotes', label: 'Study Notes', icon: <BookOpen size={12} className="text-green-400" />, type: 'list' });
      break;

    case 'comparison':
      if (has('pros')) sections.push({ key: 'pros', label: 'Pros', icon: <ThumbsUp size={12} className="text-green-400" />, type: 'list', textClass: 'text-green-300/80', bulletClass: 'text-green-500/50' });
      if (has('cons')) sections.push({ key: 'cons', label: 'Cons', icon: <ThumbsDown size={12} className="text-red-400" />, type: 'list', textClass: 'text-red-300/80', bulletClass: 'text-red-500/50' });
      break;

    default:
      // Fallback for general, meeting_notes, journal, recommendation, idea, task_list, observation, reference, review, wishlist, project, learning
      if (has('keyPoints')) sections.push({ key: 'keyPoints', label: 'Key Points', icon: <Lightbulb size={12} className="text-amber-500" />, type: 'list' });
      if (has('actionItems')) sections.push({ key: 'actionItems', label: 'Action Items', icon: <CircleCheck size={12} className="text-blue-400" />, type: 'list', textClass: 'text-blue-300/80', bulletClass: 'text-blue-500/50' });
      break;
  }

  return sections;
};

interface MemoryCardProps {
  memory: Memory;
  onDelete?: (id: string) => void;
  onRetry?: (id: string) => void;
  onUpdate?: (id: string, content: string) => void;
  onExpand?: (memory: Memory) => void;
  onViewAttachment?: (attachment: Attachment, allAttachments: Attachment[]) => void;
  onTogglePin?: (id: string, isPinned: boolean) => void;
  onEdit?: (memory: Memory) => void;
  isDialog?: boolean;
  isAuthenticated?: boolean;
  onSignIn?: () => void;
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

const MemoryCard: React.FC<MemoryCardProps> = ({ memory, onDelete, onRetry, onUpdate, onExpand, onViewAttachment, onTogglePin, onEdit, isDialog, isAuthenticated = true, onSignIn }) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const [isTruncated, setIsTruncated] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Shared online/offline state — single global listener instead of per-card
  const isOnline = useOnlineStatus();
  const isOffline = !isOnline;

  useEffect(() => {
    if (!isDialog && contentRef.current) {
      const hasOverflow = contentRef.current.scrollHeight > 300;
      setIsTruncated(hasOverflow);
    }
  }, [memory.content, isDialog]);

  const dateStr = new Date(memory.timestamp).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric'
  });

  const enrichment = memory.enrichment;
  const locationContext = enrichment?.locationContext;
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

  const entity = enrichment?.entityContext;

  if (!targetUri) {
      const query = entity?.title || enrichment?.summary;
      if (query && typeof query === 'string' && !query.includes('{')) {
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

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(memory);
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
  
  // Robust AI text extraction
  let aiText = entity?.description || enrichment?.summary;
  if (typeof aiText === 'string' && aiText.startsWith('{')) {
      // Sometimes AI returns stringified JSON as summary
      try {
          const parsed = JSON.parse(aiText);
          aiText = parsed.description || parsed.summary || aiText;
      } catch {
          // Keep as is if not valid JSON
      }
  }
  
  const shouldTruncateAI = typeof aiText === 'string' && aiText.length > 120;

  const showSignInOverlay = !isAuthenticated && (memory.isPending || !!memory.processingError);
  const showErrorOverlay = memory.processingError && onRetry && !showSignInOverlay;

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
                            className="flex items-start gap-3 group/item cursor-pointer p-2 -mx-2 hover:bg-white/5 rounded-lg active:bg-white/10 transition-colors"
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
        ${showErrorOverlay || showSignInOverlay ? 'min-h-[350px]' : ''}
        `}
      >
        {/* Sign In Overlay — shown when enrichment failed due to missing auth */}
        {showSignInOverlay && (
            <div className="absolute inset-0 z-20 bg-gray-900/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
                <div className="w-12 h-12 bg-blue-900/50 border-4 border-blue-800 rounded-full mb-4 flex items-center justify-center">
                    <LogIn size={24} className="text-blue-300" />
                </div>
                <h4 className="text-gray-100 font-bold mb-1">Sign in for AI Enrichment</h4>
                <p className="text-xs text-gray-400 mb-4">
                    Sign in with your Google account to enable automatic summaries, tagging, and smart search for your memories.
                </p>
                <button
                    onClick={(e) => { e.stopPropagation(); onSignIn?.(); }}
                    className="w-full max-w-[220px] py-3 text-sm font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-500 transition-colors shadow-lg shadow-blue-500/20 active:scale-95 touch-manipulation flex items-center justify-center gap-2"
                >
                    <LogIn size={16} />
                    Sign in with Google
                </button>
            </div>
        )}

        {/* Image Preview */}
        {displayImages.length > 0 && (
            <div 
                className={`relative overflow-hidden rounded-t-xl bg-gray-900/50 group/image cursor-zoom-in ${isDialog ? 'max-h-[50vh]' : 'aspect-video sm:aspect-[2/1]'}`}
                onClick={(e) => { e.stopPropagation(); onViewAttachment?.(displayImages[0], [...displayImages, ...documents]); }}
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

          {/* AI Title — below entity type, above user content */}
          {entity?.title && (
              <div className="mb-1">
                  <h3 className="text-lg font-semibold text-gray-100 leading-tight">{entity.title}</h3>
                  <div className="flex items-center gap-2 mt-1">
                      {entity.subtitle && <span className="text-xs text-gray-400">{entity.subtitle}</span>}
                      {entity.rating && <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/10 text-yellow-500 rounded font-medium">★ {entity.rating}</span>}
                  </div>
              </div>
          )}

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
                                className="flex items-center gap-2 px-4 py-2 bg-gray-800/90 backdrop-blur-md border border-gray-700 rounded-full text-xs font-bold text-blue-400 hover:text-blue-300 hover:bg-gray-700 transition-all shadow-lg active:scale-95"
                            >
                                <Maximize2 size={12} /> READ FULL MEMORY
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Enrichment Icon Row + Expandable Sections */}
            {(() => {
                const typeSections = enrichment ? getContentTypeSections(enrichment.contentType, enrichment as unknown as EnrichmentFields) : [];
                const hasAnyCTA = aiText || typeSections.length > 0 || targetUri;
                if (!hasAnyCTA) return null;

                return (
                    <div className="space-y-2 mt-auto">
                        <div className="flex items-center gap-1 flex-wrap">
                            {aiText && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowSummary(!showSummary); }}
                                    title="Summary"
                                    className={`p-2 rounded-lg transition-colors ${showSummary ? 'bg-gray-700/60 text-gray-200' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
                                >
                                    <FileText size={16} />
                                </button>
                            )}
                            {typeSections.map((section) => (
                                <button
                                    key={section.key}
                                    onClick={(e) => { e.stopPropagation(); setExpandedSection(expandedSection === section.key ? null : section.key); }}
                                    title={section.label}
                                    className={`p-2 rounded-lg transition-colors ${expandedSection === section.key ? 'bg-gray-700/60 text-gray-200' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
                                >
                                    {/* Icons in sections are size 12; scale up for button display */}
                                    <span className="[&>svg]:w-4 [&>svg]:h-4">{section.icon}</span>
                                </button>
                            ))}
                            {targetUri && (
                                <a
                                    href={targetUri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    title="Open Link"
                                    className="p-2 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-white/5 transition-colors"
                                >
                                    <ExternalLink size={16} />
                                </a>
                            )}
                        </div>

                        {/* Expandable Summary */}
                        {showSummary && aiText && (
                            <div className="text-sm text-gray-400 font-light leading-relaxed pl-1 animate-in fade-in slide-in-from-top-1 duration-200">
                                {String(aiText)}
                            </div>
                        )}

                        {/* Expandable Type-Specific Sections */}
                        {typeSections.map((section) => {
                            if (expandedSection !== section.key) return null;
                            const value = (enrichment as unknown as EnrichmentFields)?.[section.key];
                            if (!value) return null;

                            return (
                                <div key={section.key} className="animate-in fade-in slide-in-from-top-1 duration-200">
                                    {section.type === 'list' && Array.isArray(value) ? (
                                        <EnrichmentSection
                                            icon={section.icon}
                                            label={section.label}
                                            items={value as string[]}
                                            textClass={section.textClass}
                                            bulletClass={section.bulletClass}
                                        />
                                    ) : (
                                        <EnrichmentDetail
                                            icon={section.icon}
                                            label={section.label}
                                            value={String(value)}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                );
            })()}

            {/* Documents */}
            {documents.length > 0 && (
                <div className="flex flex-col gap-1.5 pt-1">
                    {documents.map((doc, idx) => (
                        <div 
                            key={idx} 
                            onClick={(e) => { e.stopPropagation(); onViewAttachment?.(doc, [...displayImages, ...documents]); }}
                            className="flex items-center gap-2 p-3 rounded-xl bg-gray-900/30 border border-gray-700/30 hover:bg-gray-700/50 transition-colors cursor-pointer group/doc active:scale-[0.98]"
                        >
                            <FileText size={16} className="text-gray-500 group-hover/doc:text-blue-400" />
                            <span className="text-sm text-gray-300 truncate flex-1 group-hover/doc:text-white">{doc.name}</span>
                            <div className="flex items-center gap-2">
                                <Eye size={16} className="text-gray-500 opacity-0 group-hover/doc:opacity-100" />
                                <a 
                                    href={doc.data} 
                                    download={doc.name} 
                                    onClick={e => e.stopPropagation()} 
                                    className="p-2 -m-2 text-gray-500 hover:text-white transition-colors"
                                >
                                    <Paperclip size={16} />
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
                        <span key={idx} className="text-[10px] text-gray-500 hover:text-gray-300 bg-gray-900/50 px-2 py-1 rounded-md">#{tag}</span>
                    ))}
                </div>
                <div className="flex items-center gap-2 ml-auto relative">
                    {onRetry && memory.processingError && (
                        <button onClick={() => onRetry(memory.id)} className="p-2 text-amber-500 hover:text-amber-400 transition-colors rounded-lg hover:bg-amber-900/20">
                            <RefreshCcw size={16} />
                        </button>
                    )}
                    <div className="relative">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setIsMenuOpen(!isMenuOpen); }} 
                            className={`p-2 rounded-lg hover:bg-gray-700/50 transition-colors ${isMenuOpen ? 'text-gray-200 bg-gray-700/50' : 'text-gray-500'}`}
                        >
                            <MoreVertical size={20} />
                        </button>
                        {isMenuOpen && (
                            <>
                            <div
                                className="fixed inset-0 z-[55] cursor-default touch-manipulation"
                                onClick={(e) => { e.stopPropagation(); setIsMenuOpen(false); }}
                            />
                            <div className="absolute bottom-full right-0 mb-1 w-40 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-[56] overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-200">
                                {onTogglePin && (
                                    <button onClick={handlePin} className="w-full px-4 py-3 text-left text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white flex items-center gap-3 active:bg-gray-700">
                                        <Pin size={16} className={memory.isPinned ? "fill-current" : ""} />
                                        {memory.isPinned ? 'Unpin' : 'Pin'}
                                    </button>
                                )}
                                {onEdit && (
                                    <button onClick={handleEdit} className="w-full px-4 py-3 text-left text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white flex items-center gap-3 border-t border-gray-800 active:bg-gray-700">
                                        <Pencil size={16} /> Edit
                                    </button>
                                )}
                                {onDelete && (
                                    <button onClick={startDelete} className="w-full px-4 py-3 text-left text-sm font-medium text-red-400 hover:bg-red-900/10 hover:text-red-300 flex items-center gap-3 border-t border-gray-800 active:bg-red-900/20">
                                        <Trash2 size={16} /> Delete
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
                        <button onClick={cancelDelete} className="flex-1 py-3 text-sm font-medium text-gray-300 bg-gray-800 rounded-xl hover:bg-gray-700 transition-colors active:scale-95">
                            Cancel
                        </button>
                        <button onClick={confirmDelete} className="flex-1 py-3 text-sm font-bold text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20 active:scale-95">
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

export default memo(MemoryCard);