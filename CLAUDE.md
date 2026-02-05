# CLAUDE.md — AI Assistant Guide for SaveItForL8R

## Project Overview

SaveItForL8R is a **Progressive Web App (PWA)** — a "personal second brain" for capturing, organizing, and recalling memories with AI assistance. Users save text, images, and files which are enriched by Google Gemini, stored locally with encryption, and optionally synced to Google Drive.

**Key Features:**
- AI-powered memory enrichment and semantic search (online via Gemini, offline via local embeddings)
- Offline-first with local vector search using Orama + transformer embeddings
- PDF text extraction and OCR for images
- End-to-end encryption with AES-GCM
- Google Drive sync with conflict resolution
- Native mobile apps via Capacitor (Android/iOS)

## Tech Stack

- **Language**: TypeScript (strict, ES2022 target)
- **Framework**: React 19 with functional components and hooks
- **Build Tool**: Vite 6
- **Styling**: Tailwind CSS 4 (utility-first, dark theme default)
- **AI**: Google Gemini API (`@google/genai`) + local embeddings (`@xenova/transformers`)
- **Vector Search**: Orama (in-memory) + Dexie (IndexedDB persistence)
- **Document Processing**: PDF.js (text extraction), Tesseract.js (OCR)
- **Auth**: Google OAuth 2.0 with PKCE
- **Cloud Storage**: Google Drive (appDataFolder)
- **Local Storage**: IndexedDB with AES-GCM encryption
- **Testing**: Vitest + React Testing Library
- **Native Apps**: Capacitor (Android/iOS)
- **Deployment**: Docker + Nginx → Firebase Hosting or Google Cloud Run

## Commands

```bash
npm run dev       # Start dev server (port 9000)
npm run build     # Production build → dist/
npm run preview   # Preview production build locally
npm run test      # Run tests with Vitest
```

## Project Structure

