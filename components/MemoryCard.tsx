import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { Trash2, Loader2, Clock, ExternalLink, Star, ShoppingBag, Tv, BookOpen, RefreshCcw, WifiOff, CloudOff, FileText, Paperclip, MoreVertical, AlertTriangle, AlertCircle, LogIn, Maximize2, Eye, Pin, Pencil, Lightbulb, CircleCheck, UtensilsCrossed, ListOrdered, ThumbsUp, ThumbsDown, DollarSign, MapPin, CalendarDays, ClipboardList, MessageSquare, Users, Mic, Code, Heart, Scale, GraduationCap, Briefcase, Music, Film, BookOpenCheck, Bookmark, Phone, Mail, ScrollText, Tag, Clock3, Flame, Quote, Hourglass, Sparkles, Calculator, CheckSquare, Square, Waypoints } from 'lucide-react';
import { Memory, Attachment, UploadProgress, CalendarEvent, TodoItem, isMemoryInFlight, isMemoryFailed } from '../types.ts';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import type { RelatedMemoryDisplayItem } from '../hooks/useRelatedMemories';
import { btn, card, confirm, menu, overlay, text } from '../styles/design-system';
import { downloadDataUri } from '../services/downloadService';
import { ChecklistDisplay, parseChecklistFromHtml, serializeChecklistToHtml, cascadeToggle } from './ChecklistItems';
import RecipeCalculatorDialog from './RecipeCalculatorDialog';

interface EnrichmentSectionProps {
  icon: React.ReactNode;
  label: string;
  items: string[];
  textClass?: string;
  bulletClass?: string;
}

