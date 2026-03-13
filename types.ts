
export interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface EntityContext {
  type: string; // 'Movie', 'Book', 'Music', 'Product', 'Other'
  title?: string;
  subtitle?: string; // Author, Director, Artist, or Year
  description?: string; // Synopsis or details
  rating?: string; // e.g. "4.5/5" or "98%"
}

export interface TemporalContext {
  relevantAt?: {
    start: string;            // ISO date or fuzzy ("2026-03", "summer 2026")
    end?: string;             // For ranges (trips, seasons)
    isRecurring?: boolean;    // Birthdays, anniversaries
    recurrenceRule?: string;  // "yearly", "monthly"
  };
  urgency?: 'low' | 'medium' | 'high';
  inferenceConfidence: number;  // 0–1; below 0.5 triggers Layer 3 nudge
}

export interface LinkPreview {
  url: string;
  imageData: string;      // Base64 data URI
  imageMimeType: string;
  title?: string;
  description?: string;
}

export interface EnrichmentData {
  [key: string]: unknown;
  summary: string;
  visualDescription?: string; // For images
  locationIsRelevant?: boolean;
  locationContext?: {
    name?: string;
    address?: string;
    website?: string;
    operatingHours?: string;
    latitude?: number;
    longitude?: number;
    mapsUri?: string; // Direct link to Google Places
  };
  entityContext?: EntityContext;
  suggestedTags: string[];
  temporalContext?: TemporalContext;
  matchedMomentIds?: string[];     // Moment IDs this note is relevant to (set by enrichment)

  // Smart enrichment fields (populated based on content classification)
  keyPoints?: string[];
  actionItems?: string[];
  decisions?: string[];
  openQuestions?: string[];
  themes?: string[];
  sentiment?: string;
  contentType?: string;
  enrichmentStrategy?: string;
  sourceUrl?: string;            // User-provided URL (used as the link CTA)

  // Content-type-specific fields
  ingredients?: string[];        // recipe
  instructions?: string[];       // recipe
  pros?: string[];               // product, comparison
  cons?: string[];               // product, comparison
  price?: string;                // product, wishlist
  whereToBuy?: string;           // product, wishlist
  date?: string;                 // event
  rsvpStatus?: string;           // event
  menuHighlights?: string[];     // place/restaurant
  ratings?: string;              // place/restaurant, book, movie/tv
  keyMoments?: string[];         // video
  transcriptSummary?: string;    // video, podcast
  author?: string;               // social_media_post, quote, book, research
  engagement?: string;           // social_media_post
  relatedPosts?: string[];       // social_media_post
  methodology?: string;          // research/academic
  keyFindings?: string[];        // research/academic
  citations?: string[];          // research/academic
  company?: string;              // job_listing
  role?: string;                 // job_listing
  requirements?: string[];       // job_listing
  salary?: string;               // job_listing
  itinerary?: string[];          // travel
  costEstimate?: string;         // travel
  packingList?: string[];        // travel
  artist?: string;               // music
  album?: string;                // music
  genre?: string;                // music, book, movie/tv
  mood?: string;                 // music
  cast?: string[];               // movie/tv
  whereToWatch?: string;         // movie/tv
  host?: string;                 // podcast
  keyTopics?: string[];          // podcast
  episodeLength?: string;        // podcast
  source?: string;               // quote
  context?: string;              // quote
  language?: string;             // code_snippet
  purpose?: string;              // code_snippet
  dependencies?: string[];       // code_snippet
  contactName?: string;          // contact
  phone?: string;                // contact
  email?: string;                // contact
  contactNotes?: string;         // contact
  condition?: string;            // health
  recommendations?: string[];    // health
  followUp?: string;             // health
  amount?: string;               // financial
  category?: string;             // financial
  dueDate?: string;              // financial
  documentType?: string;         // legal
  keyClauses?: string[];         // legal
  deadlines?: string[];          // legal
  subject?: string;              // educational
  keyConcepts?: string[];        // educational
  studyNotes?: string[];         // educational

  // Link preview images (fetched from og:image during enrichment)
  linkPreviews?: LinkPreview[];

  // Calendar event detection (populated when date-based events are found)
  detectedEvents?: DetectedEvent[];

  // Action item detection (populated when tasks/to-dos are found)
  detectedActionItems?: DetectedActionItem[];
}

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface DetectedEvent {
  title: string;
  startDate: string;           // ISO 8601 — "2026-06-15T16:00:00"
  endDate?: string;            // Optional end time
  allDay: boolean;             // true when only a date is known, no specific time
  location?: string;           // Venue or address
  people?: string[];           // People involved
  status: 'confirmed' | 'tentative' | 'cancelled';
  isRecurring?: boolean;                      // True for repeating events
  recurrenceFrequency?: RecurrenceFrequency;  // How often it repeats
  recurrenceEndDate?: string;                 // ISO 8601 end boundary
  recurrenceDayOfWeek?: number;               // 0=Sun..6=Sat (for weekly)
}