```
/
├── App.tsx                  # Root component — view routing, state orchestration
├── index.tsx                # React entry point (renders <App/> into DOM)
├── index.html               # HTML shell with PWA metadata
├── index.css                # Tailwind CSS imports & custom classes
├── types.ts                 # All TypeScript interfaces (Memory, Attachment, etc.)
├── constants.ts             # Analytics event names & storage keys
├── setupTests.ts            # Test setup (jest-dom matchers)
│
├── components/              # React UI components (PascalCase)
│   ├── MemoryCard.tsx       # Memory display card with expand, edit, delete
│   ├── ChatInterface.tsx    # AI recall/semantic search chat UI
│   ├── NewMemoryPage.tsx    # Memory capture: rich text, checklists, attachments
│   ├── SettingsModal.tsx    # Settings, export/import, encryption management
│   ├── TopNavigation.tsx    # Top nav bar
│   ├── FilterBar.tsx        # Memory type/tag filtering
│   ├── ApiKeyModal.tsx      # Gemini API key input
│   ├── EmptyState.tsx       # Empty state display
│   ├── InstallPrompt.tsx    # PWA install prompt
│   ├── ShareOnboardingModal.tsx  # Share feature onboarding
│   ├── MultiSelect.tsx      # Tag/multi-select dropdown
│   ├── ErrorBoundary.tsx    # React error boundary for graceful crash recovery
│   └── icons.tsx            # Custom SVG icon components (Logo)
│
├── hooks/                   # Custom React hooks (business logic)
│   ├── useMemories.ts       # Memory CRUD, enrichment, IndexedDB persistence
│   ├── useSync.ts           # Google Drive sync orchestration
│   ├── useAuth.ts           # Google OAuth flow & token state
│   ├── useSettings.ts       # API key & app settings
│   ├── useServiceWorker.ts  # PWA update detection
│   ├── useMemoryFilters.ts  # Filter/search logic
│   ├── useShareReceiver.ts  # Web Share Target API handler
│   ├── useOnboarding.ts     # Onboarding flow state
│   ├── useExportImport.ts   # Data export/import logic
│   ├── useEncryptionSettings.ts  # Encryption key management
│   ├── useAdaptiveSearch.ts # Hybrid online/offline search (Gemini + local RAG)
│   └── useHotkeys.ts        # Keyboard shortcut handling
│
├── services/                # External integrations & utilities
│   ├── geminiService.ts     # Gemini API: enrichment + semantic search
│   ├── storageService.ts    # IndexedDB operations (encrypted read/write)
│   ├── encryptionService.ts # AES-GCM encrypt/decrypt (Web Crypto API)
│   ├── googleDriveService.ts    # Google Drive API client
│   ├── googleAuth.ts        # OAuth 2.0 PKCE flow implementation
│   ├── tokenService.ts      # Token storage & refresh
│   ├── pkce.ts              # PKCE code verifier/challenge generation
│   ├── analytics.ts         # Google Analytics 4 wrapper
│   ├── csvService.ts        # CSV export
│   ├── sampleData.ts        # Sample memories for first-run onboarding
│   ├── db.ts                # Dexie database for RAG vectors & processing queue
│   ├── fileProcessor.ts     # PDF text extraction + OCR (Tesseract.js)
│   └── embedding.worker.ts  # Web Worker: local embeddings & vector search
│
├── context/
│   └── SyncContext.tsx      # React Context for sync state (full & delta sync)
│
├── public/                  # Static PWA assets
│   ├── sw.js                # Service worker (caching, share target)
│   ├── manifest.json        # Web App Manifest
│   ├── icon.svg             # App icon (maskable)
│   └── logo-full.svg        # Full logo SVG
│
├── android/                 # Capacitor Android project
│   ├── app/                 # Android app module
│   └── capacitor-cordova-android-plugins/
│
├── ios/                     # Capacitor iOS project
│   ├── App/                 # iOS app module
│   └── capacitor-cordova-ios-plugins/
│
├── vite.config.ts           # Vite config (port 9000, env vars, path aliases)
├── tsconfig.json            # TypeScript config (ES2022, bundler resolution)
├── postcss.config.js        # PostCSS with Tailwind plugin
├── firebase.json            # Firebase Hosting config
├── Dockerfile               # Multi-stage Docker build (node → nginx)
├── cloudbuild.yaml          # Google Cloud Build pipeline
├── deploy-cloud-run.sh      # Cloud Run deployment script
└── nginx.conf               # Nginx config for SPA routing
```

## Architecture

### Data Flow

1. **Capture**: `NewMemoryPage` → `useMemories.createMemory()` → IndexedDB (encrypted)
2. **Enrich**: `geminiService.enrichMemory()` → Gemini API adds summary, tags, location, entity context
3. **Index**: `embedding.worker.ts` → Extract text (PDF/OCR) → Generate embeddings → Store in Dexie/Orama
4. **Sync**: `SyncContext` → bidirectional Google Drive sync (full & delta with snapshot diffing)
5. **Recall**: `ChatInterface` → `useAdaptiveSearch` → Online (Gemini) or Offline (local vector search)

### Key Patterns

- **Hooks for logic, components for UI**: All business logic lives in `hooks/`, components are presentational
- **Service layer isolation**: Each external API (Gemini, Drive, IndexedDB, Analytics) has its own service module
- **Context for global state**: `SyncContext` wraps the app; other state is hook-local
- **Two-phase memory creation**: Immediate local save (with `isPending: true`) → async AI enrichment
- **Soft delete with tombstones**: `isDeleted` flag for sync consistency (never hard-delete synced memories until reconciled)
- **Offline-first**: Full functionality without internet; enrichment and sync queue when online
- **Adaptive search**: Automatically switches between Gemini (online) and local embeddings (offline)
- **Web Worker isolation**: Heavy ML model runs in `embedding.worker.ts` to avoid blocking UI

### Offline RAG System

The app includes a local Retrieval-Augmented Generation (RAG) system for offline search:

1. **Text Extraction** (`fileProcessor.ts`):
   - PDF: Uses PDF.js to extract text from all pages
   - Images: Uses Tesseract.js for OCR

