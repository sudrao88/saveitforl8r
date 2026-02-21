
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
