/**
 * Design System — SaveItForL8R
 *
 * Central source of truth for reusable component class strings.
 * All tokens reference CSS custom properties defined in index.css @theme.
 *
 * Usage:
 *   import { btn, card, overlay } from '../styles/design-system';
 *   <button className={`${btn.base} ${btn.primary}`}>Save</button>
 */

// ─── Buttons ────────────────────────────────────────────────

export const btn = {
  base: 'inline-flex items-center justify-center font-medium transition-colors duration-(--duration-fast) active:scale-95 disabled:opacity-50 disabled:pointer-events-none',
  primary:
    'bg-(--color-accent) hover:bg-(--color-accent-hover) text-white rounded-(--radius-lg) px-4 py-2.5 shadow-lg',
  secondary:
    'bg-(--color-surface-raised) hover:bg-gray-700 text-(--color-text-primary) border border-(--color-border-default) rounded-(--radius-lg) px-4 py-2.5',
  ghost:
    'text-(--color-text-secondary) hover:bg-white/5 hover:text-(--color-text-primary) rounded-(--radius-lg) px-3 py-2',
  danger:
    'bg-(--color-danger) hover:bg-(--color-danger-hover) text-white rounded-(--radius-lg) px-4 py-2.5',
  icon: 'p-2 rounded-(--radius-lg) text-(--color-text-secondary) hover:bg-white/10 hover:text-(--color-text-primary)',
  iconLg:
    'p-2.5 rounded-(--radius-xl) text-(--color-text-secondary) hover:text-(--color-text-primary) hover:bg-(--color-surface-raised) transition-colors active:scale-95',
} as const;

// ─── Cards ──────────────────────────────────────────────────

export const card = {
  base: 'bg-(--color-surface-raised)/40 border border-(--color-border-subtle) rounded-(--radius-xl)',
  interactive:
    'bg-(--color-surface-raised)/40 border border-(--color-border-subtle) rounded-(--radius-xl) hover:bg-(--color-surface-raised)/60 hover:border-gray-600/50 hover:shadow-lg transition-all',
  elevated:
    'bg-(--color-surface-raised)/50 border border-(--color-border-default)/50 rounded-(--radius-xl)',
} as const;

// ─── Inputs ─────────────────────────────────────────────────

export const input = {
  base: 'w-full bg-(--color-surface-raised) border border-(--color-border-default) rounded-(--radius-lg) px-3 py-2.5 text-(--color-text-primary) placeholder-(--color-text-tertiary) focus:outline-none focus:border-(--color-accent)/50 focus:ring-1 focus:ring-(--color-accent)/40 transition-colors text-sm',
  textarea:
    'w-full bg-(--color-surface-raised) border border-(--color-border-default) rounded-(--radius-lg) px-3 py-2.5 text-(--color-text-primary) placeholder-(--color-text-tertiary) focus:outline-none focus:border-(--color-accent)/50 focus:ring-1 focus:ring-(--color-accent)/40 transition-colors text-sm resize-none',
} as const;

// ─── Overlays (Modals, Sheets, Dialogs) ─────────────────────

export const overlay = {
  backdrop:
    'fixed inset-0 bg-(--color-surface-overlay)/95 backdrop-blur-md',
  backdropLight:
    'fixed inset-0 bg-black/80 backdrop-blur-sm',
  sheet:
    'fixed inset-0 z-(--z-sheet) bg-(--color-surface-overlay)/95 backdrop-blur-md flex flex-col animate-in fade-in duration-300',
  sheetHeader:
    'sticky top-0 z-(--z-sticky) px-4 py-3 border-b border-gray-800 flex items-center justify-between bg-(--color-surface-overlay)/80 backdrop-blur-xl pt-[var(--sat)]',
  modal:
    'bg-(--color-surface-overlay) border border-(--color-border-default)/50 rounded-2xl shadow-2xl',
  dialogBackdrop:
    'fixed inset-0 z-(--z-modal) flex items-end sm:items-center justify-center',
  closeBtn:
    'p-3 -ml-3 rounded-full hover:bg-(--color-surface-raised) text-(--color-text-secondary) hover:text-(--color-text-primary) transition-colors active:scale-95',
  previewBackdrop:
    'fixed inset-0 z-(--z-sheet) flex items-center justify-center p-4 bg-black/80 backdrop-blur-md',
  previewCloseBtn:
    'mt-4 w-full py-3 bg-(--color-surface-raised) text-white rounded-(--radius-xl) font-bold shadow-xl border border-(--color-border-default) text-sm active:scale-95 shrink-0',
} as const;