2. **Embedding Pipeline** (`embedding.worker.ts`):
   - Model: `Xenova/bge-small-en-v1.5` (~33MB, 384 dimensions)
   - Chunks text into 1000-char segments
   - Generates embeddings via `@xenova/transformers`
   - Stores vectors in Dexie (persistent) and Orama (in-memory index)

3. **Search** (`useAdaptiveSearch.ts`):
   - Online + API key: Uses Gemini semantic search
   - Offline or no API key: Uses local hybrid search (Orama)
   - Auto-detects network status and model availability

4. **Processing Queue** (`db.ts`):
   - Async queue with retry logic (3 attempts)
   - States: `pending_extraction` → `pending_embedding` → `completed` | `failed`
   - Auto-purges completed items after 1 hour

### Core Data Types (types.ts)

```typescript
Memory {
  id: string;              // UUID
  timestamp: number;       // Unix ms
  content: string;         // User text (may contain HTML for rich text)
  attachments?: Attachment[];  // Images/files as base64 data URIs
  location?: GeoLocation;
  enrichment?: EnrichmentData; // AI-generated summary, tags, context
  tags: string[];          // Finalized tags
  isPending?: boolean;     // Enrichment in progress
  isDeleting?: boolean;    // UI state for deletion animation
  processingError?: boolean;
  isDeleted?: boolean;     // Soft-delete for sync
  isSample?: boolean;      // Exclude from sync
  isPinned?: boolean;      // Pin to top of feed
}

VectorRecord {
  id: string;              // noteId_chunkIndex
  originalId: string;      // Memory ID for querying
  vector: number[];        // 384-dim embedding
  extractedText: string;   // Chunk text
  metadata: any;           // originalId, chunkIndex
}
```

## Code Conventions

### Naming

| Element       | Convention          | Example                      |
|---------------|---------------------|------------------------------|
| Components    | PascalCase          | `MemoryCard.tsx`             |
| Hooks         | camelCase, `use*`   | `useMemories.ts`             |
| Services      | camelCase           | `geminiService.ts`           |
| Types         | PascalCase          | `EnrichmentData`             |
| Constants     | UPPER_SNAKE_CASE    | `STORAGE_KEYS`, `ANALYTICS_EVENTS` |
| Files         | PascalCase (components), camelCase (hooks/services) | |

### Styling

- Tailwind CSS utility classes (no separate CSS modules)
- Dark theme by default (background `#111827`)
- Mobile-first responsive design (`sm:`, `lg:`, `xl:` breakpoints)
- Custom CSS classes in `index.css`: `.font-brand`, `.mask-gradient`, `.no-scrollbar`

### TypeScript

- Strict typing throughout; interfaces defined in `types.ts`
- Path alias `@/*` maps to project root
- Target ES2022, module ESNext, bundler resolution
- `vitest/globals` types included for testing

### Component Patterns

- Functional components only (no class components)
- React 19 features in use
- Props destructured inline
- `useCallback` and `useMemo` for performance-critical paths
- `useRef` to avoid stale closures in callbacks
- Use `ErrorBoundary` to wrap components that may throw

## Environment Variables

Variables are injected at build time via Vite's `define` config:

| Variable                    | Purpose                           | Where Set          |
|-----------------------------|-----------------------------------|--------------------|
| `GEMINI_API_KEY`            | Gemini API key (build-time only)  | `.env`             |
| `VITE_GOOGLE_CLIENT_ID`    | Google OAuth client ID            | `.env` / Docker ARG |
| `VITE_GOOGLE_CLIENT_SECRET`| Google OAuth client secret        | `.env` / Docker ARG |

**Important**: The app **requires** users to set their own Gemini API key via the UI (stored in `localStorage`). The build-time `GEMINI_API_KEY` is NOT used at runtime (see `geminiService.ts:8`).

## Testing

