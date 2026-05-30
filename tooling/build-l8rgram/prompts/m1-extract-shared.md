# M1 — Extract `@l8r/shared`

## Goal
Move the genuinely-shared plumbing into `packages/shared` (consumed as TS source via an `exports` map), parametrize OAuth config, and namespace token/IDB storage so two PWAs can coexist. **saveitforl8r behavior unchanged.**

## In scope
1. Create `packages/shared/` as workspace `@l8r/shared`.
2. Move the files in the table below.
3. Rewrite saveitforl8r importers of those files to `@l8r/shared/*`.
4. Add `configureGoogleAuth(cfg)` and remove hardcoded scope/client config.
5. Namespace token storage keys + IDB names; add one-time read-migration of saveitforl8r's old unprefixed keys.
6. Add `@l8r/shared` to saveitforl8r's tsconfig `paths` and `vite.config.ts` alias.
7. Extend Tailwind content globs in saveitforl8r to include `packages/shared/src/**` (avoid purge of shared classes).
8. Extract `@theme` blocks from `index.css` into `packages/shared/src/design-system/tokens.css`; saveitforl8r imports it.

## Out of scope
- l8rgram app or its OAuth client.
- Server changes.
- Any new shared files beyond the table below.

## Files to move

| Source (in `apps/saveitforl8r/`) | Destination (in `packages/shared/src/`) | Notes |
|---|---|---|
| `services/pkce.ts` | `auth/pkce.ts` | pure, no edits |
| `services/tokenService.ts` | `auth/tokenService.ts` | **namespace storage keys per app** |
| `services/googleAuth.ts` | `auth/googleAuth.ts` | **parametrize config + scopes** |
| `services/platform.ts` | `platform/platform.ts` | no edits |
| `services/proxyService.ts` | `ai/proxyService.ts` | no edits |
| `services/chunkUploadService.ts` | `ai/chunkUploadService.ts` | no edits |
| `services/encryptionService.ts` | `crypto/encryptionService.ts` | keep `?worker` import |
| `services/encryption.worker.ts` | `crypto/encryption.worker.ts` | move alongside |
| `styles/design-system.ts` | `design-system/design-system.ts` | class strings |
| `@theme` blocks from `index.css` | `design-system/tokens.css` | both default + `[data-theme=light]` |

## Stays in saveitforl8r (do NOT move)
- `services/geminiService.ts`, `services/storageService.ts`, `services/googleDriveService.ts`
- everything in `context/`, `components/`, `hooks/`
- `App.tsx`, `types.ts`, `constants.ts`

## `packages/shared/package.json`
- `"name": "@l8r/shared"`, `"private": true`, `"type": "module"`
- `"exports"` map (consume as TS source — no build step):
  - `"."` → `./src/index.ts` (barrel)
  - `"./auth"` → `./src/auth/index.ts`
  - `"./ai"` → `./src/ai/index.ts`
  - `"./crypto"` → `./src/crypto/index.ts`
  - `"./platform"` → `./src/platform/index.ts`
  - `"./design-system"` → `./src/design-system/design-system.ts`
  - `"./tokens.css"` → `./src/design-system/tokens.css`
- `"peerDependencies"`: react, react-dom, plus anything the moved code imports from third parties (idb, @capacitor/*). Use ranges matching saveitforl8r's current versions.

## Generalize OAuth config
`packages/shared/src/auth/googleAuth.ts` exposes:
```ts
export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  hostedUrl: string;
  deepLinkScheme: string;
  storageNamespace?: string;
  proxyUrl: string;
}
export function configureGoogleAuth(cfg: GoogleAuthConfig): void;
export function getGoogleAuthConfig(): GoogleAuthConfig; // throws if not configured
```
- Remove all hardcoded `clientId`, `clientSecret`, scope strings, `hostedUrl`, `deepLinkScheme` from inside googleAuth/tokenService/pkce.
- saveitforl8r calls `configureGoogleAuth({...})` once at startup (`apps/saveitforl8r/index.tsx`) with its existing values, scope `['https://www.googleapis.com/auth/drive.appdata']`, namespace `'saveitforl8r'`.

## Namespace storage + migration
- `tokenService` reads/writes keys prefixed `${namespace}:` (e.g., `saveitforl8r:access_token`).
- On startup, if `storageNamespace === 'saveitforl8r'` and the new prefixed key is absent but the old unprefixed key exists in localStorage / IndexedDB, migrate it once (copy then delete old).
- Same migration for the encrypted auth DB (`auth_db` → `saveitforl8r:auth_db`).
- Migration is idempotent and crash-safe (write new before delete old).
- Unit test at `packages/shared/src/auth/__tests__/tokenMigration.test.ts` covering:
  - Fresh install (no-op).
  - Old keys present (migrate).
  - Already migrated (no-op).
  - Partial migration crash recovery (old still present, new also present → skip delete is OK, just don't re-copy).

## saveitforl8r tsconfig + vite
- `apps/saveitforl8r/tsconfig.json`: add `"paths": { "@l8r/shared": ["../../packages/shared/src"], "@l8r/shared/*": ["../../packages/shared/src/*"] }`.
- `apps/saveitforl8r/vite.config.ts`: add `resolve.alias` for the same.
- Extend Tailwind `content` glob to include `../../packages/shared/src/**/*.{ts,tsx,css}`.
- Keep `worker: { format: 'es' }`.

## index.css refactor
- Move `@theme` blocks (default + `[data-theme=light]`) to `packages/shared/src/design-system/tokens.css`.
- saveitforl8r's `index.css` becomes:
  ```css
  @import "tailwindcss";
  @import "@l8r/shared/tokens.css";
  /* any saveitforl8r-specific overrides remain */
  ```

## Verification (orchestrator runs)
- `npm install` succeeds.
- `npm run build -w saveitforl8r` succeeds.
- `npm test -w saveitforl8r` succeeds (including the new migration unit test).
- No remaining imports of `services/pkce`, `services/tokenService`, `services/googleAuth`, `services/platform`, `services/proxyService`, `services/chunkUploadService`, `services/encryptionService` from inside `apps/saveitforl8r/`.

## Commit
One commit:
`feat(l8rgram): m1-extract-shared — extract @l8r/shared, parametrize googleAuth, namespace storage`
