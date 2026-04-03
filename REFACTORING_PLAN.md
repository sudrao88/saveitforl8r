# Refactoring Plan: Simplify & Streamline SaveItForL8R

## Context

The SaveItForL8R codebase is well-structured overall, but has accumulated duplication and complexity in several areas. The biggest wins come from extracting shared editor logic (1,288 lines across two components with heavy overlap), unifying polling patterns, and decomposing the largest component. All functionality will be preserved — this is purely structural cleanup.

**Actual file sizes (verified):**
- `App.tsx`: 1,209 lines
- `SyncContext.tsx`: 1,286 lines
- `MemoryCard.tsx`: 746 lines
- `NewMemoryPage.tsx`: 717 lines
- `QuickNoteBar.tsx`: 571 lines
- `useMemories.ts`: 472 lines
- `useMoments.ts`: 505 lines
- `useEnrichmentPolling.ts`: 199 lines
- `useMomentCreationPolling.ts`: 207 lines
- `editorUtils.ts`: 664 lines
- `server/services/gemini.js`: 900 lines
- `types.ts`: 293 lines (fine as-is)
- `design-system.ts`: 172 lines (fine as-is)

---

## Phase 1: Extract Shared Editor Hook (`useMemoryEditor`)

**Impact: HIGH — eliminates ~400 lines of duplication**

`NewMemoryPage.tsx` and `QuickNoteBar.tsx` share nearly identical logic:
- Rich text editor state (contentEditable, activeFormats, isEmpty, formatRafRef, prevFormatsRef)
- Checklist mode with duplicated `ChecklistItem` interface (defined in both files AND in `ChecklistItems.tsx` as `ChecklistItemData`)
- Attachment state management
- Tag extraction and management
- Markdown detection/parsing
- Both import the same 12+ functions from `editorUtils.ts`

### Changes

1. **Consolidate `ChecklistItem` type** — Remove local `interface ChecklistItem` from both `NewMemoryPage.tsx` (line 100) and `QuickNoteBar.tsx` (line 31). Import `ChecklistItemData` from `ChecklistItems.tsx` and use it everywhere (or re-export from `types.ts`).

2. **Create `hooks/useMemoryEditor.ts`** (~200-250 lines) containing:
   - `editorRef`, `formatRafRef`, `prevFormatsRef` refs
   - `activeFormats`, `isEmpty`, `isChecklistMode`, `checklistItems` state
   - `attachments`, `tags` state + handlers
   - `showTags`, `showFormatting`, `showAttachMenu` toggle state
   - Format checking logic (the `onInput`/`onSelectionChange` handlers that call `checkActiveFormats`)
   - `handlePaste` logic (both components sanitize pasted HTML identically)
   - `handleEditorKeyDown` wiring
   - `getEditorContent()` — extract text/HTML from editor
   - `resetEditor()` — clear all state
   - `useBeforeInputMarkdown` integration

3. **Simplify `NewMemoryPage.tsx`** (~350 lines, down from 717) — Becomes a full-screen shell that uses `useMemoryEditor` and adds: edit mode logic, location capture, discard confirmation, initial content hydration.

4. **Simplify `QuickNoteBar.tsx`** (~250 lines, down from 571) — Becomes a compact bar that uses `useMemoryEditor` and adds: `forwardRef`/`useImperativeHandle`, save success animation, expand-to-full-page, keyboard height adjustment.

### Files to modify
- Create: `hooks/useMemoryEditor.ts`
- Modify: `components/NewMemoryPage.tsx`, `components/QuickNoteBar.tsx`
- Modify: `components/ChecklistItems.tsx` (export type if not already clean)
- Possibly modify: `types.ts` (if we centralize the ChecklistItem type there)

---

## Phase 2: Extract Generic Polling Hook

**Impact: MEDIUM — eliminates ~150 lines of duplication, improves maintainability**

`useEnrichmentPolling.ts` (199 lines) and `useMomentCreationPolling.ts` (207 lines) implement nearly identical tiered polling:
- Same constants: `FAST_POLL_INTERVAL_MS = 1000`, `SLOW_POLL_INTERVAL_MS = 2000`, `FAST_POLL_TIER_MS = 15000`
- Same `pollingActiveRef` guard pattern
- Same tiered setTimeout loop (fast for 15s, then slow)
- Same `recoverPending` pattern (fetch results, start polling if still processing)

### Changes

1. **Create `hooks/usePolling.ts`** (~80 lines) — Generic tiered polling hook:
   ```ts
   interface UsePollingOptions<T> {
     getPending: () => T[];
     fetchResults: (ids: string[]) => Promise<Record<string, any>>;
     applyResult: (item: T, result: any) => Promise<void>;
     getId: (item: T) => string;
     fastIntervalMs?: number;
     slowIntervalMs?: number;
     fastTierMs?: number;
   }
   // Returns: { startPolling, recoverPending }
   ```

2. **Simplify `useEnrichmentPolling.ts`** (~100 lines) — Keep `applyEnrichmentResult` (domain-specific), use `usePolling` for the loop mechanics.

3. **Simplify `useMomentCreationPolling.ts`** (~110 lines) — Keep `applyMomentResult` (domain-specific), use `usePolling` for the loop mechanics.