export interface CalendarEvent {
  id: string;
  memoryId: string;            // Source note that generated this event
  title: string;
  description?: string;        // Brief context from the note
  startDate: string;           // ISO 8601
  endDate?: string;
  allDay: boolean;
  location?: string;
  people?: string[];
  status: 'confirmed' | 'tentative' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  isDeleted?: boolean;         // Soft-delete for sync
  recurringGroupId?: string;   // Shared UUID across all occurrences of a recurring series
  recurrenceRule?: {
    frequency: RecurrenceFrequency;
    endDate?: string;
  };
  occurrenceDate?: string;     // The specific date this occurrence represents
}

export interface DetectedActionItem {
  title: string;
  deadline?: string;           // ISO 8601 date — "2026-06-15" or "2026-06-15T16:00:00"
  priority?: 'low' | 'medium' | 'high';
}

export interface TodoItem {
  id: string;
  memoryId: string;            // Source note that generated this item
  title: string;
  description?: string;        // Brief context from the note summary
  deadline?: string;           // ISO 8601
  priority: 'low' | 'medium' | 'high';
  isCompleted: boolean;
  completedAt?: number;        // Timestamp when marked done
  createdAt: number;
  updatedAt: number;
  isDeleted?: boolean;         // Soft-delete for sync
}

export interface Attachment {
  id: string;
  type: 'image' | 'file';
  mimeType: string;
  data: string; // Base64 Data URI
  name: string;
}

export interface QuickNoteState {
  content: string;
  attachments: Attachment[];
  tags: string[];
}

export interface Memory {
  id: string;
  timestamp: number;
  content: string; // User text
  image?: string; // Legacy field for backward compatibility
  attachments?: Attachment[]; // New field for multiple files
  location?: GeoLocation;
  enrichment?: EnrichmentData;
  tags: string[]; // Finalized tags
  isPending?: boolean;
  isDeleting?: boolean; // UI state for deletion animation
  processingError?: boolean;
  isDeleted?: boolean; // Persistent soft-delete flag for sync
  isPinned?: boolean;
  source?: 'web' | 'whatsapp'; // Origin of the note
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  sources?: string[]; // IDs of memories used
}

export enum ViewMode {
  FEED = 'FEED',
  RECALL = 'RECALL',
}

// --- Moments Feature Types ---

export type MomentType =
  | 'itinerary'     // Trip or event with temporal window
  | 'brief'         // Meeting/interview prep
  | 'list'          // Restaurant, movie, book, shopping picks
  | 'dashboard'     // Event planning (venue + tasks + budget)
  | 'curriculum'    // Learning path
  | 'gift-guide'    // Gift ideas for a person/occasion
  | 'meal-plan'     // Recipes + meal prep
  | 'general';      // Fallback

export interface Moment {
  id: string;                     // crypto.randomUUID(), stable across devices
  objective: string;              // User's intention, e.g. "build an itinerary for my Singapore trip"
  refinedObjective?: string;      // AI-refined objective from intent refinement step (more detailed/specific)
  title: string;                  // Short display title (AI-generated or derived from objective)
  type: MomentType;               // AI-inferred from objective during creation
  emoji?: string;                 // AI-generated emoji representing the moment's content
  noteIds: string[];              // Notes used in the latest synthesis
  createdAt: number;
  updatedAt: number;
  isDeleted?: boolean;            // Soft-delete for multi-device sync (tombstone)
  lastSynthesizedAt?: number;     // Timestamp of last synthesis
  inputHash?: string;             // Hash of noteIds for cache invalidation
  lastSeenInputHash?: string;     // inputHash when user last viewed this moment
  isPending?: boolean;            // True while server is processing async creation
  processingError?: boolean;      // True if server pipeline failed
}

export interface SynthesisItem {
  label: string;
  detail?: string;
  link?: string;
  sourceNoteId: string;
  completable?: boolean;
  completed?: boolean;
}

export interface SynthesisSection {
  heading: string;
  items: SynthesisItem[];
}

export interface SynthesisResponse {
  format: MomentType;
  title: string;
  subtitle?: string;
  sections: SynthesisSection[];
  generatedFrom: string[];        // Note IDs used
}

export interface MomentSynthesis {
  momentId: string;
  inputHash: string;
  content: SynthesisResponse;
  generatedAt: number;
  noteIds: string[];
}
