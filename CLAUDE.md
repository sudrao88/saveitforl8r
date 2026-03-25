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

## Design System

All UI components must follow these design standards. The source of truth is:
- **Tokens**: `index.css` `@theme` block (CSS custom properties)
- **Style constants**: `styles/design-system.ts` (reusable class strings)

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--color-surface-base` | `#000000` | App background |
| `--color-surface-raised` | `#1f2937` | Cards, inputs, elevated surfaces |
| `--color-surface-overlay` | `#030712` | Modals, sheets, overlays |
| `--color-border-default` | `#374151` | Standard borders |
| `--color-border-subtle` | `rgba(55,65,81,0.3)` | Card borders, subtle dividers |
| `--color-text-primary` | `#f3f4f6` | Headings, primary text |
| `--color-text-secondary` | `#9ca3af` | Body text, secondary labels |
| `--color-text-tertiary` | `#6b7280` | Captions, timestamps, muted text |
| `--color-accent` | `#2563eb` | Primary actions, links, active states |
| `--color-accent-hover` | `#3b82f6` | Hover state for accent |
| `--color-accent-muted` | `rgba(37,99,235,0.2)` | Accent backgrounds |
| `--color-danger` | `#dc2626` | Delete, errors |
| `--color-success` | `#22c55e` | Success states |
| `--color-warning` | `#f59e0b` | Warnings |

Content-specific colors (enrichment icons, status badges) may use Tailwind palette colors directly, but core UI surfaces and text must use semantic tokens.

### Typography

Allowed text sizes: `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`, `text-3xl`. **Never use arbitrary values** like `text-[10px]` or `text-[11px]` — use `text-xs` instead.

### Spacing

Preferred scale: `1`, `1.5`, `2`, `3`, `4`, `6`, `8`. Avoid `2.5` except for button padding (`py-2.5`).

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `0.375rem` | Chips, tags, small badges |
| `--radius-md` | `0.5rem` | List items, inline elements |
| `--radius-lg` | `0.75rem` | Buttons, inputs |
| `--radius-xl` | `1rem` | Cards, modals, sheets |
| `--radius-full` | `9999px` | Pills, avatars, circular buttons |

### Z-Index Layers

| Token | Value | Usage |
|-------|-------|-------|
| `--z-sticky` | `10` | Sticky headers, toolbars |
| `--z-dropdown` | `30` | Dropdowns, popovers |
| `--z-overlay` | `50` | Lightweight overlays, install bars |
| `--z-modal` | `60` | Modal dialogs |
| `--z-sheet` | `70` | Full-screen sheets, chat |
| `--z-toast` | `80` | Toast notifications |
| `--z-tooltip` | `90` | Tooltips |

**Never use arbitrary z-index values** like `z-[55]` or `z-[9999]`. Always use named tokens.

### Transition Durations

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-fast` | `150ms` | Hover states, color changes |
| `--duration-normal` | `250ms` | Expanding panels, layout shifts |
| `--duration-slow` | `400ms` | Page transitions, complex animations |

### Component Patterns

Import from `styles/design-system.ts`:

```tsx
import { btn, card, overlay, text, chip, menu, zIndex } from '../styles/design-system';
```

- **Buttons**: `${btn.base} ${btn.primary}` / `btn.secondary` / `btn.ghost` / `btn.danger` / `btn.icon`
- **Cards**: `card.base` / `card.interactive` / `card.elevated`
- **Inputs**: `input.base` / `input.textarea`
- **Sheets**: `overlay.sheet` + `overlay.sheetHeader` + `overlay.closeBtn`
- **Modals**: `overlay.dialogBackdrop` + `overlay.modal`
- **Menus**: `menu.panel` + `menu.item` / `menu.itemDanger`
- **Chips**: `${chip.base} ${chip.active}` / `chip.inactive`
- **Typography**: `text.heading` / `text.subheading` / `text.body` / `text.caption` / `text.label`

### Rules

1. **Always import** from `styles/design-system.ts` for standard component patterns
2. **Never introduce new color values** without adding them as tokens in `@theme`
3. **Never use arbitrary z-index** — use named `--z-*` tokens
4. **Never use arbitrary text sizes** — use Tailwind's default scale
5. **Use semantic border-radius tokens**, not ad-hoc `rounded-*` values
6. **Prefer duration tokens** (`--duration-fast`, `--duration-normal`, `--duration-slow`) over arbitrary durations
7. **Enrichment/content-type colors** (in `SECTION_CONFIG_MAP`) are exempt from token rules — they use Tailwind palette for variety
8. **All UI changes must use semantic tokens** (`--color-*`, `--radius-*`, `--duration-*`, `--z-*`) instead of raw Tailwind color/radius/duration/z-index values. This applies to every component, not just new ones — when touching existing code, migrate any raw values to tokens.

## Pull Request Policy

When creating a pull request, always set the **base branch** to the branch from which the current feature branch was originally created — not necessarily `master`. To determine the parent branch, use:

```bash
git log --decorate --oneline --all | grep "$(git rev-parse --short HEAD~10)..$(git rev-parse --short HEAD)" || true
```

Or more reliably, check which branch the current branch was forked from:

```bash
git log --oneline --first-parent master..HEAD
git log --oneline --first-parent <candidate-branch>..HEAD
```

Pick the base branch that yields the shortest history (i.e., the most recent common ancestor). If the branch was created from `master`, use `master`. If it was created from another feature branch, use that feature branch as the PR base.

## Common Development Tasks
(omitted for brevity)