const EnrichmentSection: React.FC<EnrichmentSectionProps> = ({ icon, label, items, textClass = 'text-(--color-text-secondary)', bulletClass = 'text-(--color-text-tertiary)' }) => (
  <div className="pt-1 space-y-1.5">
    <span className={`flex items-center gap-1.5 ${text.label}`}>
      {icon}
      {label}
    </span>
    <ul className="space-y-1">
      {items.map((item, idx) => (
        <li key={`${label}-${idx}-${item.slice(0, 30)}`} className={`flex items-start gap-2 text-sm ${textClass} font-light leading-relaxed`}>
          <span className={`${bulletClass} mt-1.5 shrink-0`}>&#8226;</span>
          <span className="break-all">{item}</span>
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

const EnrichmentDetail: React.FC<EnrichmentDetailProps> = ({ icon, label, value, textClass = 'text-(--color-text-secondary)' }) => (
  <div className="pt-1 space-y-1">
    <span className={`flex items-center gap-1.5 ${text.label}`}>
      {icon}
      {label}
    </span>
    <p className={`text-sm ${textClass} font-light leading-relaxed break-all`}>{value}</p>
  </div>
);

interface SectionDef {
  key: string;
  label: string;
  icon: React.ReactNode;
  type: 'list' | 'detail';
  textClass?: string;
  bulletClass?: string;
}

type EnrichmentFields = Record<string, string | string[] | undefined>;

// Data-driven config map: contentType → section definitions
// Enrichment/content-type colors are exempt from design system token rules (CLAUDE.md)
/* eslint-disable design-system/no-raw-tailwind-colors */
const SECTION_CONFIG_MAP: Record<string, SectionDef[]> = {
  recipe: [
    { key: 'ingredients', label: 'Ingredients', icon: <UtensilsCrossed size={12} className="text-orange-400 light:text-orange-600" />, type: 'list', textClass: 'text-orange-300/80 light:text-orange-700', bulletClass: 'text-orange-500/50 light:text-orange-600' },
    { key: 'instructions', label: 'Instructions', icon: <ListOrdered size={12} className="text-green-400 light:text-green-600" />, type: 'list', textClass: 'text-green-300/80 light:text-green-700', bulletClass: 'text-green-500/50 light:text-green-600' },
  ],
  article_blog: [
    { key: 'keyPoints', label: 'Key Points', icon: <Lightbulb size={12} className="text-amber-500 light:text-amber-600" />, type: 'list' },
  ],
  product: [
    { key: 'pros', label: 'Pros', icon: <ThumbsUp size={12} className="text-green-400 light:text-green-600" />, type: 'list', textClass: 'text-green-300/80 light:text-green-700', bulletClass: 'text-green-500/50 light:text-green-600' },
    { key: 'cons', label: 'Cons', icon: <ThumbsDown size={12} className="text-red-400 light:text-red-600" />, type: 'list', textClass: 'text-red-300/80 light:text-red-700', bulletClass: 'text-red-500/50 light:text-red-600' },
    { key: 'price', label: 'Price', icon: <DollarSign size={12} className="text-emerald-400 light:text-emerald-600" />, type: 'detail' },
    { key: 'whereToBuy', label: 'Where to Buy', icon: <ShoppingBag size={12} className="text-blue-400 light:text-blue-600" />, type: 'detail' },
  ],
  event: [
    { key: 'date', label: 'Date', icon: <CalendarDays size={12} className="text-blue-400 light:text-blue-600" />, type: 'detail' },
    { key: 'rsvpStatus', label: 'RSVP Status', icon: <ClipboardList size={12} className="text-purple-400 light:text-purple-600" />, type: 'detail' },
  ],
  place_restaurant: [
    { key: 'menuHighlights', label: 'Menu Highlights', icon: <UtensilsCrossed size={12} className="text-orange-400 light:text-orange-600" />, type: 'list', textClass: 'text-orange-300/80 light:text-orange-700', bulletClass: 'text-orange-500/50 light:text-orange-600' },
    { key: 'ratings', label: 'Ratings', icon: <Star size={12} className="text-yellow-500 light:text-yellow-600" />, type: 'detail' },
  ],
  video: [
    { key: 'keyMoments', label: 'Key Moments', icon: <Film size={12} className="text-purple-400 light:text-purple-600" />, type: 'list', textClass: 'text-purple-300/80 light:text-purple-700', bulletClass: 'text-purple-500/50 light:text-purple-600' },
    { key: 'transcriptSummary', label: 'Transcript Summary', icon: <FileText size={12} className="text-gray-400 light:text-gray-600" />, type: 'detail' },
  ],
  social_media_post: [
    { key: 'author', label: 'Author', icon: <Users size={12} className="text-blue-400 light:text-blue-600" />, type: 'detail' },
    { key: 'engagement', label: 'Engagement', icon: <MessageSquare size={12} className="text-pink-400 light:text-pink-600" />, type: 'detail' },
    { key: 'relatedPosts', label: 'Related Posts', icon: <Bookmark size={12} className="text-gray-400 light:text-gray-600" />, type: 'list' },
  ],
  research_academic: [
    { key: 'methodology', label: 'Methodology', icon: <ClipboardList size={12} className="text-indigo-400 light:text-indigo-600" />, type: 'detail' },
    { key: 'keyFindings', label: 'Key Findings', icon: <Lightbulb size={12} className="text-amber-500 light:text-amber-600" />, type: 'list' },
    { key: 'citations', label: 'Citations', icon: <BookOpenCheck size={12} className="text-gray-400 light:text-gray-600" />, type: 'list' },
  ],
  job_listing: [
    { key: 'company', label: 'Company', icon: <Briefcase size={12} className="text-blue-400 light:text-blue-600" />, type: 'detail' },
    { key: 'role', label: 'Role', icon: <Users size={12} className="text-purple-400 light:text-purple-600" />, type: 'detail' },
    { key: 'requirements', label: 'Requirements', icon: <ClipboardList size={12} className="text-amber-400 light:text-amber-600" />, type: 'list' },
    { key: 'salary', label: 'Salary', icon: <DollarSign size={12} className="text-emerald-400 light:text-emerald-600" />, type: 'detail' },
  ],
  travel: [
    { key: 'itinerary', label: 'Itinerary', icon: <MapPin size={12} className="text-blue-400 light:text-blue-600" />, type: 'list', textClass: 'text-blue-300/80 light:text-blue-700', bulletClass: 'text-blue-500/50 light:text-blue-600' },
    { key: 'costEstimate', label: 'Cost Estimate', icon: <DollarSign size={12} className="text-emerald-400 light:text-emerald-600" />, type: 'detail' },
    { key: 'packingList', label: 'Packing List', icon: <ClipboardList size={12} className="text-orange-400 light:text-orange-600" />, type: 'list' },
  ],
  music: [
    { key: 'artist', label: 'Artist', icon: <Music size={12} className="text-pink-400 light:text-pink-600" />, type: 'detail' },
    { key: 'album', label: 'Album', icon: <Music size={12} className="text-purple-400 light:text-purple-600" />, type: 'detail' },
    { key: 'genre', label: 'Genre', icon: <Tag size={12} className="text-blue-400 light:text-blue-600" />, type: 'detail' },
    { key: 'mood', label: 'Mood', icon: <Flame size={12} className="text-orange-400 light:text-orange-600" />, type: 'detail' },
  ],
  book: [
    { key: 'author', label: 'Author', icon: <Users size={12} className="text-amber-500 light:text-amber-600" />, type: 'detail' },
    { key: 'genre', label: 'Genre', icon: <Tag size={12} className="text-blue-400 light:text-blue-600" />, type: 'detail' },
    { key: 'themes', label: 'Themes', icon: <Lightbulb size={12} className="text-purple-400 light:text-purple-600" />, type: 'list' },
    { key: 'ratings', label: 'Rating', icon: <Star size={12} className="text-yellow-500 light:text-yellow-600" />, type: 'detail' },
  ],
  movie_tv: [
    { key: 'cast', label: 'Cast', icon: <Users size={12} className="text-purple-400 light:text-purple-600" />, type: 'list' },
    { key: 'genre', label: 'Genre', icon: <Tag size={12} className="text-blue-400 light:text-blue-600" />, type: 'detail' },
    { key: 'ratings', label: 'Rating', icon: <Star size={12} className="text-yellow-500 light:text-yellow-600" />, type: 'detail' },
    { key: 'whereToWatch', label: 'Where to Watch', icon: <Tv size={12} className="text-green-400 light:text-green-600" />, type: 'detail' },
  ],
  podcast: [
    { key: 'host', label: 'Host', icon: <Mic size={12} className="text-red-400 light:text-red-600" />, type: 'detail' },
    { key: 'keyTopics', label: 'Key Topics', icon: <Lightbulb size={12} className="text-amber-500 light:text-amber-600" />, type: 'list' },
    { key: 'episodeLength', label: 'Episode Length', icon: <Clock3 size={12} className="text-gray-400 light:text-gray-600" />, type: 'detail' },
  ],
  personal_note: [
    { key: 'actionItems', label: 'Action Items', icon: <CircleCheck size={12} className="text-blue-400 light:text-blue-600" />, type: 'list', textClass: 'text-blue-300/80 light:text-blue-700', bulletClass: 'text-blue-500/50 light:text-blue-600' },
    { key: 'keyPoints', label: 'Key Points', icon: <Lightbulb size={12} className="text-amber-500 light:text-amber-600" />, type: 'list' },
  ],
  quote: [
    { key: 'author', label: 'Author', icon: <Quote size={12} className="text-amber-500 light:text-amber-600" />, type: 'detail' },
    { key: 'source', label: 'Source', icon: <BookOpen size={12} className="text-blue-400 light:text-blue-600" />, type: 'detail' },
    { key: 'context', label: 'Context', icon: <FileText size={12} className="text-gray-400 light:text-gray-600" />, type: 'detail' },
  ],
  snippet: [
    { key: 'language', label: 'Language', icon: <Code size={12} className="text-green-400 light:text-green-600" />, type: 'detail' },
    { key: 'purpose', label: 'Purpose', icon: <FileText size={12} className="text-blue-400 light:text-blue-600" />, type: 'detail' },
    { key: 'dependencies', label: 'Dependencies', icon: <ClipboardList size={12} className="text-orange-400 light:text-orange-600" />, type: 'list' },
  ],
  contact: [
    { key: 'contactName', label: 'Name', icon: <Users size={12} className="text-blue-400 light:text-blue-600" />, type: 'detail' },
    { key: 'phone', label: 'Phone', icon: <Phone size={12} className="text-green-400 light:text-green-600" />, type: 'detail' },
    { key: 'email', label: 'Email', icon: <Mail size={12} className="text-purple-400 light:text-purple-600" />, type: 'detail' },
    { key: 'contactNotes', label: 'Notes', icon: <FileText size={12} className="text-gray-400 light:text-gray-600" />, type: 'detail' },
  ],
  health: [
    { key: 'condition', label: 'Condition', icon: <Heart size={12} className="text-red-400 light:text-red-600" />, type: 'detail' },
    { key: 'recommendations', label: 'Recommendations', icon: <ClipboardList size={12} className="text-green-400 light:text-green-600" />, type: 'list' },
    { key: 'followUp', label: 'Follow-up', icon: <CalendarDays size={12} className="text-blue-400 light:text-blue-600" />, type: 'detail' },
  ],
  financial: [
    { key: 'amount', label: 'Amount', icon: <DollarSign size={12} className="text-emerald-400 light:text-emerald-600" />, type: 'detail' },
    { key: 'category', label: 'Category', icon: <Tag size={12} className="text-blue-400 light:text-blue-600" />, type: 'detail' },
    { key: 'dueDate', label: 'Due Date', icon: <CalendarDays size={12} className="text-red-400 light:text-red-600" />, type: 'detail' },
  ],
  legal: [
    { key: 'documentType', label: 'Document Type', icon: <ScrollText size={12} className="text-amber-500 light:text-amber-600" />, type: 'detail' },
    { key: 'keyClauses', label: 'Key Clauses', icon: <ClipboardList size={12} className="text-blue-400 light:text-blue-600" />, type: 'list' },
    { key: 'deadlines', label: 'Deadlines', icon: <CalendarDays size={12} className="text-red-400 light:text-red-600" />, type: 'list' },
  ],
  educational: [
    { key: 'subject', label: 'Subject', icon: <GraduationCap size={12} className="text-blue-400 light:text-blue-600" />, type: 'detail' },
    { key: 'keyConcepts', label: 'Key Concepts', icon: <Lightbulb size={12} className="text-amber-500 light:text-amber-600" />, type: 'list' },
    { key: 'studyNotes', label: 'Study Notes', icon: <BookOpen size={12} className="text-green-400 light:text-green-600" />, type: 'list' },
  ],
  comparison: [
    { key: 'pros', label: 'Pros', icon: <ThumbsUp size={12} className="text-green-400 light:text-green-600" />, type: 'list', textClass: 'text-green-300/80 light:text-green-700', bulletClass: 'text-green-500/50 light:text-green-600' },
    { key: 'cons', label: 'Cons', icon: <ThumbsDown size={12} className="text-red-400 light:text-red-600" />, type: 'list', textClass: 'text-red-300/80 light:text-red-700', bulletClass: 'text-red-500/50 light:text-red-600' },
  ],
};
/* eslint-enable design-system/no-raw-tailwind-colors */

// Default sections for content types without a specific config
/* eslint-disable design-system/no-raw-tailwind-colors */
const DEFAULT_SECTIONS: SectionDef[] = [
  { key: 'keyPoints', label: 'Key Points', icon: <Lightbulb size={12} className="text-amber-500 light:text-amber-600" />, type: 'list' },
  { key: 'actionItems', label: 'Action Items', icon: <CircleCheck size={12} className="text-blue-400 light:text-blue-600" />, type: 'list', textClass: 'text-blue-300/80 light:text-blue-700', bulletClass: 'text-blue-500/50 light:text-blue-600' },
];
/* eslint-enable design-system/no-raw-tailwind-colors */

const getContentTypeSections = (contentType: string | undefined, enrichment: EnrichmentFields): SectionDef[] => {
  const defs = (contentType && SECTION_CONFIG_MAP[contentType]) || DEFAULT_SECTIONS;
  return defs.filter((def) => {
    const v = enrichment[def.key];
    if (Array.isArray(v)) return v.length > 0;
    return typeof v === 'string' && v.length > 0;
  });
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
  syncStatus?: 'syncing' | 'synced' | 'error';
  onSyncRetry?: (id: string) => void;
  uploadProgress?: UploadProgress;
  /** Index in the feed grid for staggered entrance animation */
  index?: number;
  /** Calendar events created from this note (for "In Calendar" links) */
  calendarEvents?: CalendarEvent[];
  /** To-do items created from this note (for "In To-Do List" links) */
  todoItems?: TodoItem[];
  /** Opens the calendar agenda scrolled to the given event */
  onOpenCalendarEvent?: (eventId: string) => void;
  /** Opens the to-do list scrolled to the given item */
  onOpenTodoItem?: (itemId: string) => void;
  /** Similar notes (from embedding similarity) for the "Related" section */
  relatedMemories?: RelatedMemoryDisplayItem[];
  /** Opens the given related memory in a preview */
  onOpenRelatedMemory?: (memoryId: string) => void;
}

// Recurring events expand into many occurrences sharing a recurringGroupId —
// collapse each series to a single link (next upcoming occurrence, else the last).
const pickEventRepresentatives = (events: CalendarEvent[]): CalendarEvent[] => {
  // Event startDates are local ISO strings, so compare against the local date
  // (toISOString would give the UTC date, off by one near midnight)
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const singles: CalendarEvent[] = [];
  const series = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    if (event.recurringGroupId) {
      const group = series.get(event.recurringGroupId);
      if (group) group.push(event);
      else series.set(event.recurringGroupId, [event]);
    } else {
      singles.push(event);
    }
  }
  const representatives = [...series.values()].map(occurrences => {
    const sorted = [...occurrences].sort((a, b) => a.startDate.localeCompare(b.startDate));
    return sorted.find(o => o.startDate.split('T')[0] >= today) ?? sorted[sorted.length - 1];
  });
  return [...singles, ...representatives].sort((a, b) => a.startDate.localeCompare(b.startDate));
};

// Enrichment sections rendered with a calendar glyph (per SECTION_CONFIG_MAP):
// event.date, health.followUp, financial.dueDate, legal.deadlines. The linked
// calendar events fold into these sections instead of adding a second icon.
const DATE_LIKE_SECTION_KEYS = new Set(['date', 'followUp', 'dueDate', 'deadlines']);

const formatLinkDate = (iso: string): string => {
  // Date-only strings parse as UTC midnight; anchor to local midnight instead
  const date = new Date(iso.includes('T') ? iso : iso + 'T00:00:00');
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};


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
            '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-(--color-accent) underline break-all">$1</a>'
        );
    }).join('');
};

