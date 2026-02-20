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
- **Authentication Proxy**: All AI-related requests are sent to the secure server proxy, which validates the user's Google OAuth token before proceeding. This prevents anonymous API abuse.
- **Sensitive files**: `.env` files are gitignored; never commit credentials.

## Common Development Tasks
(omitted for brevity)
