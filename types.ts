
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
  temporalContext?: TemporalContext;
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

// --- Moments Feature Types ---

export interface RhythmMatcher {
  field: 'entityType' | 'tag' | 'keyword';
  value: string;
}

export interface CadencePattern {
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'seasonal' | 'contextual';
  daysOfWeek?: number[];          // 0=Sun … 6=Sat
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
  surfaceOffsetHours?: number;    // Surface this far in advance of target time
  months?: number[];              // 0=Jan … 11=Dec, for seasonal
  contextTrigger?: {
    type: 'co-occurrence';
    withClusterTag?: string;      // Activate only when a trip cluster is approaching
  };
}

export interface ParsedRhythm {
  matchers: RhythmMatcher[];
  cadence: CadencePattern;
  inferredLabel: string;          // Display name, e.g. "Weekend Dining"
}

export interface Rhythm {
  id: string;
  natural: string;                // Original text as typed by user
  parsed: ParsedRhythm;          // LLM output, stored at creation time
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
}

export type MomentType =
  | 'itinerary'     // Trip or event with temporal window
  | 'brief'         // Meeting/interview prep
  | 'list'          // Restaurant, movie, book, shopping picks
  | 'dashboard'     // Event planning (venue + tasks + budget)
  | 'curriculum'    // Learning path
  | 'gift-guide'    // Gift ideas for a person/occasion
  | 'meal-plan'     // Recipes + meal prep
  | 'general';      // Fallback

export interface MomentCluster {
  id: string;                     // Deterministic: sha256 of cluster criteria JSON
  title: string;                  // Derived title
  type: MomentType;               // Determines synthesis template
  clusterCriteria: {
    entityType?: string;
    tag?: string;
    temporalWindow?: { start: string; end: string };
  };
  noteIds: string[];
  aggregatedTags: string[];       // Union of all tags across member notes
  inputHash: string;              // sha256(sorted noteIds + their timestamps)
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

export interface MomentMeta {
  momentId: string;
  lastSurfacedAt?: number;
  lastViewedAt?: number;
  dismissCount: number;
  frequencyOverride?: 'more' | 'less' | null;
  completedNoteIds: string[];
}
