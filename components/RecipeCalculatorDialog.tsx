/**
 * RecipeCalculatorDialog
 *
 * Lets the user rescale a recipe by editing any one ingredient quantity, and
 * optionally toggle the entire recipe between Imperial and Metric units. The
 * dialog never mutates the underlying memory — all state is local and resets
 * each time it opens.
 *
 * Renders via React portal so it works correctly when MemoryCard is itself
 * inside MemoryPreviewModal, MomentSheet, DeletionCandidatesSheet, etc. The
 * dialog uses the dedicated --z-nested-modal layer to paint above sheets.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { Calculator, RotateCcw, X } from 'lucide-react';
import { btn, chip, overlay, text, zIndex } from '../styles/design-system';
import { useAnimatedUnmount } from '../hooks/useAnimatedUnmount';
import {
  formatQuantity,
  formatUnit,
  parseIngredient,
  parseQuantityToken,
  type ParsedIngredient,
} from '../utils/ingredientParser';
import { convert, getDomain, toImperial, toMetric } from '../utils/unitConversion';

type UnitSystem = 'original' | 'imperial' | 'metric';

interface RecipeCalculatorDialogProps {
  ingredients: string[];
  isOpen: boolean;
  onClose: () => void;
}

interface DisplayRow {
  unit: string | null;
  quantity: number;
}

/** Compute the {unit, quantity} pair to render for one ingredient row. */
function deriveDisplay(parsed: ParsedIngredient & { kind: 'parsed' }, scale: number, system: UnitSystem): DisplayRow {
  const scaledQty = parsed.quantity * scale;
  if (system === 'original') return { unit: parsed.unit, quantity: scaledQty };

  const domain = getDomain(parsed.unit);
  if (domain !== 'volume' && domain !== 'weight') return { unit: parsed.unit, quantity: scaledQty };

  const result = system === 'metric'
    ? toMetric(parsed.unit, scaledQty)
    : toImperial(parsed.unit, scaledQty);
  if (!result) return { unit: parsed.unit, quantity: scaledQty };
  return { unit: result.unit, quantity: result.value };
}

