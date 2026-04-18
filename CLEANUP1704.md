# Cleanup Pass — Fix Gotchas, Remove Cruft

This document is the authoritative cleanup punch list for SaveItForL8R. It is
organized into **7 independent phases** so any single phase can be picked up
in a standalone Claude Code session without needing context from the others.

## Context

SaveItForL8R has accumulated drift: a few real correctness bugs on the server,
orphaned files at the repo root, noisy debug logs left in client production
code, and a handful of silent error-swallowing patterns. This cleanup pass
fixes those concrete issues without touching any of the larger structural
refactors (shared editor hook, `MemoryCard` decomposition, generic polling
hook, etc.) — those are separate work. The goal here is a clean, executable
punch list that leaves the codebase measurably tighter with zero behavior
changes.

Phases share no ordering dependencies except that **Phase 7 (verification)**
runs last within whatever slice of phases a given session executes.

---

## ✅ Phase 1 — Server correctness fixes

**Goal**: Fix real server-side bugs. Smallest, highest-signal changes.

### 1a. Add missing `crypto` import in `server/routes/moment.js`

- **File**: `server/routes/moment.js` (top-of-file imports, around line 17).
- **Issue**: Line 365 calls `crypto.randomUUID()` but the module has no
  `import crypto from 'crypto'`. Every other server file that uses it
  imports it (`server/index.js:13`, `server/routes/push.js:6`,
  `server/routes/upload.js:16`, `server/middleware/auth.js:5`). It happens
  to work today because Node 20 exposes `crypto` as a global, but the
  omission is inconsistent and fragile.
- **Fix**: Add `import crypto from 'crypto';` alongside the other imports.

### 1b. Add ownership check to `persistEnrichmentResult`

- **File**: `server/routes/enrich.js:129-142`.
- **Issue**: `persistEnrichmentResult()` writes to the Firestore enrichment
  collection keyed by `memoryId` without verifying that any existing
  document belongs to the authenticated user. A second authenticated user
  who knows/guesses a `memoryId` could overwrite the result.
- **Pattern to mirror**: `persistSynthesisResult` in
  `server/index.js:302-326` already does this check (reads doc, compares
  `userId`, warns and returns on mismatch). Apply the same read-then-write
  guard to `persistEnrichmentResult`, and make the function `async`
  (current signature is fire-and-forget; all callers should be adjusted
  accordingly — a detached `.catch()` on the promise is fine).
- **Verification**: manual test (two auth tokens, same `memoryId`) that
  user B's attempt logs a warning and does not mutate the doc.

### 1c. Reuse `UUID_REGEX` in `server/routes/moment.js` validators

- **File**: `server/routes/moment.js:333, 350`.
- **Issue**: Both `validateCreateInput` and `validateResultsInput` inline
  the same UUID regex. `UUID_REGEX` is already exported from
  `server/middleware/validation.js:15`.
- **Fix**: Import `UUID_REGEX` and replace the two inline regex literals.

---

## ✅ Phase 2 — Client polling unmount-safety

**Goal**: Stop the two polling hooks from continuing after their host
unmounts.

- **Files**:
  - `hooks/useEnrichmentPolling.ts:116-160`
  - `hooks/useMomentCreationPolling.ts` (same pattern, lines ~120-176)
- **Issue**: Both hooks use a recursive `setTimeout(poll, …)` chain gated
  by a `pollingActiveRef`, but nothing flips that ref to `false` on
  unmount. If the host component unmounts mid-poll, the next tick still
  fires, runs `await fetchPendingEnrichments(…)`, and calls
  `setMemories`/`setMoments` — wasted work plus React warnings.
- **Fix**: Add
  `useEffect(() => () => { pollingActiveRef.current = false; }, []);`
  inside each hook. The existing
  `if (!pollingActiveRef.current) return;` guard at the top of `poll`
  short-circuits cleanly. Capturing the `setTimeout` id is unnecessary
  because the guard already blocks the next iteration.

---

## ✅ Phase 3 — Silent error-swallowing fixes

**Goal**: Keep best-effort flows intact but leave a diagnostic trail.

- **File**: `services/storageService.ts:767, 769` inside `factoryReset`.
- **Issue**: `try { db.close(); } catch (e) {}` and
  `try { cachedDB?.close(); cachedDB = null; } catch (e) {}` swallow
  errors silently. The best-effort intent is correct; the silence is not.
- **Fix**: Replace each empty catch with
  `catch (e) { console.warn('[FactoryReset] close failed (non-fatal):', e); }`.
  Do not rethrow.

---

## ✅ Phase 4 — Strip client debug `console.log` calls

**Goal**: Remove pure debug/trace logs from production client bundles.
Keep `console.error` and `console.warn` (they have diagnostic value in
production).

