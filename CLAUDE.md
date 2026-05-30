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

This is an **npm-workspaces monorepo**. The root scripts delegate to the
`saveitforl8r` workspace, so the familiar commands still work from the repo root:

```bash
npm install       # Install all workspaces (run once from the repo root)
npm run dev       # Start dev server (port 9000) — delegates to -w saveitforl8r
npm run build     # Production build → apps/saveitforl8r/dist/
npm run preview   # Preview production build locally
npm run test      # Run tests with Vitest
```

You can also target a workspace explicitly (this is what the build orchestrator uses):

```bash
npm run dev   -w saveitforl8r
npm run build -w saveitforl8r
npm run test  -w saveitforl8r
```

## Project Structure

Monorepo managed with npm workspaces (`"workspaces": ["apps/*", "packages/*", "server"]`):

```
/ (root)
  package.json            # workspace root: shared dev tooling + delegating scripts
  tsconfig.base.json      # shared compilerOptions (apps extend this)
  cloudbuild.yaml         # CI/CD for Cloud Run
  eslint-rules/           # shared dev-only custom lint rule (no-raw-tailwind-colors)
  docs/                   # specs + checklists (l8rgram-spec.md, l8rgram-setup-checklist.md)
  tooling/build-l8rgram/  # the l8rgram split build orchestrator (stays at root)
  apps/
    saveitforl8r/         # the existing app — entire former-root tree lives here now
                          # (App.tsx, components/, context/, hooks/, services/, styles/,
                          #  utils/, public/, android/, ios/, scripts/, vite.config.ts,
                          #  tsconfig.json, Dockerfile, nginx.conf, capacitor.config.ts, …)
    l8rgram/              # NEW native gallery app (added in M2b — not present yet)
  packages/
    shared/               # @l8r/shared — extracted auth/ai/crypto/design-system (added in M1)
  server/                 # Express proxy (own package.json + Dockerfile, joins the workspace)
```

> M0 of the l8rgram split moved the single-app tree into `apps/saveitforl8r/`
> with zero behavior change. `packages/shared` (M1) and `apps/l8rgram` (M2b)
> are added by later phases — see `docs/l8rgram-spec.md`.

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

### Attachment Limits

Three thresholds bound per-note attachment payloads. Keep them in sync when changing any one.