// ─── Typography ─────────────────────────────────────────────

export const text = {
  heading: 'text-lg font-bold text-(--color-text-primary)',
  subheading: 'text-base font-semibold text-(--color-text-primary)',
  body: 'text-sm text-(--color-text-secondary)',
  caption: 'text-xs text-(--color-text-tertiary)',
  label:
    'text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)',
} as const;

// ─── Chips / Tags ───────────────────────────────────────────

export const chip = {
  base: 'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-(--radius-full) text-xs font-bold border transition-all active:scale-95 touch-manipulation',
  active:
    'bg-(--color-accent) text-white border-(--color-accent-hover) shadow-lg shadow-blue-900/20 animate-chip-pop',
  inactive:
    'bg-(--color-surface-raised) text-gray-300 border-(--color-border-default) hover:border-gray-500',
  tag: 'text-xs text-(--color-text-tertiary) bg-(--color-surface-overlay)/50 px-2 py-1 rounded-(--radius-md)',
} as const;

// ─── Menu / Dropdown ────────────────────────────────────────

export const menu = {
  backdrop: 'fixed inset-0 cursor-default touch-manipulation',
  panel:
    'absolute bottom-full right-0 mb-1 w-40 bg-(--color-surface-overlay) border border-(--color-border-default) rounded-(--radius-xl) shadow-xl overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-200',
  item: 'w-full px-4 py-3 text-left text-sm font-medium text-gray-300 hover:bg-(--color-surface-raised) hover:text-white flex items-center gap-3 active:bg-gray-700',
  itemDanger:
    'w-full px-4 py-3 text-left text-sm font-medium text-(--color-danger) hover:bg-red-900/10 hover:text-red-300 flex items-center gap-3 border-t border-gray-800 active:bg-red-900/20',
  divider: 'border-t border-gray-800',
} as const;

// ─── Z-Index Layers (as class string helpers) ───────────────

export const zIndex = {
  sticky: 'z-(--z-sticky)',
  dropdown: 'z-(--z-dropdown)',
  overlay: 'z-(--z-overlay)',
  modal: 'z-(--z-modal)',
  sheet: 'z-(--z-sheet)',
  toast: 'z-(--z-toast)',
  tooltip: 'z-(--z-tooltip)',
} as const;

// ─── Checklist ─────────────────────────────────────────────

export const checklist = {
  checkbox:
    'w-5 h-5 border-2 rounded-md flex items-center justify-center transition-colors shrink-0',
  checkboxChecked: 'border-blue-500 bg-blue-500/20',
  checkboxUnchecked: 'border-gray-600',
  checkboxDot: 'w-2.5 h-2.5 bg-blue-500 rounded-sm',
  itemRow: 'flex items-center gap-3',
  itemText: 'text-sm transition-all',
  itemTextDefault: 'text-gray-200',
  itemTextChecked: 'line-through text-gray-500',
  addBtn:
    'flex items-center gap-1.5 text-gray-500 hover:text-blue-400 text-sm transition-colors py-1 active:text-blue-500',
} as const;

// ─── Layout Helpers ─────────────────────────────────────────

export const layout = {
  pageContainer: 'w-full max-w-4xl mx-auto',
  section: 'px-4 sm:px-8',
  center: 'flex items-center justify-center',
  stack: 'flex flex-col',
  row: 'flex items-center',
} as const;
