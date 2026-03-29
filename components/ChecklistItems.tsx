import React from 'react';
import { Plus } from 'lucide-react';
import { checklist } from '../styles/design-system';

export interface ChecklistItemData {
  id: string;
  text: string;
  checked: boolean;
}

// ─── Checkbox (shared between display and edit modes) ─────────

function Checkbox({ checked, onClick }: { checked: boolean; onClick?: () => void }) {
  return (
    <div className="shrink-0 cursor-pointer p-0.5" onClick={onClick}>
      <div className={`${checklist.checkbox} ${checked ? checklist.checkboxChecked : checklist.checkboxUnchecked}`}>
        {checked && <div className={checklist.checkboxDot} />}
      </div>
    </div>
  );
}

// ─── Display mode (MemoryCard) ────────────────────────────────

interface ChecklistDisplayProps {
  items: { id: string; text: string; checked: boolean }[];
  onToggle: (index: number) => void;
}

export function ChecklistDisplay({ items, onToggle }: ChecklistDisplayProps) {
  return (
    <div className="space-y-2 mt-2">
      {items.map((item, idx) => (
        <div
          key={item.id}
          className={`${checklist.itemRow} group/item cursor-pointer p-2 -mx-2 hover:bg-white/5 rounded-lg active:bg-white/10 transition-colors`}
          onClick={(e) => { e.stopPropagation(); onToggle(idx); }}
        >
          <Checkbox checked={item.checked} />
          <span className={`${checklist.itemText} leading-relaxed ${item.checked ? checklist.itemTextChecked : checklist.itemTextDefault}`}>
            {item.text}
          </span>
        </div>
      ))}
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
  onSave,
  autoFocusLast = false,
  dataIdAttr = false,
}: ChecklistEditorProps) {
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={item.id} className={`${checklist.itemRow} animate-in fade-in slide-in-from-left-2 duration-(--duration-fast)`}>
          <Checkbox checked={item.checked} onClick={() => onToggle(item.id)} />
          <input
            type="text"
            value={item.text}
            {...(dataIdAttr ? { 'data-checklist-id': item.id } : {})}
            onChange={(e) => onUpdate(item.id, e.target.value)}
            onKeyDown={(e) => {
              if (onSave && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSave();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                onAdd(item.id);
              } else if (e.key === 'Backspace' && item.text === '' && items.length > 1) {
                e.preventDefault();
                onRemove(item.id);
              }
            }}
            autoFocus={autoFocusLast && index === items.length - 1}
            placeholder="List item..."
            className={`flex-1 bg-transparent text-sm text-(--color-text-primary) placeholder-(--color-text-tertiary) focus:outline-none transition-all text-left ${item.checked ? checklist.itemTextChecked : ''}`}
            dir="ltr"
          />
        </div>
      ))}
      <button
        onClick={() => onAdd(items[items.length - 1]?.id)}
        className={checklist.addBtn}
      >
        <Plus size={16} /> Add Item
      </button>
    </div>
  );
}
