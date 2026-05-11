/**
 * Pure parsing utilities for recipe ingredient strings.
 *
 * Ingredients in EnrichmentData are unstructured strings like "2 cups flour"
 * or "1 1/2 tsp salt". This module extracts {quantity, unit, name} when
 * possible and rejects entries without a numeric quantity (e.g. "Salt to taste").
 */

export type ParsedIngredient =
  | {
      kind: 'parsed';
      quantity: number;
      unit: string | null; // canonical unit key, see UNIT_ALIASES; null when no unit (e.g. "3 eggs")
      name: string;
      original: string;
    }
  | { kind: 'unparseable'; original: string };

// Map every accepted spelling -> canonical unit key.
// Canonical keys are lowercase, singular, no punctuation.
const UNIT_ALIASES: Record<string, string> = {
  // Volume
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tbsps: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp',
  cup: 'cup', cups: 'cup', c: 'cup',
  'fl oz': 'fl_oz', 'fl_oz': 'fl_oz', 'floz': 'fl_oz', 'fluid ounce': 'fl_oz', 'fluid ounces': 'fl_oz',
  pint: 'pint', pints: 'pint', pt: 'pint',
  quart: 'quart', quarts: 'quart', qt: 'quart',
  gallon: 'gallon', gallons: 'gallon', gal: 'gallon',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  // Weight
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
};

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3,
  '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

/**
 * Parse a numeric token like "1", "1.5", "1/2", "1 1/2", "½", or "1½".
 * Returns null when the token is not a recognizable quantity.
 */
export function parseQuantityToken(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  // Pure unicode fraction (e.g. "½")
  if (s.length === 1 && UNICODE_FRACTIONS[s] !== undefined) return UNICODE_FRACTIONS[s];

  // Mixed number with unicode fraction: "1½"
  const mixedUnicode = s.match(/^(\d+)([¼-¾⅐-⅞])$/);
  if (mixedUnicode && UNICODE_FRACTIONS[mixedUnicode[2]] !== undefined) {
    return Number(mixedUnicode[1]) + UNICODE_FRACTIONS[mixedUnicode[2]];
  }

  // Mixed fraction: "1 1/2"
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const den = Number(mixed[3]);
    if (den === 0) return null;
    return Number(mixed[1]) + Number(mixed[2]) / den;
  }

  // Simple fraction: "1/2"
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const den = Number(frac[2]);
    if (den === 0) return null;
    return Number(frac[1]) / den;
  }

  // Decimal or integer
  if (/^\d+(\.\d+)?$/.test(s) || /^\.\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

/**
 * Match the leading quantity from a string, returning the parsed number and
 * the byte length consumed (so the caller can take everything after).
 */
function consumeQuantity(line: string): { value: number; consumed: number } | null {
  // Preference order matters: try mixed unicode (1½), then mixed fraction (1 1/2),
  // then simple fraction (1/2), then unicode (½), then decimal (1.5 / .5), then integer (2).
  const patterns: RegExp[] = [
    /^(\d+[¼-¾⅐-⅞])/,
    /^(\d+\s+\d+\/\d+)/,
    /^(\d+\/\d+)/,
    /^([¼-¾⅐-⅞])/,
    /^(\d+\.\d+)/,
    /^(\.\d+)/,
    /^(\d+)/,
  ];
  for (const re of patterns) {
    const m = line.match(re);
    if (!m) continue;
    const value = parseQuantityToken(m[1]);
    if (value === null || value <= 0) return null;
    return { value, consumed: m[0].length };
  }
  return null;
}

/**
 * Match the next token as a known unit (case-insensitive). Returns the canonical
 * unit and the number of input characters consumed (including any trailing
 * whitespace and the optional period after abbreviations like "tsp.").
 */
function consumeUnit(rest: string): { unit: string; consumed: number } | null {
  // Try two-word units first ("fl oz", "fluid ounce")
  const twoWord = rest.match(/^([A-Za-z]+)\s+([A-Za-z]+)\.?/);
  if (twoWord) {
    const key = `${twoWord[1].toLowerCase()} ${twoWord[2].toLowerCase()}`;
    if (UNIT_ALIASES[key]) {
      return { unit: UNIT_ALIASES[key], consumed: twoWord[0].length };
    }
  }
  const oneWord = rest.match(/^([A-Za-z]+)\.?/);
  if (oneWord) {
    const key = oneWord[1].toLowerCase();
    if (UNIT_ALIASES[key]) {
      return { unit: UNIT_ALIASES[key], consumed: oneWord[0].length };
    }
  }
  return null;
}

export function parseIngredient(line: string): ParsedIngredient {
  const original = String(line);
  const trimmed = original.trimStart();

  const qty = consumeQuantity(trimmed);
  if (!qty) return { kind: 'unparseable', original };

  let cursor = qty.consumed;
  // Skip whitespace between quantity and unit/name
  while (cursor < trimmed.length && /\s/.test(trimmed[cursor])) cursor++;

  const after = trimmed.slice(cursor);
  const unitMatch = consumeUnit(after);

  let unit: string | null = null;
  let name: string;
  if (unitMatch) {
    unit = unitMatch.unit;
    name = after.slice(unitMatch.consumed).trim();
  } else {
    name = after.trim();
  }

  // If the only remaining content is empty after stripping, mark unparseable —
  // a quantity with no name isn't a useful ingredient row (e.g. "2 cups").
  if (!name) return { kind: 'unparseable', original };

  return { kind: 'parsed', quantity: qty.value, unit, name, original };
}

// Common cooking fractions to snap to when formatting imperial units.
// Eighths cover most recipe needs (1/8, 1/4, 3/8, 1/2, 5/8, 3/4, 7/8) plus thirds.
const FRACTION_SNAPS: Array<{ value: number; label: string }> = [
  { value: 1 / 8, label: '1/8' },
  { value: 1 / 4, label: '1/4' },
  { value: 1 / 3, label: '1/3' },
  { value: 3 / 8, label: '3/8' },
  { value: 1 / 2, label: '1/2' },
  { value: 5 / 8, label: '5/8' },
  { value: 2 / 3, label: '2/3' },
  { value: 3 / 4, label: '3/4' },
  { value: 7 / 8, label: '7/8' },
];

const FRACTIONAL_UNITS = new Set(['cup', 'tbsp', 'tsp', 'pint', 'quart', 'gallon']);

/**
 * Render a quantity for display. For imperial volume units (and unitless
 * counts), snap to common cooking fractions when within tolerance. Otherwise
 * fall back to up-to-two decimal places with trailing zeros stripped.
 */
export function formatQuantity(qty: number, unit: string | null): string {
  if (!Number.isFinite(qty) || qty <= 0) return '0';

  const usesFractions = unit === null || FRACTIONAL_UNITS.has(unit);
  if (usesFractions) {
    const whole = Math.floor(qty);
    const remainder = qty - whole;
    const tolerance = 0.02;
    const snap = FRACTION_SNAPS.find((f) => Math.abs(f.value - remainder) <= tolerance);
    if (remainder <= tolerance) return String(whole);
    if (snap) return whole > 0 ? `${whole} ${snap.label}` : snap.label;
  }

  // Decimals: 2 places max, strip trailing zeros and trailing dot.
  const fixed = qty.toFixed(2);
  return fixed.replace(/\.?0+$/, '');
}

/**
 * Human-friendly label for a canonical unit key (e.g. "cup" -> "cup",
 * "fl_oz" -> "fl oz"). Returns the input unchanged for unknown units.
 */
export function formatUnit(unit: string | null): string {
  if (!unit) return '';
  if (unit === 'fl_oz') return 'fl oz';
  return unit;
}
