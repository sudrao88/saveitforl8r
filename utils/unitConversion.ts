/**
 * Unit conversion for recipe ingredients.
 *
 * Two domains: volume (base ml) and weight (base g). Cross-domain conversion
 * is intentionally unsupported because volume <-> weight depends on density of
 * the specific ingredient, which is out of scope here.
 *
 * "count" units (e.g. "3 eggs") and "unknown" units pass through unchanged.
 */

export type UnitDomain = 'volume' | 'weight' | 'count' | 'unknown';

const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  l: 1000,
  tsp: 4.92892,
  tbsp: 14.7868,
  fl_oz: 29.5735,
  cup: 236.588,
  pint: 473.176,
  quart: 946.353,
  gallon: 3785.41,
};

const WEIGHT_TO_G: Record<string, number> = {
  g: 1,
  kg: 1000,
  oz: 28.3495,
  lb: 453.592,
};

export function getDomain(unit: string | null): UnitDomain {
  if (unit === null) return 'count';
  if (unit in VOLUME_TO_ML) return 'volume';
  if (unit in WEIGHT_TO_G) return 'weight';
  return 'unknown';
}

/**
 * Convert a value between two units in the same domain.
 * Returns null when domains differ or either unit is unknown.
 */
export function convert(value: number, from: string, to: string): number | null {
  if (from === to) return value;
  const fromDomain = getDomain(from);
  const toDomain = getDomain(to);
  if (fromDomain !== toDomain) return null;

  if (fromDomain === 'volume') {
    return (value * VOLUME_TO_ML[from]) / VOLUME_TO_ML[to];
  }
  if (fromDomain === 'weight') {
    return (value * WEIGHT_TO_G[from]) / WEIGHT_TO_G[to];
  }
  return null;
}

/**
 * Pick the metric unit for a given source unit. Volume -> ml/l, weight -> g/kg.
 * `value` is the source quantity in the source unit; we promote ml->l or g->kg
 * once the converted magnitude crosses 1000 to keep numbers readable.
 * Returns null for non-convertible units (count, unknown).
 */
export function toMetric(unit: string | null, value: number): { unit: string; value: number } | null {
  const domain = getDomain(unit);
  if (domain === 'volume') {
    const ml = (value * VOLUME_TO_ML[unit as string]);
    if (ml >= 1000) return { unit: 'l', value: ml / 1000 };
    return { unit: 'ml', value: ml };
  }
  if (domain === 'weight') {
    const g = (value * WEIGHT_TO_G[unit as string]);
    if (g >= 1000) return { unit: 'kg', value: g / 1000 };
    return { unit: 'g', value: g };
  }
  return null;
}

/**
 * Pick the imperial unit for a given source unit. Volume -> cup/tbsp/tsp,
 * weight -> lb/oz. We pick the largest unit where the magnitude is at least 1
 * to avoid awkward "0.05 cup" displays.
 * Returns null for non-convertible units (count, unknown).
 */
export function toImperial(unit: string | null, value: number): { unit: string; value: number } | null {
  const domain = getDomain(unit);
  if (domain === 'volume') {
    const ml = value * VOLUME_TO_ML[unit as string];
    const ladder: Array<{ unit: string; mlPer: number }> = [
      { unit: 'cup', mlPer: VOLUME_TO_ML.cup },
      { unit: 'tbsp', mlPer: VOLUME_TO_ML.tbsp },
      { unit: 'tsp', mlPer: VOLUME_TO_ML.tsp },
    ];
    for (const step of ladder) {
      if (ml / step.mlPer >= 1) return { unit: step.unit, value: ml / step.mlPer };
    }
    // Tiny amounts: keep as tsp rather than promoting to cup
    return { unit: 'tsp', value: ml / VOLUME_TO_ML.tsp };
  }
  if (domain === 'weight') {
    const g = value * WEIGHT_TO_G[unit as string];
    const lbs = g / WEIGHT_TO_G.lb;
    if (lbs >= 1) return { unit: 'lb', value: lbs };
    return { unit: 'oz', value: g / WEIGHT_TO_G.oz };
  }
  return null;
}
