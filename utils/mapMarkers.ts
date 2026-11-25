/**
 * mapMarkers.ts
 *
 * Marker icons for the in-app places map. Each category (a moment subsection)
 * gets a colour and a glyph shape, so pins stay tellable apart without colour.
 * Like Google Maps, a place is a small round badge until it is selected, then
 * becomes a larger teardrop pin with the same glyph.
 *
 * Icons are SVG data URLs because the Maps SDK draws markers itself. Colours
 * come from the `--color-map-*` tokens in index.css.
 */

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'hexagon';

/** Shapes in palette order: category i uses SHAPES[i]. */
export const MARKER_SHAPES: MarkerShape[] = ['circle', 'square', 'triangle', 'diamond', 'star', 'hexagon'];
export const MARKER_CATEGORY_COUNT = MARKER_SHAPES.length;

/**
 * Spelled out in full so Tailwind sees each token as used and keeps it in the
 * built CSS.
 */
const CATEGORY_TOKENS = [
  '--color-map-category-1',
  '--color-map-category-2',
  '--color-map-category-3',
  '--color-map-category-4',
  '--color-map-category-5',
  '--color-map-category-6',
];

/** Token fallbacks, used only if the stylesheet hasn't defined them. */
const FALLBACK_COLORS = ['#3b82f6', '#f97316', '#a855f7', '#10b981', '#ec4899', '#eab308'];
const FALLBACK_OTHER = '#6b7280';
const FALLBACK_OUTLINE = '#ffffff';

const cssToken = (name: string, fallback: string): string => {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
};

export interface MarkerStyle {
  color: string;
  shape: MarkerShape;
}

/**
 * Style for a category by its palette index (0-based). A negative index is the
 * leftover "Other" category: grey, round.
 */
export const markerStyle = (index: number): MarkerStyle => {
  if (index < 0) return { color: cssToken('--color-map-category-other', FALLBACK_OTHER), shape: 'circle' };
  const i = index % MARKER_CATEGORY_COUNT;
  return { color: cssToken(CATEGORY_TOKENS[i], FALLBACK_COLORS[i]), shape: MARKER_SHAPES[i] };
};

const polygon = (points: [number, number][]) =>
  points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

const regular = (cx: number, cy: number, r: number, sides: number, rotation: number): [number, number][] =>
  Array.from({ length: sides }, (_, k) => {
    const a = rotation + (k * 2 * Math.PI) / sides;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

/** SVG markup for a glyph of `shape` centred on (cx, cy), about 2r across. */
export const glyphSvg = (shape: MarkerShape, cx: number, cy: number, r: number, fill: string): string => {
  const up = -Math.PI / 2;
  switch (shape) {
    case 'circle':
      return `<circle cx="${cx}" cy="${cy}" r="${(r * 0.8).toFixed(2)}" fill="${fill}"/>`;
    case 'square': {
      const s = r * 0.75;
      return `<rect x="${(cx - s).toFixed(2)}" y="${(cy - s).toFixed(2)}" width="${(2 * s).toFixed(2)}" height="${(2 * s).toFixed(2)}" rx="${(s * 0.2).toFixed(2)}" fill="${fill}"/>`;
    }
    case 'triangle':
      return `<polygon points="${polygon(regular(cx, cy + r * 0.15, r, 3, up))}" fill="${fill}"/>`;
    case 'diamond':
      return `<polygon points="${polygon(regular(cx, cy, r, 4, up))}" fill="${fill}"/>`;
    case 'hexagon':
      return `<polygon points="${polygon(regular(cx, cy, r * 0.9, 6, 0))}" fill="${fill}"/>`;
    case 'star': {
      const outer = regular(cx, cy, r, 5, up);
      const inner = regular(cx, cy, r * 0.45, 5, up + Math.PI / 5);
      return `<polygon points="${polygon(outer.flatMap((p, k) => [p, inner[k]]))}" fill="${fill}"/>`;
    }
  }
};

export interface MarkerIcon {
  url: string;
  width: number;
  height: number;
  /** Point of the icon that sits on the place, in icon pixels. */
  anchorX: number;
  anchorY: number;
}

const dataUrl = (svg: string) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

/** Small round badge: a place that isn't selected. */
const BADGE = 26;
/** Teardrop pin: the selected place. */
const PIN_W = 40;
const PIN_H = 54;

export const markerIcon = (style: MarkerStyle, selected: boolean): MarkerIcon => {
  const outline = cssToken('--color-map-marker-outline', FALLBACK_OUTLINE);
  if (!selected) {
    const c = BADGE / 2;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE}" height="${BADGE}" viewBox="0 0 ${BADGE} ${BADGE}">` +
      `<circle cx="${c}" cy="${c}" r="${c - 1.5}" fill="${style.color}" stroke="${outline}" stroke-width="2"/>` +
      glyphSvg(style.shape, c, c, 5.5, outline) +
      `</svg>`;
    return { url: dataUrl(svg), width: BADGE, height: BADGE, anchorX: c, anchorY: c };
  }
  const cx = PIN_W / 2;
  const cy = 19;
  const head = 17;
  const tip = PIN_H - 2;
  // Circle head that narrows to a point at the bottom.
  const pin =
    `M${cx} ${tip} C${cx - 3} ${tip - 9} ${cx - head} ${cy + 12} ${cx - head} ${cy} ` +
    `A${head} ${head} 0 1 1 ${cx + head} ${cy} C${cx + head} ${cy + 12} ${cx + 3} ${tip - 9} ${cx} ${tip} Z`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_W}" height="${PIN_H}" viewBox="0 0 ${PIN_W} ${PIN_H}">` +
    `<path d="${pin}" fill="${style.color}" stroke="${outline}" stroke-width="2.5" stroke-linejoin="round"/>` +
    glyphSvg(style.shape, cx, cy, 8, outline) +
    `</svg>`;
  return { url: dataUrl(svg), width: PIN_W, height: PIN_H, anchorX: cx, anchorY: tip };
};
