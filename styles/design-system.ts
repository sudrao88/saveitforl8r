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
    'bg-(--color-accent) hover:bg-(--color-accent-hover) text-(--color-text-primary) rounded-(--radius-lg) px-4 py-2.5 shadow-lg',
  secondary:
    'bg-(--color-surface-raised) hover:bg-(--color-surface-raised)/80 text-(--color-text-primary) border border-(--color-border-default) rounded-(--radius-lg) px-4 py-2.5',
  ghost:
    'text-(--color-text-secondary) hover:bg-(--color-surface-hover-subtle) hover:text-(--color-text-primary) rounded-(--radius-lg) px-3 py-2',
  danger:
    'bg-(--color-danger) hover:bg-(--color-danger-hover) text-(--color-text-primary) rounded-(--radius-lg) px-4 py-2.5',
  icon: 'p-2 rounded-(--radius-lg) text-(--color-text-secondary) hover:bg-(--color-surface-hover) hover:text-(--color-text-primary)',
  iconLg:
    'p-2.5 rounded-(--radius-xl) text-(--color-text-secondary) hover:text-(--color-text-primary) hover:bg-(--color-surface-raised) transition-colors active:scale-95',
  // Small / compact variants (settings, toolbars, inline actions)
  primarySm:
    'bg-(--color-accent) hover:bg-(--color-accent-hover) text-(--color-text-primary) rounded-(--radius-lg) px-3 py-1.5 text-xs font-bold',
  secondarySm:
    'bg-(--color-surface-raised) hover:bg-(--color-surface-raised)/80 text-(--color-text-primary) rounded-(--radius-lg) px-3 py-1.5 text-xs font-medium',
  dangerSm:
    'bg-(--color-danger) hover:bg-(--color-danger-hover) text-(--color-text-primary) rounded-(--radius-lg) px-3 py-1.5 text-xs font-bold',
  warningSm:
    'bg-(--color-warning) hover:bg-(--color-warning)/80 text-(--color-text-primary) rounded-(--radius-lg) px-3 py-1.5 text-xs font-bold',
  // Circular CTA (primary floating action buttons — save, send, etc.)
  cta: 'p-2.5 rounded-(--radius-xl) bg-(--color-accent) hover:bg-(--color-accent-hover) text-(--color-text-primary) shadow-lg shrink-0',
  ctaDisabled:
    'p-2.5 rounded-(--radius-xl) bg-(--color-surface-raised) text-(--color-text-tertiary) cursor-not-allowed shrink-0',
  ctaSuccess:
    'p-2.5 rounded-(--radius-xl) bg-(--color-success) text-(--color-text-primary) animate-save-success shrink-0',
  // Outlined / subtle variants (bordered, muted background)
  outlinedSm:
    'flex items-center gap-1.5 px-3 py-2 rounded-(--radius-lg) text-xs font-medium bg-(--color-surface-raised) text-(--color-text-secondary) border border-(--color-border-default) hover:border-(--color-border-default) hover:text-(--color-text-primary) transition-all active:scale-95',
  outlinedDangerSm:
    'flex items-center gap-1.5 px-3 py-2 rounded-(--radius-lg) text-xs font-medium bg-(--color-danger)/20 text-(--color-danger) border border-(--color-danger)/30 hover:border-(--color-danger)/50 hover:text-(--color-danger) transition-all active:scale-95',
} as const;

// ─── Cards ──────────────────────────────────────────────────

