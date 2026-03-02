
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

export interface EnrichmentData {
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
  // Smart enrichment fields (populated based on content classification)
  keyPoints?: string[];
  actionItems?: string[];
  decisions?: string[];
  openQuestions?: string[];
  themes?: string[];
  sentiment?: string;
  contentType?: string;
  enrichmentStrategy?: string;

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
}

export interface Attachment {
  id: string;
  type: 'image' | 'file';
  mimeType: string;
  data: string; // Base64 Data URI
  name: string;
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
  isSample?: boolean; // Flag to exclude from sync
  isPinned?: boolean;
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