- **Count**: `MAX_ATTACHMENTS = 20` per note. Client: `utils/attachmentUtils.ts`. Server: `server/middleware/validation.js` (rejects with `400` beyond the limit).
- **Per-file size cap**: ~52 MB base64 (`validation.js` — `att.data.length > 70_000_000`). Individual chunked upload capped at 55 MB (`validateUploadInit`).
- **Chunked-upload threshold**: 1.2 MB base64 (~900 KB decoded). Attachments above this are pre-uploaded via the Gemini File API and sent as `fileUri` instead of inline bytes. Client: `CHUNKED_UPLOAD_THRESHOLD` in `hooks/useMemories.ts`. Server backstop: `FILE_API_THRESHOLD` in `server/routes/enrich.js`. Worst-case 20 inline attachments ≈ 24 MB, safely under Cloud Run's 32 MB request-body limit.

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
| `--color-surface-hover-subtle` | `rgba(255,255,255,0.05)` | Ghost button hover |
| `--color-surface-hover` | `rgba(255,255,255,0.1)` | Icon button hover |
| `--color-border-default` | `#374151` | Standard borders |
| `--color-border-subtle` | `rgba(55,65,81,0.3)` | Card borders, subtle dividers |
| `--color-text-primary` | `#f3f4f6` | Headings, primary text |
| `--color-text-secondary` | `#9ca3af` | Body text, secondary labels |
| `--color-text-tertiary` | `#6b7280` | Captions, timestamps, muted text |
| `--color-accent` | `#2563eb` | Primary actions, links, active states |
| `--color-accent-hover` | `#3b82f6` | Hover state for accent |
| `--color-accent-muted` | `rgba(37,99,235,0.2)` | Accent backgrounds |
| `--color-danger` | `#dc2626` | Delete, errors |
| `--color-danger-hover` | `#b91c1c` | Hover state for danger |
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
| `--radius-xs` | `0.125rem` | Tiny decorative elements |
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
import { btn, card, overlay, confirm, text, chip, menu, zIndex } from '../styles/design-system';
```

- **Buttons (standard)**: `${btn.base} ${btn.primary}` / `btn.secondary` / `btn.ghost` / `btn.danger`
- **Buttons (compact)**: `${btn.base} ${btn.primarySm}` / `btn.secondarySm` / `btn.dangerSm` / `btn.warningSm`
- **Buttons (outlined)**: `btn.outlinedSm` / `btn.outlinedDangerSm` (includes flex/gap, use directly)
- **Buttons (CTA)**: `${btn.base} ${btn.cta}` (states: `btn.ctaDisabled`, `btn.ctaSuccess`) (circular primary action buttons — save, send)
- **Buttons (icon)**: `btn.icon` / `btn.iconLg`
- **Cards**: `card.base` / `card.interactive` / `card.elevated`
- **Inputs**: `input.base` / `input.textarea`
- **Sheets**: `overlay.sheet` + `overlay.sheetHeader` + `overlay.closeBtn`
- **Modals**: `overlay.dialogBackdrop` + `overlay.modal` + `overlay.closeBtnRight`
- **Gallery/Navigation**: `overlay.navBtn` (for prev/next arrows in viewers)
- **Confirmation dialogs**: `confirm.backdrop` + `confirm.title` + `confirm.message`
- **Menus**: `menu.panel` + `menu.item` / `menu.itemDanger`
- **Chips**: `${chip.base} ${chip.active}` / `chip.inactive`
- **Typography**: `text.heading` / `text.subheading` / `text.body` / `text.caption` / `text.label`

**Button rule**: ALL `<button>` elements must compose from `btn.base` + a variant, `btn.icon`/`btn.iconLg`, `overlay.closeBtn`/`overlay.closeBtnRight`, `menu.item`, or `chip.base`. Never write raw button styles inline. For compact buttons in settings/toolbars, use `btn.primarySm`/`btn.secondarySm`/`btn.dangerSm`/`btn.warningSm`.

### Rules

1. **Always import** from `styles/design-system.ts` for standard component patterns
2. **Never introduce new color values** without adding them as tokens in `@theme`
3. **Never use arbitrary z-index** — use named `--z-*` tokens (e.g. `z-(--z-sticky)` not `z-10`)
4. **Never use arbitrary text sizes** — use Tailwind's default scale
5. **Use semantic border-radius tokens** (e.g. `rounded-(--radius-lg)` not `rounded-lg`)
6. **Use duration tokens** (e.g. `duration-(--duration-fast)` not `duration-150`)
7. **Enrichment/content-type colors** (in `SECTION_CONFIG_MAP`) are exempt from token rules — they use Tailwind palette for variety
8. **All UI changes must use semantic tokens** (`--color-*`, `--radius-*`, `--duration-*`, `--z-*`) instead of raw Tailwind color/radius/duration/z-index values. This applies to every component, not just new ones — when touching existing code, migrate any raw values to tokens.
9. **All buttons must use design system exports** — compose from `btn.base` + variant. Never write raw button styles inline. The ESLint rule `design-system/no-raw-tailwind-colors` enforces token usage at lint time.
10. **ESLint enforcement**: The custom rule in `eslint-rules/no-raw-tailwind-colors.js` catches raw Tailwind colors, raw border-radius, raw durations, raw z-index values, and arbitrary text sizes. Run `npx eslint components/ App.tsx` to verify compliance.

## Pull Request Policy

When creating a pull request, always set the **base branch** to the branch from which the current feature branch was originally created — not necessarily `master`. To determine the parent branch, check which branch the current branch was forked from:

```bash
git log --oneline --first-parent master..HEAD
git log --oneline --first-parent <candidate-branch>..HEAD
```

Pick the base branch that yields the shortest history (i.e., the most recent common ancestor). If the branch was created from `master`, use `master`. If it was created from another feature branch, use that feature branch as the PR base.

After creating a pull request, always use the `subscribe_pr_activity` tool to monitor and respond to review comments, CI status updates, and other PR events.

## Common Development Tasks
(omitted for brevity)