export const card = {
  base: 'bg-(--color-surface-raised)/40 border border-(--color-border-subtle) rounded-(--radius-xl)',
  interactive:
    'bg-(--color-surface-raised)/40 border border-(--color-border-subtle) rounded-(--radius-xl) hover:bg-(--color-surface-raised)/60 hover:border-(--color-border-default)/50 hover:shadow-lg transition-all',
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
    'fixed inset-0 bg-(--color-surface-base)/80 backdrop-blur-sm',
  // Structural-only sheet (no animation — use with AnimatedPresence)
  sheetBase:
    'fixed inset-0 z-(--z-sheet) bg-(--color-surface-overlay)/95 backdrop-blur-md flex flex-col',
  // Legacy: includes enter animation for components not yet using AnimatedPresence
  sheet:
    'fixed inset-0 z-(--z-sheet) bg-(--color-surface-overlay)/95 backdrop-blur-md flex flex-col animate-in fade-in duration-(--duration-slow)',
  sheetHeader:
    'sticky top-0 z-(--z-sticky) px-4 py-3 border-b border-(--color-border-default) flex items-center justify-between bg-(--color-surface-overlay)/80 backdrop-blur-xl pt-[var(--sat)]',
  modal:
    'bg-(--color-surface-overlay) border border-(--color-border-default)/50 rounded-(--radius-xl) shadow-2xl',
  dialogBackdrop:
    'fixed inset-0 z-(--z-modal) flex items-end sm:items-center justify-center',
  closeBtn:
    'p-3 -ml-3 rounded-full hover:bg-(--color-surface-raised) text-(--color-text-secondary) hover:text-(--color-text-primary) transition-colors active:scale-95',
  previewBackdrop:
    'fixed inset-0 z-(--z-sheet) flex items-center justify-center p-4 bg-(--color-surface-base)/80 backdrop-blur-md',
  previewCloseBtn:
    'mt-4 w-full py-3 bg-(--color-surface-raised) text-(--color-text-primary) rounded-(--radius-xl) font-bold shadow-xl border border-(--color-border-default) text-sm active:scale-95 shrink-0',
  closeBtnRight:
    'p-2 -mr-2 rounded-full hover:bg-(--color-surface-raised) text-(--color-text-secondary) hover:text-(--color-text-primary) transition-colors active:scale-95',
  navBtn:
    'absolute z-(--z-sticky) p-3 rounded-full bg-(--color-surface-base)/40 hover:bg-(--color-surface-base)/70 text-(--color-text-primary)/70 hover:text-(--color-text-primary) transition-all active:scale-90 backdrop-blur-sm',
  // ─── Animation class pairs for AnimatedPresence ──────────
  sheetEnter: 'animate-in fade-in slide-in-from-bottom-4 duration-(--duration-slow)',
  sheetExit: 'animate-out fade-out slide-out-to-bottom-4 fill-mode-forwards duration-(--duration-normal)',
  modalEnter: 'animate-in zoom-in-95 fade-in duration-(--duration-normal)',
  modalExit: 'animate-out zoom-out-95 fade-out fill-mode-forwards duration-(--duration-normal)',
  backdropEnter: 'animate-in fade-in duration-(--duration-fast)',
  backdropExit: 'animate-out fade-out fill-mode-forwards duration-(--duration-fast)',
  viewerEnter: 'animate-in fade-in zoom-in-95 duration-(--duration-fast)',
  viewerExit: 'animate-out fade-out zoom-out-95 fill-mode-forwards duration-(--duration-fast)',
  viewEnter: 'animate-in fade-in duration-(--duration-normal)',
  viewExit: 'animate-out fade-out fill-mode-forwards duration-(--duration-fast)',
  toastEnter: 'animate-in fade-in slide-in-from-top-2 duration-(--duration-normal)',
  toastExit: 'animate-out fade-out slide-out-to-top-2 fill-mode-forwards duration-(--duration-normal)',
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
    'bg-(--color-accent) text-(--color-text-primary) border-(--color-accent-hover) shadow-lg shadow-(--color-accent)/20 animate-chip-pop',
  inactive:
    'bg-(--color-surface-raised) text-(--color-text-secondary) border-(--color-border-default) hover:border-(--color-border-default)',
  tag: 'text-xs text-(--color-text-tertiary) bg-(--color-surface-overlay)/50 px-2 py-1 rounded-(--radius-md)',
} as const;

// ─── Menu / Dropdown ────────────────────────────────────────

export const menu = {
  backdrop: 'fixed inset-0 cursor-default touch-manipulation',
  panel:
    'absolute bottom-full right-0 mb-1 w-40 bg-(--color-surface-overlay) border border-(--color-border-default) rounded-(--radius-xl) shadow-xl overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-200',
  item: 'w-full px-4 py-3 text-left text-sm font-medium text-(--color-text-secondary) hover:bg-(--color-surface-raised) hover:text-(--color-text-primary) flex items-center gap-3 active:bg-(--color-surface-raised)',
  itemDanger:
    'w-full px-4 py-3 text-left text-sm font-medium text-(--color-danger) hover:bg-(--color-danger)/10 hover:text-(--color-danger) flex items-center gap-3 border-t border-(--color-border-default) active:bg-(--color-danger)/20',
  divider: 'border-t border-(--color-border-default)',
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
    'w-5 h-5 border-2 rounded-(--radius-sm) flex items-center justify-center transition-colors shrink-0',
  checkboxChecked: 'border-(--color-accent) bg-(--color-accent)/20',
  checkboxUnchecked: 'border-(--color-border-default)',
  checkboxDot: 'w-2.5 h-2.5 bg-(--color-accent) rounded-(--radius-xs)',
  itemRow: 'flex items-center gap-3',
  itemText: 'text-sm transition-all',
  itemTextDefault: 'text-(--color-text-primary)',
  itemTextChecked: 'line-through text-(--color-text-tertiary)',
  addBtn:
    'flex items-center gap-1.5 text-(--color-text-tertiary) hover:text-(--color-accent) text-sm transition-colors py-1 active:text-(--color-accent)',
} as const;

// ─── Confirmation Dialog ────────────────────────────────────

export const confirm = {
  backdrop: 'absolute inset-0 z-(--z-dropdown) bg-(--color-surface-overlay)/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-(--duration-fast)',
  title: 'text-(--color-text-primary) font-bold mb-1',
  message: 'text-xs text-(--color-text-secondary) mb-4',
} as const;

// ─── Layout Helpers ─────────────────────────────────────────

export const layout = {
  pageContainer: 'w-full max-w-4xl mx-auto',
  section: 'px-4 sm:px-8',
  center: 'flex items-center justify-center',
  stack: 'flex flex-col',
  row: 'flex items-center',
} as const;
