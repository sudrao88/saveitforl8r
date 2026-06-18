import React, { useRef, useCallback } from 'react';
import { Plus, GripVertical } from 'lucide-react';
import { checklist } from '../styles/design-system';

export interface ChecklistItemData {
  id: string;
  text: string;
  checked: boolean;
  indent?: number; // 0 (default) = top-level, 1 = sub-item
}

// ─── Serialization helpers ───────────────────────────────────

export function serializeChecklistToHtml(items: ChecklistItemData[]): string {
  const listItems = items
    .map(
      (item) =>
        `<li data-checked="${item.checked}"${item.indent ? ` data-indent="${item.indent}"` : ''}>${escapeHtmlForChecklist(item.text)}</li>`,
    )
    .join('');
  return `<ul class="checklist">${listItems}</ul>`;
}

export function parseChecklistFromHtml(
  html: string,
  idPrefix?: string,
): ChecklistItemData[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('li')).map((li, idx) => ({
    id: idPrefix ? `${idPrefix}-${idx}` : crypto.randomUUID(),
    text: li.textContent || '',
    checked: li.getAttribute('data-checked') === 'true',
    indent: li.hasAttribute('data-indent')
      ? Number(li.getAttribute('data-indent'))
      : 0,
  }));
}

function escapeHtmlForChecklist(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Cascade toggle helper ───────────────────────────────────

/** Returns indices of consecutive indent=1 items directly after parentIndex. */
export function getChildrenIndices(
  items: ChecklistItemData[],
  parentIndex: number,
): number[] {
  const children: number[] = [];
  for (let i = parentIndex + 1; i < items.length; i++) {
    if ((items[i].indent ?? 0) === 1) children.push(i);
    else break;
  }
  return children;
}

/** Returns index of the nearest preceding indent=0 item, or -1. */
export function getParentIndex(
  items: ChecklistItemData[],
  childIndex: number,
): number {
  for (let i = childIndex - 1; i >= 0; i--) {
    if ((items[i].indent ?? 0) === 0) return i;
  }
  return -1;
}

/**
 * Toggle an item and cascade: parent toggles children; child toggle may
 * auto-check/uncheck parent. Returns a new array.
 */
export function cascadeToggle(
  items: ChecklistItemData[],
  targetId: string,
): ChecklistItemData[] {
  const idx = items.findIndex((i) => i.id === targetId);
  if (idx === -1) return items;

  const next = items.map((i) => ({ ...i }));
  const target = next[idx];
  const indent = target.indent ?? 0;

  if (indent === 0) {
    // Toggling a parent: flip it, set all children to same state
    target.checked = !target.checked;
    const childIndices = getChildrenIndices(next, idx);
    for (const ci of childIndices) {
      next[ci].checked = target.checked;
    }
  } else {
    // Toggling a child: flip it, then reconcile parent
    target.checked = !target.checked;
    const parentIdx = getParentIndex(next, idx);
    if (parentIdx !== -1) {
      const siblings = getChildrenIndices(next, parentIdx);
      const allChecked = siblings.every((si) => next[si].checked);
      next[parentIdx].checked = allChecked;
    }
  }

  return next;
}

// ─── Indent / outdent validation ─────────────────────────────

export function canIndent(
  items: ChecklistItemData[],
  targetId: string,
): boolean {
  const idx = items.findIndex((i) => i.id === targetId);
  return idx > 0 && (items[idx].indent ?? 0) === 0;
}

export function canOutdent(
  items: ChecklistItemData[],
  targetId: string,
): boolean {
  const idx = items.findIndex((i) => i.id === targetId);
  if (idx === -1) return false;
  return (items[idx].indent ?? 0) === 1;
}

/** Indent an item (0→1) if valid. Returns unchanged array if not. */
export function applyIndent(
  items: ChecklistItemData[],
  targetId: string,
): ChecklistItemData[] {
  if (!canIndent(items, targetId)) return items;
  return items.map((i) => (i.id === targetId ? { ...i, indent: 1 } : i));
}

/** Outdent an item (1→0) if valid. Returns unchanged array if not. */
export function applyOutdent(
  items: ChecklistItemData[],
  targetId: string,
): ChecklistItemData[] {
  if (!canOutdent(items, targetId)) return items;
  return items.map((i) => (i.id === targetId ? { ...i, indent: 0 } : i));
}

// ─── Reorder ─────────────────────────────────────────────────
//
// Parents move as a block with their children. Children only swap with
// adjacent siblings (same indent=1 run) so they don't cross parent
// boundaries and orphan themselves.

export function applyMove(
  items: ChecklistItemData[],
  targetId: string,
  direction: 'up' | 'down',
): ChecklistItemData[] {
  const idx = items.findIndex((i) => i.id === targetId);
  if (idx === -1) return items;
  const isChild = (items[idx].indent ?? 0) === 1;

  if (isChild) {
    const sibling = direction === 'up' ? idx - 1 : idx + 1;
    if (sibling < 0 || sibling >= items.length) return items;
    if ((items[sibling].indent ?? 0) !== 1) return items;
    const next = [...items];
    [next[idx], next[sibling]] = [next[sibling], next[idx]];
    return next;
  }

  // Parent block: spans the parent plus its trailing indent=1 children.
  const childIndices = getChildrenIndices(items, idx);
  const blockStart = idx;
  const blockEnd = childIndices.length
    ? childIndices[childIndices.length - 1]
    : idx;

  if (direction === 'up') {
    if (blockStart === 0) return items;
    // Previous block is the parent above; walk past any of its children to
    // find that parent's start index.
    let prevStart = blockStart - 1;
    while (prevStart > 0 && (items[prevStart].indent ?? 0) === 1) {
      prevStart--;
    }
    return [
      ...items.slice(0, prevStart),
      ...items.slice(blockStart, blockEnd + 1),
      ...items.slice(prevStart, blockStart),
      ...items.slice(blockEnd + 1),
    ];
  }

  if (blockEnd >= items.length - 1) return items;
  // Next block starts at blockEnd+1 (a parent) and extends through its children.
  const nextStart = blockEnd + 1;
  const nextChildren = getChildrenIndices(items, nextStart);
  const nextEnd = nextChildren.length
    ? nextChildren[nextChildren.length - 1]
    : nextStart;
  return [
    ...items.slice(0, blockStart),
    ...items.slice(nextStart, nextEnd + 1),
    ...items.slice(blockStart, blockEnd + 1),
    ...items.slice(nextEnd + 1),
  ];
}

// ─── Checkbox (shared between display and edit modes) ─────────

function Checkbox({
  checked,
  onClick,
}: {
  checked: boolean;
  onClick?: () => void;
}) {
  return (
    <div className="shrink-0 cursor-pointer p-0.5" onClick={onClick}>
      <div
        className={`${checklist.checkbox} ${checked ? checklist.checkboxChecked : checklist.checkboxUnchecked}`}
      >
        {checked && <div className={checklist.checkboxDot} />}
      </div>
    </div>
  );
}

// ─── Display mode (MemoryCard) ────────────────────────────────

interface ChecklistDisplayProps {
  items: ChecklistItemData[];
  onToggle: (id: string) => void;
}

export function ChecklistDisplay({ items, onToggle }: ChecklistDisplayProps) {
  return (
    <div className="space-y-2 mt-2">
      {items.map((item) => {
        const isChild = (item.indent ?? 0) === 1;
        const rowClass = isChild ? checklist.subItemRow : checklist.itemRow;
        return (
          <div
            key={item.id}
            className={`${rowClass} group/item cursor-pointer p-2 -mx-2 hover:bg-(--color-surface-hover-subtle) rounded-(--radius-lg) active:bg-(--color-surface-hover) transition-colors`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(item.id);
            }}
          >
            <Checkbox checked={item.checked} />
            <span
              className={`${checklist.itemText} leading-relaxed ${item.checked ? checklist.itemTextChecked : checklist.itemTextDefault}`}
            >
              {item.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Drag handle for indent/outdent and reorder ──────────────

const HORIZONTAL_THRESHOLD = 40;
const VERTICAL_STEP = 32;

function DragHandle({
  onIndent,
  onOutdent,
  onMoveUp,
  onMoveDown,
}: {
  onIndent: () => void;
  onOutdent: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const modeRef = useRef<'none' | 'horizontal' | 'vertical'>('none');
  const horizontalFiredRef = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      startXRef.current = e.clientX;
      startYRef.current = e.clientY;
      modeRef.current = 'none';
      horizontalFiredRef.current = false;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const dx = e.clientX - startXRef.current;
      const dy = e.clientY - startYRef.current;

      if (modeRef.current === 'none') {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        modeRef.current = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
      }

      if (modeRef.current === 'horizontal') {
        if (horizontalFiredRef.current) return;
        if (dx > HORIZONTAL_THRESHOLD) {
          horizontalFiredRef.current = true;
          onIndent();
        } else if (dx < -HORIZONTAL_THRESHOLD) {
          horizontalFiredRef.current = true;
          onOutdent();
        }
        return;
      }

      // Vertical reorder: step the item one position each VERTICAL_STEP pixels.
      if (dy >= VERTICAL_STEP) {
        startYRef.current += VERTICAL_STEP;
        onMoveDown();
      } else if (dy <= -VERTICAL_STEP) {
        startYRef.current -= VERTICAL_STEP;
        onMoveUp();
      }
    },
    [onIndent, onOutdent, onMoveUp, onMoveDown],
  );

  return (
    <div
      className={`${checklist.dragHandle} touch-none`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      aria-label="Drag to reorder, or swipe sideways to indent"
      role="button"
    >
      <GripVertical size={14} />
    </div>
  );
}

// ─── Edit mode (QuickNoteBar, NewMemoryPage) ──────────────────

interface ChecklistEditorProps {
  items: ChecklistItemData[];
  onToggle: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  onAdd: (afterId?: string) => void;
  onRemove: (id: string) => void;
  onIndent: (id: string) => void;
  onOutdent: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onSave?: () => void;
  autoFocusLast?: boolean;
  dataIdAttr?: boolean;
}

export function ChecklistEditor({
  items,
  onToggle,
  onUpdate,
  onAdd,
  onRemove,
  onIndent,
  onOutdent,
  onMove,
  onSave,
  autoFocusLast = false,
  dataIdAttr = false,
}: ChecklistEditorProps) {
  const inputRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  const focusItem = useCallback((id: string) => {
    const input = inputRefs.current.get(id);
    if (!input) return;
    input.focus();
    const len = input.value.length;
    input.setSelectionRange(len, len);
  }, []);

  // Auto-grow the textarea so long text wraps to multiple lines instead of
  // scrolling horizontally.
  const autoSize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  return (
    <div className="space-y-2">
      {items.map((item, index) => {
        const isChild = (item.indent ?? 0) === 1;
        const rowClass = isChild ? checklist.subItemRow : checklist.itemRow;
        return (
          <div
            key={item.id}
            className={`${rowClass} animate-in fade-in slide-in-from-left-2 duration-(--duration-fast)`}
          >
            <DragHandle
              onIndent={() => onIndent(item.id)}
              onOutdent={() => onOutdent(item.id)}
              onMoveUp={() => onMove(item.id, 'up')}
              onMoveDown={() => onMove(item.id, 'down')}
            />
            <Checkbox
              checked={item.checked}
              onClick={() => onToggle(item.id)}
            />
            <textarea
              ref={(el) => {
                if (el) {
                  inputRefs.current.set(item.id, el);
                  autoSize(el);
                } else inputRefs.current.delete(item.id);
              }}
              rows={1}
              value={item.text}
              {...(dataIdAttr ? { 'data-checklist-id': item.id } : {})}
              onChange={(e) => {
                onUpdate(item.id, e.target.value);
                autoSize(e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (
                  onSave &&
                  e.key === 'Enter' &&
                  (e.metaKey || e.ctrlKey)
                ) {
                  e.preventDefault();
                  onSave();
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  onAdd(item.id);
                } else if (
                  e.key === 'Backspace' &&
                  item.text === '' &&
                  items.length > 1
                ) {
                  e.preventDefault();
                  const target = items[index - 1] ?? items[index + 1];
                  if (target) focusItem(target.id);
                  onRemove(item.id);
                } else if (e.key === 'ArrowUp' && index > 0) {
                  e.preventDefault();
                  focusItem(items[index - 1].id);
                } else if (
                  e.key === 'ArrowDown' &&
                  index < items.length - 1
                ) {
                  e.preventDefault();
                  focusItem(items[index + 1].id);
                } else if (e.key === 'Tab' && !e.shiftKey) {
                  e.preventDefault();
                  onIndent(item.id);
                } else if (e.key === 'Tab' && e.shiftKey) {
                  e.preventDefault();
                  onOutdent(item.id);
                }
              }}
              autoFocus={autoFocusLast && index === items.length - 1}
              placeholder={isChild ? 'Sub-item...' : 'List item...'}
              className={`flex-1 min-w-0 resize-none overflow-hidden bg-transparent text-sm text-(--color-text-primary) placeholder-(--color-text-tertiary) focus:outline-none transition-colors text-left ${item.checked ? checklist.itemTextChecked : ''}`}
              dir="ltr"
            />
          </div>
        );
      })}
      <button
        onClick={() => onAdd(items[items.length - 1]?.id)}
        className={checklist.addBtn}
      >
        <Plus size={16} /> Add Item
      </button>
    </div>
  );
}
