# M0 — Workspace scaffold

## Goal
Convert the single-app repo into an npm-workspaces monorepo and relocate the entire saveitforl8r tree into `apps/saveitforl8r/`, with **zero behavior change**. Drop the unused `@/*` alias.

## In scope
1. Convert root `package.json` to a workspace root.
2. Create `tsconfig.base.json` at the repo root.
3. `git mv` saveitforl8r files into `apps/saveitforl8r/`.
4. Create `apps/saveitforl8r/package.json`.
5. Drop the unused `@/*` alias from tsconfig + vite config.
6. Update `cloudbuild.yaml` paths to point to the new location (without changing services yet).
7. Update `CLAUDE.md`'s Commands and Project Structure sections to reflect new paths.
8. Create `docs/l8rgram-setup-checklist.md` with the post-build manual steps.

## Out of scope
- Creating `packages/shared` (that's M1).
- Creating `apps/l8rgram` (that's M2b).
- Server changes (server stays at `server/` — only its package.json gets listed as a workspace).
- Touching files inside the saveitforl8r tree beyond moving them and the alias removal.
- ESLint config refactor (defer to M1).

## Files & directories to `git mv` into `apps/saveitforl8r/`
Move as a unit so `../` imports keep resolving:
- `App.tsx`
- `index.html`, `index.tsx`, `index.css`
- `vite.config.ts`, `vite-env.d.ts`
- `tsconfig.json`, `tsconfig.node.json`
- `capacitor.config.ts`
- `postcss.config.js`
- `setupTests.ts`
- `types.ts`, `constants.ts`
- `metadata.json`
- `Dockerfile`, `nginx.conf`, `.dockerignore`
- `firebase.json`
- `deploy-cloud-run.sh`, `deploy-stage-run.sh`, `setup-firestore.sh`, `setup-stage-lb.sh`
- `components/`, `context/`, `hooks/`, `services/`, `styles/`, `utils/`, `public/`
- `android/`, `ios/`
- `scripts/`  ← the EXISTING `scripts/` dir (saveitforl8r ops scripts).
  **Do NOT touch `tooling/build-l8rgram/` — monorepo tooling, stays at the root.**
- `eslint.config.js` ← move; root keeps `eslint-rules/` and gets a fresh minimal config in M1.
- `dist/` — DELETE (build artifact, not source).
- `node_modules_old/` — DELETE (stale, see git status).

## Stays at the repo root
- `package.json` (rewrite as workspace root)
- `package-lock.json` (let `npm install` regenerate)
- `tsconfig.base.json` (NEW)
- `cloudbuild.yaml`
- `README.md`, `CLAUDE.md`
- `.gitignore`, `.gcloudignore`
- `.husky/`, `.vscode/`, `.idea/`, `.idx/`, `.claude/`
- `eslint-rules/` (shared dev-only rule)
- `docs/`
- `server/`
- `tooling/`
- `node_modules/` (will regenerate)

## Root `package.json` (after)
- `"private": true`
- `"workspaces": ["apps/*", "packages/*", "server"]`
- Strip runtime deps (react, capacitor, etc.) — they move into `apps/saveitforl8r/package.json`.
- Keep at root only shared dev tooling: `eslint`, `typescript`, the `eslint-rules` wiring, `husky` if present.
- Scripts delegate to the saveitforl8r workspace (back-compat for muscle memory):
  - `"dev": "npm run dev -w saveitforl8r"`
  - `"build": "npm run build -w saveitforl8r"`
  - `"preview": "npm run preview -w saveitforl8r"`
  - `"test": "npm run test -w saveitforl8r"`
  - `"lint": "eslint apps/**/*.{ts,tsx} packages/**/*.{ts,tsx}"`

## `apps/saveitforl8r/package.json` (new)
- `"name": "saveitforl8r"`, `"private": true`, `"version": "0.1.0"`, `"type": "module"`
- `scripts`: `dev`, `build`, `preview`, `test` mirroring the current root scripts (vite + vitest).
- `dependencies` + `devDependencies`: copied from the current root `package.json` minus the dev tooling that stays at root.

## `tsconfig.base.json` (new)
- Extract `compilerOptions` from the current `tsconfig.json` that are not project-specific.
- `apps/saveitforl8r/tsconfig.json` becomes:
  ```json
  { "extends": "../../tsconfig.base.json", "include": [...], "exclude": [...] }
  ```
- **Drop the `@/*` alias** entirely (0 usages confirmed in the codebase).

## `apps/saveitforl8r/vite.config.ts`
- Drop the `@/*` alias.
- Otherwise unchanged.

## `cloudbuild.yaml`
- Update any paths referencing `Dockerfile`, `nginx.conf`, etc., to their new `apps/saveitforl8r/` locations.
- Do NOT add l8rgram-client services yet (M6).

## `CLAUDE.md`
- Update Commands section: keep `npm run dev` (delegates); document `npm run dev -w saveitforl8r` form.
- Update Project Structure: note the monorepo layout (apps/, packages/ planned, server/).

## `docs/l8rgram-setup-checklist.md` (new)
Create with this exact content:

```
# l8rgram setup checklist

Run after `tooling/build-l8rgram/run.sh` completes.

## GCP / OAuth
- [ ] Create a second OAuth 2.0 Web client in the GCP console.
- [ ] Add the l8rgram production origin to authorized JavaScript origins.
- [ ] Add the l8rgram deep-link scheme to authorized redirect URIs.
- [ ] Submit `https://www.googleapis.com/auth/calendar.readonly` for Google verification (sensitive scope).

## Environment
- [ ] Fill `apps/l8rgram/.env.l8rgram` with real `VITE_L8RGRAM_GOOGLE_CLIENT_ID` and `VITE_L8RGRAM_GOOGLE_CLIENT_SECRET`.
- [ ] Set Cloud Run server env `GOOGLE_ALLOWED_AUDIENCES=<saveitforl8r-id>,<l8rgram-id>`.
- [ ] Append l8rgram's deployed origin to the server's `ALLOWED_ORIGINS`.

## Deployment (single combined Cloud Run service hosts both apps)
- [ ] Verify `cloudbuild.yaml`'s `saveitforl8r-client` step builds the combined client image from the root `Dockerfile.client` (updated in M6).
- [ ] Add a Cloud Run domain mapping for `l8rgram.com` to the existing `saveitforl8r-client` service: `gcloud beta run domain-mappings create --service=saveitforl8r-client --domain=l8rgram.com --region=<region>` (repeat for `www.l8rgram.com`).
- [ ] Add the DNS records gcloud prints to your DNS provider (A/AAAA for apex, CNAME for www).
- [ ] Run `npx cap sync` from `apps/l8rgram` on each native target.

## Validation
- [ ] Confirm the M2 spike findings against a real device (see `docs/l8rgram-m2-spike.md`).
- [ ] Re-test saveitforl8r end-to-end after deploy (login persistence across the storage namespacing migration in M1).
- [ ] Replace placeholder l8rgram icons under `apps/l8rgram/public/icons/` with real artwork.
```

## Verification (orchestrator runs)
- `npm install` succeeds (workspace install resolves saveitforl8r).
- `npm run build -w saveitforl8r` succeeds.
- `npm test -w saveitforl8r` succeeds.

## Commit
One commit:
`feat(l8rgram): m0-workspace-scaffold — move saveitforl8r into apps/, add npm workspaces, drop @/* alias`
