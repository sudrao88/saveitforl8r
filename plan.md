# Todo Feedback System — Implementation Plan

## Problem
1. Users can't dismiss AI-detected todo items they don't want
2. On re-enrichment, dismissed/completed items get recreated because the AI re-detects them

## Design Decisions (per user input)
- Dismissals are **recoverable** (shown in a "Dismissed" group)
- **Completed items are also protected** from re-creation on re-enrichment

---

## 1. Data Model Changes

### `types.ts` — Add `isDismissed` and `dismissedAt` to `TodoItem`

```ts
export interface TodoItem {
  // ... existing fields ...
  isDismissed?: boolean;       // User explicitly rejected this item
  dismissedAt?: number;        // Timestamp when dismissed
}
```

This is the simplest approach — no new IndexedDB stores, no schema migration, and it works seamlessly with the existing Google Drive sync (tombstone pattern already syncs full TodoItem objects).

---

## 2. Preventing Re-creation on Re-enrichment

### Strategy: Normalized title matching against dismissed + completed items

In `useTodoItems.ts` → `processDetectedActionItems()`:

1. Before creating new items, load all existing items for this memory (including soft-deleted ones from the current `replaceTodoItemsForMemory` tombstones)
2. Build a set of **normalized titles** from items that were dismissed (`isDismissed`) or completed (`isCompleted`)
3. Filter out any `detectedActionItems` whose normalized title matches a suppressed title
4. Only create TodoItems from the remaining (non-suppressed) detected items

### Normalization function
```ts
const normalizeTodoTitle = (title: string): string =>
  title.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
```

This handles cases like:
- "Buy groceries" vs "buy groceries" (case)
- "Buy groceries!" vs "Buy groceries" (punctuation)
- "Buy  groceries" vs "Buy groceries" (extra whitespace)

It's intentionally not fuzzy — "Buy groceries" and "Buy groceries this weekend" are different items. The AI will typically produce very similar titles for the same action item across re-enrichments. If needed, fuzzy matching can be added later.

### Flow change in `replaceTodoItemsForMemory`

Currently: soft-deletes ALL old items, inserts ALL new items.

New behavior:
- **Dismissed items**: Preserved as-is (not tombstoned, not replaced). They stay dismissed.
- **Completed items**: Preserved as-is (not tombstoned, not replaced). They stay completed.
- **Active (non-dismissed, non-completed) items**: Tombstoned and replaced as before.
- **New detected items**: Filtered against dismissed/completed titles before creation.

This means `replaceTodoItemsForMemory` needs to be updated, or the filtering logic needs to happen in `processDetectedActionItems` before calling it.

**Recommended**: Do the filtering in `processDetectedActionItems` (hook layer) and change `replaceTodoItemsForMemory` to only tombstone non-dismissed, non-completed items. This keeps the storage layer simpler.

---

## 3. UI for Dismissal

### Option A (Recommended): Swipe-to-dismiss with an X button fallback

On `TodoItemCard`:
- Add an **X button** (or `Trash2`/`XCircle` icon) on the right side of each non-completed item
- Tapping it sets `isDismissed: true, dismissedAt: Date.now()`
- The item animates out of the list

### "Dismissed" group in TodoListView
- Add a collapsible "Dismissed" section at the bottom of the grouped list (below "Done")
- Each dismissed item shows a **"Restore"** button (undo icon)
- Restoring sets `isDismissed: false, dismissedAt: undefined` and the item reappears in its normal group

---

## 4. File-by-File Changes

### `types.ts`
- Add `isDismissed?: boolean` and `dismissedAt?: number` to `TodoItem`

### `hooks/useTodoItems.ts`
- Add `dismissItem(itemId: string)` and `restoreItem(itemId: string)` functions
- Add `normalizeTodoTitle()` helper
- Modify `processDetectedActionItems()`:
  1. Get existing items for this memory (dismissed + completed)
  2. Build suppressed title set from dismissed/completed items
  3. Filter detected items against suppressed set
  4. Only tombstone active (non-dismissed, non-completed) items
  5. Create new items from filtered list only
- Export `dismissItem` and `restoreItem` in the return object
- Update sorting to put dismissed items last (after completed)

### `services/storageService.ts`
- Modify `replaceTodoItemsForMemory()` to accept an option to skip dismissed/completed items when tombstoning
  - OR: add a new function `getActiveTodoItemsForMemory()` that returns only non-dismissed, non-completed items
  - OR: simplest — pass the IDs to skip as a parameter

### `components/TodoListView.tsx`
- Add `onDismiss` and `onRestore` props
- Add dismiss button (X icon) to `TodoItemCard` for non-completed, non-dismissed items
- Add "Dismissed" group to `groupTodoItems()` with restore button
- The "Dismissed" group is collapsed by default

### `App.tsx`
- Wire up `dismissItem` and `restoreItem` from `useTodoItems` to `TodoListView` props

### `constants.ts`
- Add analytics events: `TODO_ITEM.ACTION_DISMISSED`, `TODO_ITEM.ACTION_RESTORED`

---

## 5. Sync Compatibility

No changes needed. The existing sync already handles full TodoItem objects. The new `isDismissed`/`dismissedAt` fields are just additional properties that get encrypted and synced with the rest of the item. Older app versions will ignore these fields gracefully (they're optional).

---

## 6. Edge Cases

| Scenario | Behavior |
|----------|----------|
| Dismiss then re-enrich | Dismissed item preserved, matching new detection filtered out |
| Complete then re-enrich | Completed item preserved, matching new detection filtered out |
| Dismiss then restore then re-enrich | Item is active again, so it gets replaced normally |
| Delete source memory | All items (including dismissed) get tombstoned as before |
| Edit note to remove the action item text | New enrichment won't detect it; old dismissed item stays dismissed (harmless) |
| AI generates slightly different title | Won't match suppression set; new item created (acceptable — user can dismiss again) |