### Files to modify
- Create: `hooks/usePolling.ts`
- Modify: `hooks/useEnrichmentPolling.ts`, `hooks/useMomentCreationPolling.ts`

---

## Phase 3: Decompose MemoryCard

**Impact: MEDIUM — improves readability and testability of a 746-line component**

`MemoryCard.tsx` handles: content display, enrichment rendering for 18+ content types (with a 180-line `SECTION_CONFIG_MAP`), menu actions, sync status, expand/collapse, and more.

### Changes

1. **Extract `components/enrichmentConfig.ts`** — Move `SECTION_CONFIG_MAP` (the ~180-line config object mapping content types to their icons, colors, and section definitions) to its own file.

2. **Extract `components/EnrichmentContent.tsx`** (~120 lines) — Move `EnrichmentSection` and `EnrichmentDetail` (currently inlined at top of MemoryCard) plus the enrichment rendering logic (the large block that reads `SECTION_CONFIG_MAP` and renders sections).

3. **Extract `components/MemoryCardMenu.tsx`** (~80 lines) — The three-dot menu with pin/edit/delete/download actions and the delete confirmation dialog.

4. **Simplify `MemoryCard.tsx`** (~350 lines, down from 746) — Composes the extracted sub-components.

### Files to modify
- Create: `components/enrichmentConfig.ts`, `components/EnrichmentContent.tsx`, `components/MemoryCardMenu.tsx`
- Modify: `components/MemoryCard.tsx`

---

## Phase 4: Reduce Callback Wiring in App.tsx

**Impact: MEDIUM — simplifies the most complex file in the codebase**

`App.tsx` lines 175-221 contain 8 `useEffect` blocks that do nothing but wire callbacks between hooks (`setMomentsRef`, `setOnNoteMatchedMoments`, `setOnEnrichmentCompleteCalendar`, etc.). These are a fragile "pub/sub via refs" pattern.

### Changes

1. **Create `hooks/useEnrichmentCallbacks.ts`** (~40 lines) — A single hook that accepts the various handler functions and wires them together, replacing the 8 `useEffect` blocks in App.tsx. This is a straightforward extraction, not a new abstraction.

2. **Create `context/MemoryActionsContext.tsx`** (~30 lines) — Provides `onViewAttachment`, `onDelete`, `onEdit`, `onTogglePin` via context instead of passing them as props to 6+ components (`MemoryCard` in timeline, search results, chat, moments, etc.).

3. **Simplify `App.tsx`** — Remove the 8 wiring useEffects (replaced by hook), remove repeated callback props (replaced by context).

### Files to modify
- Create: `hooks/useEnrichmentCallbacks.ts`, `context/MemoryActionsContext.tsx`
- Modify: `App.tsx`, `components/MemoryCard.tsx`, `components/ChatInterface.tsx`, and other components that receive the 4 callback props

---

## Phase 5: Split editorUtils.ts

**Impact: LOW-MEDIUM — improves navigability of a 664-line utility file**

`editorUtils.ts` mixes: HTML sanitization, markdown detection, checklist parsing, URL linkification, editor key handling, and format commands.

### Changes

Split into 3 focused modules:
1. **`utils/htmlUtils.ts`** — `escapeHtml`, `sanitizePastedHtml`, `hasRichFormatting`, `linkifyUrls`
2. **`utils/markdownUtils.ts`** — `looksLikeMarkdown`, `parseChecklistMarkdown`
3. **`utils/editorCommands.ts`** — `handleEditorKeyDown`, `checkActiveFormats`, `execFormatCommand`, `formatsEqual`, `isEditorEmpty`
4. **`utils/editorUtils.ts`** — Becomes a barrel re-export file so existing imports don't break.

### Files to modify
- Create: `utils/htmlUtils.ts`, `utils/markdownUtils.ts`, `utils/editorCommands.ts`
- Modify: `utils/editorUtils.ts` (becomes re-export barrel)
- No other files need to change (barrel preserves import paths)

---

## What We're NOT Doing (and Why)

- **Not splitting `types.ts`** (293 lines) — It's already a reasonable size.
- **Not splitting `design-system.ts`** (172 lines) — It's already compact.
- **Not splitting `SyncContext.tsx`** (1,286 lines) — Complex but cohesive; splitting would fragment sync logic.
- **Not adding a state management library** — The hook-based approach works; we're just cleaning up the wiring.
- **Not consolidating IndexedDB implementations** — Each DB serves a different purpose with different schemas; unifying would add complexity.
- **Not refactoring server code** (`gemini.js` at 900 lines) — Server-side is out of the main refactoring scope and works fine.

---

## Verification Plan

After each phase:
1. Run `npm run build` — ensure no TypeScript/build errors
2. Run `npm run test` — ensure all existing tests pass
3. Run `npx eslint components/ App.tsx` — ensure design system rules pass
4. Verify import paths are correct (barrel re-exports where needed)

Final verification:
- Manual smoke test: create a memory via QuickNoteBar, create via NewMemoryPage, verify enrichment polling works, verify moment creation polling works, verify MemoryCard renders enrichments correctly
