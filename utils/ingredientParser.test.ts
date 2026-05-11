import { describe, it, expect } from 'vitest';
import {
  parseIngredient,
  parseQuantityToken,
  formatQuantity,
  formatUnit,
} from './ingredientParser';

describe('parseQuantityToken', () => {
  it('parses integers', () => {
    expect(parseQuantityToken('2')).toBe(2);
  });
  it('parses decimals', () => {
    expect(parseQuantityToken('1.5')).toBe(1.5);
    expect(parseQuantityToken('.25')).toBe(0.25);
  });
  it('parses simple fractions', () => {
    expect(parseQuantityToken('1/2')).toBe(0.5);
    expect(parseQuantityToken('3/4')).toBe(0.75);
  });
  it('parses mixed fractions', () => {
    expect(parseQuantityToken('1 1/2')).toBe(1.5);
    expect(parseQuantityToken('2 1/3')).toBeCloseTo(2.333, 3);
  });
  it('parses unicode fractions', () => {
    expect(parseQuantityToken('½')).toBe(0.5);
    expect(parseQuantityToken('¼')).toBe(0.25);
    expect(parseQuantityToken('⅓')).toBeCloseTo(1 / 3, 5);
  });
  it('parses mixed unicode fractions', () => {
    expect(parseQuantityToken('1½')).toBe(1.5);
    expect(parseQuantityToken('2¼')).toBe(2.25);
  });
  it('rejects malformed input', () => {
    expect(parseQuantityToken('abc')).toBe(null);
    expect(parseQuantityToken('1/0')).toBe(null);
    expect(parseQuantityToken('')).toBe(null);
  });
});

describe('parseIngredient', () => {
  it('parses quantity + unit + name', () => {
    expect(parseIngredient('2 cups flour')).toEqual({
      kind: 'parsed', quantity: 2, unit: 'cup', name: 'flour', original: '2 cups flour',
    });
  });

  it('normalizes unit aliases (singular/plural, abbreviations)', () => {
    expect(parseIngredient('1 tablespoon olive oil')).toMatchObject({ unit: 'tbsp', quantity: 1 });
    expect(parseIngredient('1 tbsp olive oil')).toMatchObject({ unit: 'tbsp' });
    expect(parseIngredient('2 tsp salt')).toMatchObject({ unit: 'tsp' });
    expect(parseIngredient('100 g sugar')).toMatchObject({ unit: 'g', quantity: 100 });
    expect(parseIngredient('250 ml milk')).toMatchObject({ unit: 'ml', quantity: 250 });
    expect(parseIngredient('1 lb beef')).toMatchObject({ unit: 'lb' });
    expect(parseIngredient('8 oz cream cheese')).toMatchObject({ unit: 'oz' });
  });

  it('handles two-word units like "fl oz"', () => {
    expect(parseIngredient('4 fl oz cream')).toMatchObject({ unit: 'fl_oz', quantity: 4, name: 'cream' });
  });

  it('handles abbreviations with trailing period', () => {
    expect(parseIngredient('1 tsp. vanilla')).toMatchObject({ unit: 'tsp', name: 'vanilla' });
  });

  it('preserves parentheticals in the name', () => {
    expect(parseIngredient('1/2 cup butter (softened)')).toEqual({
      kind: 'parsed', quantity: 0.5, unit: 'cup', name: 'butter (softened)', original: '1/2 cup butter (softened)',
    });
  });

  it('handles mixed fractions with units', () => {
    expect(parseIngredient('1 1/2 tsp salt')).toMatchObject({ quantity: 1.5, unit: 'tsp', name: 'salt' });
  });

  it('treats unitless counts as parsed with null unit', () => {
    expect(parseIngredient('3 eggs')).toEqual({
      kind: 'parsed', quantity: 3, unit: null, name: 'eggs', original: '3 eggs',
    });
  });

  it('marks rows without a leading quantity as unparseable', () => {
    expect(parseIngredient('Salt to taste')).toEqual({ kind: 'unparseable', original: 'Salt to taste' });
    expect(parseIngredient('a pinch of pepper')).toEqual({ kind: 'unparseable', original: 'a pinch of pepper' });
  });

  it('marks zero-quantity rows as unparseable to avoid divide-by-zero', () => {
    expect(parseIngredient('0 cups flour')).toEqual({ kind: 'unparseable', original: '0 cups flour' });
  });

  it('marks rows with only a quantity as unparseable', () => {
    expect(parseIngredient('2 cups')).toEqual({ kind: 'unparseable', original: '2 cups' });
  });

  it('coerces non-string inputs defensively', () => {
    // Treat number as unparseable rather than crashing.
    expect(parseIngredient(42 as unknown as string).kind).toBe('unparseable');
  });
});

describe('formatQuantity', () => {
  it('renders integers as integers', () => {
    expect(formatQuantity(2, 'cup')).toBe('2');
    expect(formatQuantity(100, 'g')).toBe('100');
  });

  it('snaps fractional imperial volumes to common fractions', () => {
    expect(formatQuantity(0.5, 'cup')).toBe('1/2');
    expect(formatQuantity(0.25, 'tsp')).toBe('1/4');
    expect(formatQuantity(1.5, 'cup')).toBe('1 1/2');
    expect(formatQuantity(2.25, 'tbsp')).toBe('2 1/4');
  });

  it('renders metric quantities with up to 2 decimals, trimmed', () => {
    expect(formatQuantity(236.588, 'ml')).toBe('236.59');
    expect(formatQuantity(100.5, 'g')).toBe('100.5');
    expect(formatQuantity(1, 'kg')).toBe('1');
  });

  it('snaps fractional unitless counts (e.g. eggs)', () => {
    expect(formatQuantity(0.5, null)).toBe('1/2');
    expect(formatQuantity(1.5, null)).toBe('1 1/2');
  });

  it('returns 0 for invalid input', () => {
    expect(formatQuantity(NaN, 'cup')).toBe('0');
    expect(formatQuantity(0, 'cup')).toBe('0');
    expect(formatQuantity(-1, 'cup')).toBe('0');
  });
});

describe('formatUnit', () => {
  it('renders fl_oz as "fl oz"', () => {
    expect(formatUnit('fl_oz')).toBe('fl oz');
  });
  it('passes through canonical units unchanged', () => {
    expect(formatUnit('cup')).toBe('cup');
    expect(formatUnit('g')).toBe('g');
  });
  it('renders empty string when unit is null', () => {
    expect(formatUnit(null)).toBe('');
  });
});