const MemoryCard: React.FC<MemoryCardProps> = ({ memory, onDelete, onRetry, onUpdate, onExpand, onViewAttachment, onTogglePin, onEdit, isDialog, isAuthenticated = true, onSignIn, syncStatus, onSyncRetry, uploadProgress, index, calendarEvents, todoItems, onOpenCalendarEvent, onOpenTodoItem, relatedMemories, onOpenRelatedMemory }) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);

  const [isTruncated, setIsTruncated] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const shakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAnimatedRef = useRef(false);
  const [shouldAnimate, setShouldAnimate] = useState(() => !isDialog);

  useEffect(() => {
    if (!isDialog && !hasAnimatedRef.current) {
      hasAnimatedRef.current = true;
      const delay = (index ?? 0) * 60;
      const timer = setTimeout(() => {
        setShouldAnimate(false);
      }, delay + 250); // delay + animation duration
      return () => clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
    };
  }, []);

  // Shared online/offline state — single global listener instead of per-card
  const isOnline = useOnlineStatus();
  const isOffline = !isOnline;

  useEffect(() => {
    if (!isDialog && contentRef.current) {
      const hasOverflow = contentRef.current.scrollHeight > 300;
      setIsTruncated(hasOverflow);
    }
  }, [memory.content, isDialog]);

  const dateObj = new Date(memory.timestamp);
  const dateStr = isNaN(dateObj.getTime())
    ? 'Unknown date'
    : dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

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

  // If user provided a URL, use it as the link CTA
  if (!targetUri && enrichment?.sourceUrl) {
      targetUri = enrichment.sourceUrl;
  }

  // Only show a Google search link when Gemini actually performed a search
  if (!targetUri && enrichment?.enrichmentStrategy === 'search') {
      const query = entity?.title || enrichment?.summary;
      if (query && typeof query === 'string' && !query.includes('{')) {
           targetUri = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      }
  }

  const startDelete = (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsShaking(true);
      setIsMenuOpen(false);
      if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
      shakeTimeoutRef.current = setTimeout(() => {
        shakeTimeoutRef.current = null;
        setIsShaking(false);
        setIsConfirming(true);
      }, 400);
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

  /* eslint-disable design-system/no-raw-tailwind-colors -- enrichment entity icons */
  const getEntityIcon = (type?: string) => {
    const t = type?.toLowerCase() || '';
    if (t.includes('movie') || t.includes('tv') || t.includes('show')) return <Tv size={14} className="text-purple-400 light:text-purple-600" />;
    if (t.includes('book')) return <BookOpen size={14} className="text-amber-500 light:text-amber-600" />;
    if (t.includes('product')) return <ShoppingBag size={14} className="text-green-500 light:text-green-600" />;
    return <Star size={14} className="text-yellow-500 light:text-yellow-600" />;
  };
  /* eslint-enable design-system/no-raw-tailwind-colors */

  const userAttachments = memory.attachments?.filter(a => a.type === 'image') || [];
  const hasLegacyImage = !memory.attachments && memory.image;
  
  const displayImages = userAttachments.length > 0 
    ? userAttachments 
    : (hasLegacyImage ? [{ id: 'legacy', data: memory.image!, name: 'Image', type: 'image', mimeType: 'image/jpeg' } as Attachment] : []);
  
  const documents = memory.attachments?.filter(a => a.type === 'file') || [];

  // Calendar events and to-do items created from this note. Without the
  // open handler the links would render as dead buttons, so treat the
  // lists as empty and skip the icons/sections entirely.
  const linkedEvents = useMemo(
    () => (onOpenCalendarEvent && calendarEvents && calendarEvents.length > 0 ? pickEventRepresentatives(calendarEvents) : []),
    [calendarEvents, onOpenCalendarEvent]
  );
  const linkedTodos = useMemo(
    () => (onOpenTodoItem ? (todoItems ?? []).filter(item => !item.isDismissed) : []),
    [todoItems, onOpenTodoItem]
  );

  // Similar notes — same dead-button rule as events/todos: without the open
  // handler the rows would do nothing, so hide the section entirely.
  const relatedItems = onOpenRelatedMemory ? (relatedMemories ?? []) : [];


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

  const isInFlight = isMemoryInFlight(memory);
  const isFailed = isMemoryFailed(memory);
  const isSubmitFailed = memory.enrichmentStatus === 'failed_submit';
  const showSignInOverlay = !isAuthenticated && (isInFlight || isFailed);
  const showErrorOverlay = isFailed && onRetry && !showSignInOverlay;

  const isChecklist = memory.content?.startsWith('<ul class="checklist">') ?? false;
  
  const handleToggleCheck = (id: string) => {
      if (!onUpdate) return;
      const items = parseChecklistFromHtml(memory.content, memory.id);
      const updated = cascadeToggle(items, id);
      onUpdate(memory.id, serializeChecklistToHtml(updated));
  };

  const renderContent = () => {
      if (isChecklist) {
          const items = parseChecklistFromHtml(memory.content, memory.id);
          return <ChecklistDisplay items={items} onToggle={handleToggleCheck} />;
      }
      
      return (
          <div
            className="rich-editor max-w-none text-(--color-text-primary) font-normal leading-relaxed break-words text-sm"
            dangerouslySetInnerHTML={{ __html: linkifyHtml(memory.content) }}
          />
      );
  };

  return (
    <>
      <div
        className={`group relative w-full rounded-(--radius-xl) transition-all duration-(--duration-normal) ${isDialog ? 'overflow-visible' : 'overflow-hidden'} flex flex-col
        ${isDialog ? 'bg-(--color-surface-overlay) border border-(--color-border-default)' : card.interactive}
        ${isInFlight ? 'opacity-70 border-(--color-accent)/30' : ''}
        ${isFailed ? 'border-(--color-warning)/30 bg-(--color-warning)/5' : ''}
        ${showErrorOverlay || showSignInOverlay ? 'min-h-[350px]' : ''}
        ${shouldAnimate ? 'animate-in fade-in slide-in-from-bottom-4 duration-(--duration-normal) fill-mode-backwards' : ''}
        ${isShaking ? 'animate-shake' : ''}
        `}
        style={shouldAnimate && index != null ? { animationDelay: `${index * 60}ms` } : undefined}
      >
        {/* Upload progress bar */}
        {uploadProgress?.status === 'uploading' && (
          <div className="h-1 w-full bg-(--color-surface-raised) overflow-hidden">
            <div
              className="h-full bg-(--color-accent) transition-all duration-(--duration-fast)"
              style={{ width: `${Math.round((uploadProgress.bytesUploaded / uploadProgress.totalBytes) * 100)}%` }}
            />
          </div>
        )}

        {/* Sign In Overlay — shown when enrichment failed due to missing auth */}
        {showSignInOverlay && (
            <div className="absolute inset-0 z-(--z-dropdown) bg-(--color-surface-overlay)/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-(--duration-normal)">
                <div className="w-12 h-12 bg-(--color-accent)/50 border-4 border-(--color-accent) rounded-full mb-4 flex items-center justify-center">
                    <LogIn size={24} className="text-(--color-accent)" />
                </div>
                <h4 className="text-(--color-text-primary) font-bold mb-1">Sign in for AI Enrichment</h4>
                <p className="text-xs text-(--color-text-secondary) mb-4">
                    Sign in with your Google account to enable automatic summaries, tagging, and smart search for your memories.
                </p>
                <button
                    onClick={(e) => { e.stopPropagation(); onSignIn?.(); }}
                    className={`${btn.base} ${btn.primary} w-full max-w-[220px] py-3 text-sm gap-2 shadow-(--color-accent)/20 touch-manipulation`}
                >
                    <LogIn size={16} />
                    Sign in with Google
                </button>
            </div>
        )}

        {/* Image Preview — show skeleton placeholder while attachments are deferred */}
        {displayImages.length > 0 && memory._attachmentsDeferred ? (
            <div className={`relative overflow-hidden rounded-t-(--radius-xl) bg-(--color-surface-overlay)/50 aspect-video sm:aspect-[2/1] flex items-center justify-center`}>
                <Loader2 size={24} className="text-(--color-text-tertiary) animate-spin" />
                {displayImages.length > 1 && (
                  <div className="absolute bottom-2 right-2 bg-black/60 text-(--color-text-primary) text-xs font-medium px-2 py-0.5 rounded-full backdrop-blur-md">
                      {displayImages.length} files loading...
                  </div>
                )}
            </div>
        ) : displayImages.length > 0 ? (
            <div
                className={`relative overflow-hidden rounded-t-(--radius-xl) bg-(--color-surface-overlay)/50 group/image cursor-zoom-in aspect-video sm:aspect-[2/1] ${isDialog ? 'max-h-[50vh]' : ''}`}
                onClick={(e) => { e.stopPropagation(); onViewAttachment?.(displayImages[0], [...displayImages, ...documents]); }}
            >
                <img
                    src={displayImages[0].data}
                    alt="User content"
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-(--duration-slow) group-hover/image:scale-105"
                />
                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/image:opacity-100 transition-opacity flex items-center justify-center">
                    <Maximize2 className="text-(--color-text-primary)" size={24} />
                </div>
                {displayImages.length > 1 && (
                  <div className="absolute bottom-2 right-2 bg-black/60 text-(--color-text-primary) text-xs font-medium px-2 py-0.5 rounded-full backdrop-blur-md">
                      +{displayImages.length - 1}
                  </div>
                )}
            </div>
        ) : null}
        
        <div className="p-5 flex-1 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
             <div className="flex items-center gap-2">
                 {memory.isPinned && <Pin size={12} className="text-(--color-accent) rotate-45" />}
                 {syncStatus === 'error' ? (
                   isOffline ? (
                     <span className="inline-flex items-center gap-1.5 text-(--color-text-tertiary)" title="Offline — sync will resume when reconnected">
                       <CloudOff size={14} />
                       <span className="text-xs font-medium">Offline — will sync later</span>
                     </span>
                   ) : (
                     <button
                       onClick={(e) => { e.stopPropagation(); onSyncRetry?.(memory.id); }}
                       className="inline-flex items-center gap-1.5 text-(--color-danger) hover:text-(--color-danger)/80 transition-colors"
                     >
                       <AlertCircle size={14} />
                       <span className="text-xs font-medium">Failed to sync — tap to retry</span>
                     </button>
                   )
                 ) : (
                   <>
                     {entity?.type ? (
                       <span className={`flex items-center gap-1.5 ${text.label}`}>
                         {getEntityIcon(entity.type)}
                         {entity.type}
                       </span>
                     ) : (
                       <Clock size={12} className="text-(--color-text-tertiary)" />
                     )}
                     <span className="text-xs text-(--color-text-tertiary) font-medium">{dateStr}</span>
                   </>
                 )}
             </div>
             {uploadProgress?.status === 'uploading' && (
               <span className="text-xs font-medium text-(--color-accent)">
                 Uploading... {Math.round((uploadProgress.bytesUploaded / uploadProgress.totalBytes) * 100)}%
               </span>
             )}
             {uploadProgress?.status === 'processing' && (
               <span className="text-xs font-medium text-(--color-accent) animate-pulse">Processing...</span>
             )}
             {uploadProgress?.status === 'failed' && (
               <span className="text-xs font-medium text-(--color-warning)">Upload failed</span>
             )}
             {!uploadProgress && memory.enrichmentStatus === 'submitting' && (
               <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-(--radius-full) text-xs font-medium border bg-(--color-accent)/15 text-(--color-accent) border-(--color-accent)/30 animate-pulse">
                 <Hourglass size={12} /> Submitted
               </span>
             )}
             {!uploadProgress && memory.enrichmentStatus === 'processing' && (
               <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-(--radius-full) text-xs font-medium border bg-(--color-accent)/15 text-(--color-accent) border-(--color-accent)/30 animate-pulse">
                 <Sparkles size={12} /> Enriching…
               </span>
             )}
             {!uploadProgress && memory.enrichmentStatus === 'failed_submit' && (
               <span className="inline-flex items-center gap-1">
                 <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-(--radius-full) text-xs font-medium border bg-(--color-warning)/15 text-(--color-warning) border-(--color-warning)/30">
                   <WifiOff size={12} /> Submit failed
                 </span>
                 {onRetry && (
                   <button
                     onClick={(e) => { e.stopPropagation(); onRetry(memory.id); }}
                     className="p-1.5 rounded-(--radius-lg) text-(--color-warning) hover:bg-(--color-warning)/20 transition-colors"
                     aria-label="Retry submission"
                   >
                     <RefreshCcw size={14} />
                   </button>
                 )}
               </span>
             )}
             {!uploadProgress && memory.enrichmentStatus === 'failed_server' && (
               <span className="inline-flex items-center gap-1">
                 <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-(--radius-full) text-xs font-medium border bg-(--color-warning)/15 text-(--color-warning) border-(--color-warning)/30">
                   <AlertCircle size={12} /> Enrichment failed
                 </span>
                 {onRetry && (
                   <button
                     onClick={(e) => { e.stopPropagation(); onRetry(memory.id); }}
                     className="p-1.5 rounded-(--radius-lg) text-(--color-warning) hover:bg-(--color-warning)/20 transition-colors"
                     aria-label="Retry enrichment"
                   >
                     <RefreshCcw size={14} />
                   </button>
                 )}
               </span>
             )}
          </div>

          {/* AI Title — below entity type, above user content */}
          {entity?.title && (
              <div className="mb-1">
                  <h3 className="text-lg font-semibold text-(--color-text-primary) leading-tight">{entity.title}</h3>
                  <div className="flex items-center gap-2 mt-1">
                      {entity.subtitle && <span className="text-xs text-(--color-text-secondary)">{entity.subtitle}</span>}
                      {/* eslint-disable-next-line design-system/no-raw-tailwind-colors -- enrichment content */}
                      {entity.rating && <span className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-500 light:bg-yellow-600/10 light:text-yellow-700 rounded font-medium">★ {entity.rating}</span>}
                  </div>
              </div>
          )}

          <div className="space-y-3 flex-1 flex flex-col">
            {/* User Content with Mask-based Fade */}
            {memory.content && (
                <div className="relative">
                    <div 
                        ref={contentRef}
                        className={`transition-all duration-(--duration-normal) ${!isDialog && isTruncated ? 'max-h-[300px] overflow-hidden' : ''}`}
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
                                className="flex items-center gap-2 px-4 py-2 bg-(--color-surface-raised)/90 backdrop-blur-md border border-(--color-border-default) rounded-full text-xs font-bold text-(--color-accent) hover:text-(--color-accent-hover) hover:bg-(--color-surface-raised) transition-all shadow-lg active:scale-95"
                            >
                                <Maximize2 size={12} /> READ FULL MEMORY
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Shimmer placeholder while AI enrichment is pending */}
            {isInFlight && !enrichment && (
                <div className="space-y-2 mt-2">
                    <div className="h-3 w-3/4 rounded bg-(--color-surface-raised)/50 animate-shimmer" />
                    <div className="h-3 w-1/2 rounded bg-(--color-surface-raised)/50 animate-shimmer" />
                    <div className="h-3 w-2/3 rounded bg-(--color-surface-raised)/50 animate-shimmer" />
                </div>
            )}

            {/* Enrichment Icon Row + Expandable Sections */}
            {(() => {
                const typeSections = enrichment ? getContentTypeSections(enrichment.contentType, enrichment as EnrichmentFields) : [];
                const hasAnyCTA = aiText || typeSections.length > 0 || targetUri || linkedEvents.length > 0 || linkedTodos.length > 0 || relatedItems.length > 0;
                if (!hasAnyCTA) return null;

                // Date-like and Action Items enrichment sections use the same
                // calendar/check glyphs as the linked-item toggles. To avoid two
                // identical icons, fold the links into the existing section's
                // expansion instead of adding a separate icon.
                const dateSectionKey = typeSections.find((s) => DATE_LIKE_SECTION_KEYS.has(s.key))?.key;
                const hasActionSection = typeSections.some((s) => s.key === 'actionItems');
                const linkedEventsKey = dateSectionKey ?? 'linked-events';
                const linkedTodosKey = hasActionSection ? 'actionItems' : 'linked-todos';

                return (
                    <div className="space-y-2 mt-auto">
                        <div className="flex items-center gap-1 flex-wrap">
                            {aiText && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowSummary(!showSummary); }}
                                    title="Summary"
                                    className={`p-2 rounded-(--radius-lg) transition-colors ${showSummary ? 'bg-(--color-surface-raised)/60 text-(--color-text-primary)' : 'text-(--color-text-tertiary) hover:text-(--color-text-secondary) hover:bg-(--color-surface-hover-subtle)'}`}
                                >
                                    <FileText size={16} />
                                </button>
                            )}
                            {typeSections.map((section) => (
                                <button
                                    key={section.key}
                                    onClick={(e) => { e.stopPropagation(); setExpandedSection(expandedSection === section.key ? null : section.key); }}
                                    title={section.label}
                                    className={`p-2 rounded-(--radius-lg) transition-colors ${expandedSection === section.key ? 'bg-(--color-surface-raised)/60 text-(--color-text-primary)' : 'text-(--color-text-tertiary) hover:text-(--color-text-secondary) hover:bg-(--color-surface-hover-subtle)'}`}
                                >
                                    {/* Icons in sections are size 12; scale up for button display */}
                                    <span className="[&>svg]:w-4 [&>svg]:h-4">{section.icon}</span>
                                </button>
                            ))}
                            {linkedEvents.length > 0 && !dateSectionKey && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setExpandedSection(expandedSection === 'linked-events' ? null : 'linked-events'); }}
                                    title="In Calendar"
                                    aria-label="Show linked calendar events"
                                    className={`p-2 rounded-(--radius-lg) transition-colors ${expandedSection === 'linked-events' ? 'bg-(--color-surface-raised)/60 text-(--color-text-primary)' : 'text-(--color-text-tertiary) hover:text-(--color-text-secondary) hover:bg-(--color-surface-hover-subtle)'}`}
                                >
                                    <CalendarDays size={16} className="text-(--color-accent)" />
                                </button>
                            )}
                            {linkedTodos.length > 0 && !hasActionSection && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setExpandedSection(expandedSection === 'linked-todos' ? null : 'linked-todos'); }}
                                    title="In To-Do List"
                                    aria-label="Show linked to-do items"
                                    className={`p-2 rounded-(--radius-lg) transition-colors ${expandedSection === 'linked-todos' ? 'bg-(--color-surface-raised)/60 text-(--color-text-primary)' : 'text-(--color-text-tertiary) hover:text-(--color-text-secondary) hover:bg-(--color-surface-hover-subtle)'}`}
                                >
                                    <CircleCheck size={16} className="text-(--color-success)" />
                                </button>
                            )}
                            {relatedItems.length > 0 && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setExpandedSection(expandedSection === 'related' ? null : 'related'); }}
                                    title="Related memories"
                                    aria-label="Show related memories"
                                    className={`p-2 rounded-(--radius-lg) transition-colors ${expandedSection === 'related' ? 'bg-(--color-surface-raised)/60 text-(--color-text-primary)' : 'text-(--color-text-tertiary) hover:text-(--color-text-secondary) hover:bg-(--color-surface-hover-subtle)'}`}
                                >
                                    <Waypoints size={16} className="text-(--color-accent)" />
                                </button>
                            )}
                            {enrichment?.contentType === 'recipe' && Array.isArray(enrichment.ingredients) && enrichment.ingredients.length > 0 && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowCalculator(true); }}
                                    title="Recipe calculator"
                                    aria-label="Open recipe calculator"
                                    className="p-2 rounded-(--radius-lg) transition-colors text-(--color-text-tertiary) hover:text-(--color-accent) hover:bg-(--color-surface-hover-subtle)"
                                >
                                    <Calculator size={16} />
                                </button>
                            )}
                            {targetUri && (
                                <a
                                    href={targetUri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    title="Open Link"
                                    className="p-2 rounded-(--radius-lg) text-(--color-text-tertiary) hover:text-(--color-accent) hover:bg-(--color-surface-hover-subtle) transition-colors"
                                >
                                    <ExternalLink size={16} />
                                </a>
                            )}
                        </div>

                        {/* Expandable Summary */}
                        {showSummary && aiText && (
                            <div className="text-sm text-(--color-text-secondary) font-light leading-relaxed pl-1 animate-in fade-in slide-in-from-top-1 duration-(--duration-fast)">
                                {String(aiText)}
                            </div>
                        )}

                        {/* Expandable Type-Specific Sections */}
                        {typeSections.map((section) => {
                            if (expandedSection !== section.key) return null;
                            const value = (enrichment as EnrichmentFields)?.[section.key];
                            if (!value) return null;

                            return (
                                <div key={section.key} className="animate-in fade-in slide-in-from-top-1 duration-(--duration-fast)">
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

                        {/* Expandable: calendar events created from this note.
                            Shown under the Date section when one exists. */}
                        {expandedSection === linkedEventsKey && linkedEvents.length > 0 && (
                            <div className="pt-1 space-y-1 animate-in fade-in slide-in-from-top-1 duration-(--duration-fast)">
                                <span className={`flex items-center gap-1.5 ${text.label}`}>
                                    <CalendarDays size={12} className="text-(--color-accent)" />
                                    In Calendar
                                </span>
                                {linkedEvents.map((event) => (
                                    <button
                                        key={event.id}
                                        onClick={(e) => { e.stopPropagation(); onOpenCalendarEvent?.(event.id); }}
                                        title="View in calendar"
                                        className="flex items-center gap-1.5 max-w-full text-sm text-(--color-accent) hover:text-(--color-accent-hover) transition-colors duration-(--duration-fast)"
                                    >
                                        <span className="truncate">{event.title}</span>
                                        <span className="text-xs text-(--color-text-tertiary) shrink-0">
                                            {formatLinkDate(event.startDate)}{event.recurringGroupId ? ' · repeats' : ''}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Expandable: to-do items created from this note.
                            Shown under the Action Items section when one exists. */}
                        {expandedSection === linkedTodosKey && linkedTodos.length > 0 && (
                            <div className="pt-1 space-y-1 animate-in fade-in slide-in-from-top-1 duration-(--duration-fast)">
                                <span className={`flex items-center gap-1.5 ${text.label}`}>
                                    <CircleCheck size={12} className="text-(--color-success)" />
                                    In To-Do List
                                </span>
                                {linkedTodos.map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={(e) => { e.stopPropagation(); onOpenTodoItem?.(item.id); }}
                                        title="View in to-do list"
                                        className={`flex items-center gap-1.5 max-w-full text-sm transition-colors duration-(--duration-fast) ${
                                            item.isCompleted
                                                ? 'text-(--color-text-secondary) hover:text-(--color-text-primary)'
                                                : 'text-(--color-accent) hover:text-(--color-accent-hover)'
                                        }`}
                                    >
                                        {item.isCompleted ? (
                                            <CheckSquare size={14} className="shrink-0 text-(--color-success)" />
                                        ) : (
                                            <Square size={14} className="shrink-0 text-(--color-text-tertiary)" />
                                        )}
                                        <span className={`truncate ${item.isCompleted ? 'line-through' : ''}`}>{item.title}</span>
                                        {item.deadline && (
                                            <span className="text-xs text-(--color-text-tertiary) shrink-0">{formatLinkDate(item.deadline)}</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Expandable: similar notes from embedding similarity */}
                        {expandedSection === 'related' && relatedItems.length > 0 && (
                            <div className="pt-1 space-y-1 animate-in fade-in slide-in-from-top-1 duration-(--duration-fast)">
                                <span className={`flex items-center gap-1.5 ${text.label}`}>
                                    <Waypoints size={12} className="text-(--color-accent)" />
                                    Related
                                </span>
                                {relatedItems.map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={(e) => { e.stopPropagation(); onOpenRelatedMemory?.(item.id); }}
                                        title="View related memory"
                                        className="flex items-center gap-1.5 max-w-full text-sm text-(--color-accent) hover:text-(--color-accent-hover) transition-colors duration-(--duration-fast)"
                                    >
                                        <span className="truncate">{item.title}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* Documents */}
            {documents.length > 0 && !memory._attachmentsDeferred && (
                <div className="flex flex-col gap-1.5 pt-1">
                    {documents.map((doc) => (
                        <div
                            key={doc.id}
                            onClick={(e) => { e.stopPropagation(); onViewAttachment?.(doc, [...displayImages, ...documents]); }}
                            className="flex items-center gap-2 p-3 rounded-(--radius-xl) bg-(--color-surface-overlay)/30 border border-(--color-border-subtle) hover:bg-(--color-surface-raised)/50 transition-colors cursor-pointer group/doc active:scale-[0.98]"
                        >
                            <FileText size={16} className="text-(--color-text-tertiary) group-hover/doc:text-(--color-accent)" />
                            <span className="text-sm text-(--color-text-secondary) truncate flex-1 group-hover/doc:text-(--color-text-primary)">{doc.name}</span>
                            <div className="flex items-center gap-2">
                                <Eye size={16} className="text-(--color-text-tertiary) opacity-0 group-hover/doc:opacity-100" />
                                <button
                                    onClick={async e => { e.stopPropagation(); if (doc.data) { try { await downloadDataUri(doc.data, doc.name, doc.mimeType); } catch (err) { console.error('Download failed:', err); } } }}
                                    className="p-2 -m-2 text-(--color-text-tertiary) hover:text-(--color-text-primary) transition-colors"
                                >
                                    <Paperclip size={16} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {documents.length > 0 && memory._attachmentsDeferred && (
                <div className="flex items-center gap-2 p-3 rounded-(--radius-xl) bg-(--color-surface-overlay)/30 border border-(--color-border-subtle)">
                    <Loader2 size={16} className="text-(--color-text-tertiary) animate-spin" />
                    <span className="text-sm text-(--color-text-tertiary)">{documents.length} document{documents.length > 1 ? 's' : ''} loading...</span>
                </div>
            )}

            {/* Footer */}
            <div className="flex flex-wrap items-center gap-y-2 gap-x-4 pt-2 border-t border-(--color-border-subtle) mt-2">
                <div className="flex flex-wrap gap-1.5 flex-1">
                    {(memory.tags || []).map((tag) => (
                        <span key={tag} className="text-xs text-(--color-text-tertiary) hover:text-(--color-text-secondary) bg-(--color-surface-overlay)/50 px-2 py-1 rounded-(--radius-md)">#{tag}</span>
                    ))}
                </div>
                <div className="flex items-center gap-2 ml-auto relative">
                    {onRetry && isFailed && (
                        <button onClick={() => onRetry(memory.id)} className="p-2 text-(--color-warning) hover:text-(--color-warning) transition-colors rounded-(--radius-lg) hover:bg-(--color-warning)/20">
                            <RefreshCcw size={16} />
                        </button>
                    )}
                    <div className="relative">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setIsMenuOpen(!isMenuOpen); }} 
                            className={`p-2 rounded-(--radius-lg) hover:bg-(--color-surface-raised)/50 transition-colors ${isMenuOpen ? 'text-(--color-text-primary) bg-(--color-surface-raised)/50' : 'text-(--color-text-tertiary)'}`}
                        >
                            <MoreVertical size={20} />
                        </button>
                        {isMenuOpen && (
                            <>
                            <div
                                className={`${menu.backdrop} ${isDialog ? 'z-(--z-sheet)' : 'z-(--z-overlay)'}`}
                                onClick={(e) => { e.stopPropagation(); setIsMenuOpen(false); }}
                            />
                            <div className={`${menu.panel} ${isDialog ? 'z-(--z-toast)' : 'z-(--z-modal)'}`}>
                                {onTogglePin && (
                                    <button onClick={handlePin} className={menu.item}>
                                        <Pin size={16} className={memory.isPinned ? "fill-current" : ""} />
                                        {memory.isPinned ? 'Unpin' : 'Pin'}
                                    </button>
                                )}
                                {onEdit && (
                                    <button onClick={handleEdit} className={`${menu.item} ${menu.divider}`}>
                                        <Pencil size={16} /> Edit
                                    </button>
                                )}
                                {onDelete && (
                                    <button onClick={startDelete} className={menu.itemDanger}>
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
                <div className={confirm.backdrop}>
                    <AlertTriangle size={32} className="text-(--color-warning) mb-3" />
                    <h4 className={confirm.title}>Delete Memory?</h4>
                    <p className={confirm.message}>This action cannot be undone.</p>
                    <div className="flex gap-2 w-full">
                        <button onClick={cancelDelete} className={`${btn.base} ${btn.secondary} flex-1 py-3 text-sm`}>
                            Cancel
                        </button>
                        <button onClick={confirmDelete} className={`${btn.base} ${btn.danger} flex-1 py-3 text-sm shadow-(--color-danger)/20`}>
                            Delete
                        </button>
                    </div>
                </div>
            )}
            <RecipeCalculatorDialog
                isOpen={showCalculator}
                ingredients={Array.isArray(enrichment?.ingredients) ? enrichment.ingredients : []}
                onClose={() => setShowCalculator(false)}
            />
          </div>
        </div>
      </div>
    </>
  );
};

export default memo(MemoryCard);