- **In scope (client TypeScript only)**:
  - `App.tsx` — e.g. lines 367, 416 (native auth debug, sync retry trace).
  - `hooks/useMemories.ts` — e.g. lines 102, 121, 187, 310, 487, 541, 548, 555.
  - `context/SyncContext.tsx` — e.g. lines 430, 848, 908, 915, 928, 974, 977.
- **Rule**:
  - Remove plain `console.log` debug/trace lines.
  - Keep every `console.error` and `console.warn`.
  - Keep any `console.log` inside a `catch` block or guarding error-style
    messages — convert those to `console.warn` if they convey failure.
- **Out of scope**: server-side code, `scripts/*`, `public/sw.js`,
  `index.html`, service worker registration logs.

---

## ✅ Phase 5 — Delete orphaned files at repo root

**Goal**: Remove verified-unreferenced files.

- **Files to delete** (confirmed: zero matches anywhere in repo via grep):
  - `actual-font.ttf`
  - `correct_font.ttf`
  - `real-shantell.ttf`
  - `font_base64.txt`
- The live font chain uses `public/ShantellSans-*.woff2`, referenced from
  `index.css` and `index.html`. The root-level TTFs and the base64 dump
  are leftover experimentation and are safe to remove.
- **Verification**: after deletion, `npm run build` still succeeds; grep
  for the four filenames across the repo returns empty.

---

## ✅ Phase 6 — Delete historical planning docs

**Goal**: Remove stale planning docs per user direction.

- **Files to delete**: `PERFORMANCE_AUDIT.md`, `REFACTORING_PLAN.md`.
- Both contain recommendations that are either already addressed or
  superseded. Git history preserves the content if ever needed.
- Note: `CLEANUP1704.md` (this file) is the authoritative remaining
  cleanup document.

---

## Phase 7 — Verification

Run **after** all phases above that were executed in this session (or as
a final cross-session pass).

1. **Typecheck + build**: `npm run build` from repo root — must succeed.
2. **Lint**: `npm run lint` — must stay green.
3. **Tests**: `npm run test` — must stay green.
4. **Server smoke**: from `server/`, `npm start`, then
   - `POST /api/moment/` with a valid auth token → expect `202/200` with
     `momentId` (confirms `crypto.randomUUID()` resolves).
   - `POST /api/enrich/` as user A, then as user B with the same
     `memoryId` → expect user B's write to be rejected with a warning
     log (ownership guard).
5. **Client smoke**: `npm run dev`, create a memory, let enrichment run
   to completion. Navigate away mid-enrichment on a second memory and
   confirm no `setState on unmounted component` warnings in console.
6. **Repo hygiene**: `git status` shows only expected deletions/edits;
   grep for the four deleted font filenames and the two deleted planning
   docs returns empty.

---

## Critical files touched

| Phase | File | Change |
|---|---|---|
| 1a | `server/routes/moment.js` | Add `crypto` import |
| 1b | `server/routes/enrich.js` | Ownership guard on `persistEnrichmentResult` |
| 1c | `server/routes/moment.js` | Reuse `UUID_REGEX` from middleware |
| 2 | `hooks/useEnrichmentPolling.ts` | Unmount cleanup effect |
| 2 | `hooks/useMomentCreationPolling.ts` | Unmount cleanup effect |
| 3 | `services/storageService.ts` | `console.warn` in `factoryReset` catches |
| 4 | `App.tsx`, `hooks/useMemories.ts`, `context/SyncContext.tsx` | Strip debug logs |
| 5 | Repo root | Delete 4 orphan font/base64 files |
| 6 | Repo root | Delete `PERFORMANCE_AUDIT.md`, `REFACTORING_PLAN.md` |

---

## Out of scope (intentionally not touched in this pass)

- Any item catalogued in `REFACTORING_PLAN.md` (extract `useMemoryEditor`,
  split `MemoryCard`, generic `usePolling` hook, `editorUtils.ts` split).
  Those are structured refactors, not cleanup. (Note: `REFACTORING_PLAN.md`
  itself is deleted in Phase 6 — refer to git history if needed.)
- Broad `any` → specific-type sweeps.
- `React.memo` additions or component memoization strategy.
- Design-system token migration (enforced by ESLint separately).
- Server `geminiRetry` utility extraction.

---

## Session-handoff protocol

When a Claude Code session picks up any phase:

1. Read `CLEANUP1704.md` at repo root.
2. Confirm branch is `claude/cleanup-codebase-bdRlx` (or reconfirm with
   the user).
3. Execute only the phase(s) requested. Each phase is self-contained.
4. After edits, run **Phase 7** verification scoped to the files touched.
5. Commit with a message like `cleanup: phase N — <short summary>`.
6. Tick the phase off by editing `CLEANUP1704.md` and adding a ✅ prefix
   to the phase heading. Commit that edit with the fix commit.