- **Framework**: Vitest with jsdom environment
- **Setup**: `setupTests.ts` imports `@testing-library/jest-dom`
- **Test files**: Co-located with source (e.g., `hooks/useMemories.test.ts`)
- **Run**: `npm run test` (watch mode) or `npx vitest run` (single run)
- **Mocking**: Vitest `vi.mock()` for services; mock IndexedDB, Gemini API

Test files:
- `hooks/useMemories.test.ts` — Memory hook CRUD & retry logic
- `services/googleDriveService.test.ts` — Drive API client tests
- `services/googleAuth.test.ts` — OAuth flow tests
- `services/encryptionService.test.ts` — Encryption/decryption tests
- `services/storageService.test.ts` — IndexedDB storage tests
- `context/SyncContext.test.tsx` — Sync state management tests

## Pre-commit Hooks

The project uses Husky + lint-staged for pre-commit checks:

```json
"lint-staged": {
  "*.{ts,tsx}": ["bash -c 'tsc --noEmit'"]
}
```

This runs TypeScript type checking on staged files before each commit.

## Deployment

### Firebase Hosting (default)

Build output in `dist/` is deployed with SPA rewrites configured in `firebase.json`.

### Docker / Cloud Run

```bash
# Multi-stage build: node:20-alpine → nginx:alpine
docker build \
  --build-arg VITE_GOOGLE_CLIENT_ID=... \
  --build-arg VITE_GOOGLE_CLIENT_SECRET=... \
  -t saveitforl8r .

# Serves on port 8080 via nginx
```

Cloud Build pipeline defined in `cloudbuild.yaml`; deployment script in `deploy-cloud-run.sh`.

### Native Apps (Capacitor)

The `android/` and `ios/` directories contain Capacitor-based native app projects. These wrap the PWA for distribution on app stores.

## Security Considerations

- **Encryption at rest**: All memories encrypted with AES-GCM (256-bit) before IndexedDB storage
- **OAuth PKCE**: Secure auth flow without client secret exposure in browser
- **No server-side storage**: Data lives in user's IndexedDB + their own Google Drive
- **API keys**: User-provided Gemini key stored in `localStorage` (never sent to any server except Google's API)
- **Sensitive files**: `.env` files are gitignored; never commit credentials
- **Web Worker isolation**: ML model runs in separate thread, limiting main thread access

## Common Development Tasks

### Adding a new memory field
1. Add the field to the `Memory` interface in `types.ts`
2. Update `storageService.ts` for IndexedDB serialization (handle encryption/decryption)
3. Update `geminiService.ts` enrichment schema if AI should populate it
4. Update `MemoryCard.tsx` to display it
5. Update `NewMemoryPage.tsx` if user-editable
6. Update sync logic in `SyncContext.tsx` if it should sync

### Adding a new component
1. Create `components/NewComponent.tsx` (PascalCase)
2. Use Tailwind classes for styling
3. Import and compose in `App.tsx` or parent component
4. Wrap with `ErrorBoundary` if component may throw
5. Add analytics events in `constants.ts` if user-facing

### Adding a new service
1. Create `services/newService.ts` (camelCase)
2. Keep it stateless — accept params, return results
3. Create a corresponding hook in `hooks/` if it needs React state integration

### Adding analytics events
1. Define event constants in `constants.ts` under `ANALYTICS_EVENTS`
2. Call `logEvent(category, action, label?)` from `services/analytics.ts`

### Modifying the RAG pipeline
1. **Text extraction**: Update `fileProcessor.ts` for new file types
2. **Embedding model**: Update model name in `embedding.worker.ts` (check dimensions match Orama schema)
3. **Vector storage**: Update `db.ts` schema if adding new fields
4. **Search logic**: Update `useAdaptiveSearch.ts` for new search modes

### Debugging offline search
1. Check model status via `useAdaptiveSearch.modelStatus` ('idle' | 'downloading' | 'loading' | 'ready' | 'error')
2. Check `embeddingStats` for processing queue status (pending, failed, completed)
3. Worker errors logged to console with `[RAG]` prefix
4. Model cache stored in browser's Cache API under 'transformers-cache'
