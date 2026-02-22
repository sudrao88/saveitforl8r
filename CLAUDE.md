# CLAUDE.md — AI Assistant Guide for SaveItForL8R

## Project Overview

SaveItForL8R is a **Progressive Web App (PWA)** — a "personal second brain" for capturing, organizing, and recalling memories with AI assistance. Users save text, images, and files which are enriched by Google Gemini, stored locally with encryption, and optionally synced to Google Drive.

## Tech Stack

- **Language**: TypeScript (strict, ES2022 target)
- **Framework**: React 19 with functional components and hooks
- **Build Tool**: Vite 6
- **Styling**: Tailwind CSS 4 (utility-first, dark theme default)
- **AI**: Google Gemini API (`@google/genai`) via a secure server proxy
- **Auth**: Google OAuth 2.0 with PKCE
- **Cloud Storage**: Google Drive (appDataFolder)
- **Local Storage**: IndexedDB with AES-GCM encryption
- **Testing**: Vitest + React Testing Library
- **Deployment**: Docker + Nginx → Google Cloud Run

## Commands

```bash
npm run dev       # Start dev server (port 9000)
npm run build     # Production build → dist/
npm run preview   # Preview production build locally
npm run test      # Run tests with Vitest
```

## Project Structure
(omitted for brevity)

## Architecture
(omitted for brevity)

## Code Conventions
(omitted for brevity)

## Environment Variables

The client-side React application uses Vite to inject environment variables at build time. The server-side proxy uses standard Node.js environment variables.

### Client-Side (Vite)

| Variable                | Purpose                | Where Set           |
|-------------------------|------------------------|---------------------|
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID | `.env` / Docker ARG |
| `VITE_PROXY_URL`        | URL of the backend proxy | `.env` / Docker ARG |

### Server-Side (Node.js)

| Variable          | Purpose                | Where Set           |
|-------------------|------------------------|---------------------|
| `GEMINI_API_KEY`  | Gemini API key         | Secret Manager      |
| `GOOGLE_CLIENT_ID`| Google OAuth client ID | Secret Manager      |
| `ALLOWED_ORIGINS` | CORS allowed origins   | Cloud Run variable  |
| `PORT`            | Server port            | Cloud Run managed   |

**Important**: The `GEMINI_API_KEY` is **never** exposed to the client. The React app makes requests to the secure server proxy, which then authenticates the user and attaches the API key to requests sent to Google's Gemini API.

## Testing
(omitted for brevity)

## Deployment
(omitted for brevity)

## Security Considerations

- **Encryption at rest**: All memories encrypted with AES-GCM (256-bit) before IndexedDB storage.
- **OAuth PKCE**: Secure auth flow without client secret exposure in browser.
- **Server-Side API Key**: The `GEMINI_API_KEY` is stored securely in Google Secret Manager and only accessible by the server-side proxy, never the client.
- **Authentication Proxy**: All AI-related requests are sent to the secure server proxy, which validates the user's Google OAuth token before proceeding. This prevents anonymous API abuse. Validated tokens are cached for 5 minutes server-side to reduce latency.
- **CORS**: The proxy server restricts origins via the `ALLOWED_ORIGINS` environment variable. Only explicitly listed origins can make cross-origin requests.
- **Rate Limiting**: Per-user rate limits are enforced on both `/api/enrich` (20/min) and `/api/query` (10/min) endpoints to prevent API abuse.
- **Input Validation**: All proxy endpoints validate request payloads (text length, attachment count/size/MIME type, tag limits, coordinate ranges) before processing.
- **Prompt Injection Mitigation**: System instructions are separated from user content using Gemini's `systemInstruction` config. User inputs are sanitized (control characters stripped) before embedding in prompts.
- **Security Headers**: The proxy uses `helmet` for HTTP security headers. Nginx adds `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy`.
- **Docker**: Containers run as non-root users. Builds use `npm ci` for deterministic dependency resolution.
- **Sensitive files**: `.env` files are gitignored; never commit credentials.

### Accepted Risks

- **Client Secret in Bundle**: `VITE_GOOGLE_CLIENT_SECRET` is embedded in the client-side JavaScript at build time. This is an accepted risk because Google treats web client secrets as non-confidential when used with PKCE. The secret alone cannot be used to impersonate users. A future Backend-for-Frontend (BFF) refactor could move token exchange to the proxy server.
- **Query Endpoint Privacy**: The `/api/query` endpoint requires decrypted memories to be sent to the server for AI-powered search. The proxy temporarily has access to plaintext content during request processing. This is architecturally necessary for the feature.

## Common Development Tasks
(omitted for brevity)