const RecipeCalculatorDialog: React.FC<RecipeCalculatorDialogProps> = ({ ingredients, isOpen, onClose }) => {
  const [scale, setScale] = useState(1);
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('original');
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  // Reset all state whenever the dialog reopens (React-approved setState-during-render pattern).
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setScale(1);
      setUnitSystem('original');
      setDrafts({});
    }
  }

  const parsed = useMemo(() => ingredients.map((line) => parseIngredient(line)), [ingredients]);
  const { parseableRows, unparseableRows } = useMemo(() => {
    const parseableRows: Array<{ row: ParsedIngredient & { kind: 'parsed' }; idx: number }> = [];
    const unparseableRows: Array<{ row: ParsedIngredient & { kind: 'unparseable' }; idx: number }> = [];
    parsed.forEach((row, idx) => {
      if (row.kind === 'parsed') parseableRows.push({ row, idx });
      else unparseableRows.push({ row, idx });
    });
    return { parseableRows, unparseableRows };
  }, [parsed]);

  const commitDraft = useCallback((index: number, raw: string, parsedRow: ParsedIngredient) => {
    setDrafts((d) => {
      const next = { ...d };
      delete next[index];
      return next;
    });
    if (parsedRow.kind !== 'parsed') return;

    const newQty = parseQuantityToken(raw.trim());
    if (newQty === null || !Number.isFinite(newQty) || newQty <= 0) return;

    // Interpret the user's input in the unit currently displayed for that row.
    const display = deriveDisplay(parsedRow, scale, unitSystem);
    const inOriginalUnit = display.unit && parsedRow.unit && display.unit !== parsedRow.unit
      ? convert(newQty, display.unit, parsedRow.unit)
      : newQty;
    if (inOriginalUnit === null || inOriginalUnit <= 0) return;

    setScale(inOriginalUnit / parsedRow.quantity);
  }, [scale, unitSystem]);

  const handleReset = useCallback(() => {
    setScale(1);
    setDrafts({});
  }, []);

  const handleUnitSystemChange = useCallback((next: UnitSystem) => {
    setUnitSystem(next);
    setDrafts({});
  }, []);

  // Esc handler: close only this dialog, not any parent that also listens for Escape.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [isOpen, onClose]);

  const { mounted, phase } = useAnimatedUnmount(isOpen);
  if (!mounted) return null;
  if (typeof document === 'undefined') return null;

  const animClass = phase === 'exit' ? overlay.modalExit : overlay.modalEnter;
  const backdropClass = phase === 'exit' ? overlay.backdropExit : overlay.backdropEnter;
  const scaleLabel = Math.abs(scale - 1) < 0.001 ? null : `× ${formatQuantity(scale, null)}`;

  const dialog = (
    <div
      className={`fixed inset-0 ${zIndex.nestedModal} flex items-end sm:items-center justify-center`}
      data-testid="recipe-calculator-dialog"
    >
      <div
        className={`absolute inset-0 bg-(--color-surface-base)/60 backdrop-blur-sm ${backdropClass}`}
        onClick={onClose}
      />

      <div className={`relative w-full max-w-lg sm:mx-4 max-h-[90vh] flex flex-col ${overlay.modal} ${animClass}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-(--color-border-default) shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Calculator size={18} className="text-(--color-accent) shrink-0" />
            <h3 className={`${text.subheading} truncate`}>Recipe Calculator</h3>
            {scaleLabel && (
              <span className="text-xs font-bold text-(--color-accent) bg-(--color-accent-muted) px-2 py-0.5 rounded-(--radius-full) shrink-0">
                {scaleLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleReset}
              disabled={scale === 1 && Object.keys(drafts).length === 0}
              className={`${btn.base} ${btn.ghost} text-xs flex items-center gap-1`}
              title="Reset to original quantities"
            >
              <RotateCcw size={14} />
              Reset
            </button>
            <button
              type="button"
              onClick={onClose}
              className={overlay.closeBtnRight}
              aria-label="Close calculator"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-(--color-border-default) flex items-center gap-2 shrink-0">
          <span className={text.label}>Units</span>
          <div className="flex items-center gap-1.5 ml-auto">
            {(['original', 'imperial', 'metric'] as const).map((sys) => (
              <button
                key={sys}
                type="button"
                onClick={() => handleUnitSystemChange(sys)}
                className={`${chip.base} ${unitSystem === sys ? chip.active : chip.inactive}`}
              >
                {sys === 'original' ? 'Original' : sys === 'imperial' ? 'Imperial' : 'Metric'}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 p-4 space-y-2">
          {parsed.length === 0 && (
            <p className={`${text.body} text-center py-6`}>No ingredients to scale.</p>
          )}

          {parseableRows.map(({ row, idx }) => {
            const display = deriveDisplay(row, scale, unitSystem);
            const draftValue = drafts[idx];
            const inputValue = draftValue !== undefined ? draftValue : formatQuantity(display.quantity, display.unit);

            return (
              <div
                key={idx}
                className="flex items-center gap-2 py-1"
                data-testid="ingredient-row"
              >
                <input
                  type="text"
                  inputMode="text"
                  value={inputValue}
                  aria-label={`Quantity for ${row.name}`}
                  onChange={(e) => setDrafts((d) => ({ ...d, [idx]: e.target.value }))}
                  onBlur={(e) => commitDraft(idx, e.target.value, row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-20 shrink-0 bg-(--color-surface-raised) border border-(--color-border-default) rounded-(--radius-lg) px-2 py-1.5 text-sm text-(--color-text-primary) focus:outline-none focus:border-(--color-accent)/50 focus:ring-1 focus:ring-(--color-accent)/40 text-right"
                />
                {display.unit && (
                  <span className="text-xs text-(--color-text-tertiary) w-12 shrink-0 text-left">
                    {formatUnit(display.unit)}
                  </span>
                )}
                <span className="text-sm text-(--color-text-secondary) break-words flex-1 min-w-0">
                  {row.name}
                </span>
              </div>
            );
          })}

          {unparseableRows.length > 0 && (
            <div className="pt-3 mt-2 border-t border-(--color-border-subtle) space-y-2">
              <p className={text.label}>None of these ingredients have a numeric quantity</p>
              {unparseableRows.map(({ row, idx }) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 py-1.5 text-sm text-(--color-text-tertiary) opacity-60"
                  data-testid="ingredient-row-unparseable"
                >
                  <span className="break-words">{row.original}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(dialog, document.body);
};

export default RecipeCalculatorDialog;
