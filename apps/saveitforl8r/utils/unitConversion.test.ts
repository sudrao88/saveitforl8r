import { describe, it, expect } from 'vitest';
import { convert, getDomain, toMetric, toImperial } from './unitConversion';

describe('getDomain', () => {
  it('classifies volume units', () => {
    expect(getDomain('cup')).toBe('volume');
    expect(getDomain('ml')).toBe('volume');
    expect(getDomain('fl_oz')).toBe('volume');
  });
  it('classifies weight units', () => {
    expect(getDomain('g')).toBe('weight');
    expect(getDomain('lb')).toBe('weight');
  });
  it('treats null as count', () => {
    expect(getDomain(null)).toBe('count');
  });
  it('returns unknown for unrecognized units', () => {
    expect(getDomain('clove')).toBe('unknown');
  });
});

describe('convert', () => {
  it('converts within volume', () => {
    expect(convert(1, 'cup', 'ml')).toBeCloseTo(236.588, 3);
    expect(convert(1, 'l', 'ml')).toBe(1000);
    expect(convert(2, 'tbsp', 'tsp')).toBeCloseTo(6, 1);
  });

  it('converts within weight', () => {
    expect(convert(1, 'kg', 'g')).toBe(1000);
    expect(convert(1, 'lb', 'oz')).toBeCloseTo(16, 1);
    expect(convert(100, 'g', 'oz')).toBeCloseTo(3.527, 2);
  });

  it('round-trips losslessly enough', () => {
    const start = 2;
    const ml = convert(start, 'cup', 'ml')!;
    const back = convert(ml, 'ml', 'cup')!;
    expect(back).toBeCloseTo(start, 5);
  });

  it('returns null for cross-domain conversions', () => {
    expect(convert(1, 'cup', 'g')).toBe(null);
    expect(convert(1, 'lb', 'ml')).toBe(null);
  });

  it('returns null for unknown units', () => {
    expect(convert(1, 'clove', 'g')).toBe(null);
    expect(convert(1, 'cup', 'clove')).toBe(null);
  });

  it('returns the input unchanged when units match', () => {
    expect(convert(2.5, 'cup', 'cup')).toBe(2.5);
  });
});

describe('toMetric', () => {
  it('converts cups to ml', () => {
    const r = toMetric('cup', 1);
    expect(r).toEqual({ unit: 'ml', value: expect.closeTo(236.588, 3) as unknown as number });
  });
  it('promotes large ml to liters', () => {
    const r = toMetric('cup', 5); // ~1183ml
    expect(r?.unit).toBe('l');
    expect(r?.value).toBeCloseTo(1.183, 2);
  });
  it('converts pounds to grams, promoting kg when large', () => {
    const small = toMetric('oz', 4); // ~113g
    expect(small).toEqual({ unit: 'g', value: expect.closeTo(113.4, 1) as unknown as number });
    const large = toMetric('lb', 3); // 1360g -> 1.36kg
    expect(large?.unit).toBe('kg');
    expect(large?.value).toBeCloseTo(1.36, 2);
  });
  it('returns null for count and unknown units', () => {
    expect(toMetric(null, 5)).toBe(null);
    expect(toMetric('clove', 1)).toBe(null);
  });
});

describe('toImperial', () => {
  it('converts ml to cups when large enough', () => {
    const r = toImperial('ml', 250);
    expect(r?.unit).toBe('cup');
    expect(r?.value).toBeCloseTo(1.057, 2);
  });
  it('drops to tbsp / tsp for small volumes', () => {
    expect(toImperial('ml', 30)?.unit).toBe('tbsp');
    expect(toImperial('ml', 5)?.unit).toBe('tsp');
  });
  it('converts grams to lb / oz', () => {
    expect(toImperial('g', 500)?.unit).toBe('lb');
    expect(toImperial('g', 100)?.unit).toBe('oz');
  });
  it('returns null for count and unknown units', () => {
    expect(toImperial(null, 5)).toBe(null);
    expect(toImperial('clove', 1)).toBe(null);
  });
});
