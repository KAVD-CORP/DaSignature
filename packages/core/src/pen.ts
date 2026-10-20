/**
 * PenEngine (SPEC Sec 7.1/7.2): settings, presets, stroke outlines (perfect-freehand) and the
 * single combined SVG path that is stored once and exported as a vector.
 */
import { getStroke } from 'perfect-freehand';

/** A raw input point: x, y (pad px), pressure 0..1, t (ms since stroke start). */
export type RawPoint = [x: number, y: number, pressure: number, t: number];
export interface Stroke {
  points: RawPoint[];
  /** True when the device reported real pressure (pen); otherwise velocity-simulated. */
  realPressure: boolean;
}

export type PresetId = 'fine-liner' | 'ballpoint' | 'fountain' | 'calligraphy' | 'marker';

export interface PenSettings {
  /** Stroke diameter, 0.5..16 px. */
  weight: number;
  /** 0..1: how much pressure/speed thins the line. */
  thinning: number;
  /** 0..100 %: taper at both ends, as a share of the stroke length. */
  taper: number;
  /** 0..1 (perfect-freehand streamline). */
  smoothing: number;
  color: string;
  /** 0.1..1, applied to the whole signature as a group. */
  opacity: number;
  pressure: boolean;
  /** 0..90 degrees, Calligraphy only. */
  nibAngle: number;
  preset: PresetId | 'custom';
}

export const INK_COLORS = [
  { id: 'ink-black', name: 'Ink black', hex: '#1B1F2A' },
  { id: 'ink-blue', name: 'Ink blue', hex: '#1F3A8A' },
  { id: 'ink-deep-red', name: 'Deep red', hex: '#8B1E2B' },
  { id: 'ink-graphite', name: 'Graphite', hex: '#4B4F58' },
] as const;

const BASE = { color: INK_COLORS[0].hex, opacity: 1, pressure: true, nibAngle: 45 };
export const PRESETS: Record<PresetId, Omit<PenSettings, 'color' | 'opacity'> & { name: string }> =
  {
    'fine-liner': {
      ...BASE,
      name: 'Fine Liner',
      preset: 'fine-liner',
      weight: 1.5,
      thinning: 0.1,
      taper: 0,
      smoothing: 0.5,
    },
    ballpoint: {
      ...BASE,
      name: 'Ballpoint',
      preset: 'ballpoint',
      weight: 2.5,
      thinning: 0.35,
      taper: 10,
      smoothing: 0.5,
    },
    fountain: {
      ...BASE,
      name: 'Fountain',
      preset: 'fountain',
      weight: 4,
      thinning: 0.65,
      taper: 30,
      smoothing: 0.6,
    },
    calligraphy: {
      ...BASE,
      name: 'Calligraphy',
      preset: 'calligraphy',
      weight: 7,
      thinning: 0.2,
      taper: 15,
      smoothing: 0.6,
    },
    marker: {
      ...BASE,
      name: 'Marker',
      preset: 'marker',
      weight: 9,
      thinning: 0,
      taper: 0,
      smoothing: 0.4,
    },
  };
export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export function presetSettings(
  id: PresetId,
  keep?: Pick<PenSettings, 'color' | 'opacity'>,
): PenSettings {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- drop the label
  const { name: _name, ...p } = PRESETS[id];
  return { ...p, color: keep?.color ?? BASE.color, opacity: keep?.opacity ?? 1 };
}
export const DEFAULT_PEN: PenSettings = presetSettings('ballpoint');

export const LIMITS = {
  weight: [0.5, 16],
  thinning: [0, 1],
  taper: [0, 100],
  smoothing: [0, 1],
  opacity: [0.1, 1],
  nibAngle: [0, 90],
} as const;

/** Clamps every numeric setting to its documented range (stored settings are untrusted). */
export function clampSettings(s: PenSettings): PenSettings {
  const c = (v: number, [lo, hi]: readonly [number, number]) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
  return {
    ...s,
    weight: c(s.weight, LIMITS.weight),
    thinning: c(s.thinning, LIMITS.thinning),
    taper: c(s.taper, LIMITS.taper),
    smoothing: c(s.smoothing, LIMITS.smoothing),
    opacity: c(s.opacity, LIMITS.opacity),
    nibAngle: c(s.nibAngle, LIMITS.nibAngle),
  };
}

function strokeLength(pts: readonly RawPoint[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a && b) len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

/** Calligraphy: width follows the angle between the stroke direction and the nib. */
function nibPressure(pts: readonly RawPoint[], nibDeg: number): RawPoint[] {
  const nib = (nibDeg * Math.PI) / 180;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)] ?? p;
    const b = pts[Math.min(pts.length - 1, i + 1)] ?? p;
    const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const f = Math.abs(Math.sin(dir - nib));
    return [p[0], p[1], 0.15 + 0.85 * f, p[3]];
  });
}

/** Outline polygon of one stroke. */
export function strokeOutline(stroke: Stroke, s: PenSettings, last = true): number[][] {
  const calligraphy = s.preset === 'calligraphy';
  const pts = calligraphy ? nibPressure(stroke.points, s.nibAngle) : stroke.points;
  const simulate = !calligraphy && (!s.pressure || !stroke.realPressure);
  const taper = (strokeLength(pts) * s.taper) / 100;
  return getStroke(
    pts.map((p) => [p[0], p[1], s.pressure || calligraphy ? p[2] : 0.5]),
    {
      size: s.weight,
      thinning: calligraphy ? 0.7 : s.thinning,
      smoothing: 0.5,
      streamline: s.smoothing * 0.9,
      simulatePressure: simulate && s.thinning > 0,
      start: { taper, cap: true },
      end: { taper, cap: true },
      last,
    },
  );
}

const r = (n: number) => Math.round(n * 100) / 100;

/** Closed SVG path for one outline (quadratic smoothing between midpoints). */
export function outlineToPath(points: readonly number[][]): string {
  const n = points.length;
  if (n < 2) return '';
  const p = (i: number) => points[i % n] ?? [0, 0];
  const [x0 = 0, y0 = 0] = p(0);
  const [x1 = 0, y1 = 0] = p(1);
  let d = `M${String(r(x0))},${String(r(y0))}Q${String(r(x1))},${String(r(y1))} ${String(r((x1 + (p(2)[0] ?? 0)) / 2))},${String(r((y1 + (p(2)[1] ?? 0)) / 2))}`;
  for (let i = 2; i < n; i++) {
    const [ax = 0, ay = 0] = p(i);
    const [bx = 0, by = 0] = p(i + 1);
    d += `T${String(r((ax + bx) / 2))},${String(r((ay + by) / 2))}`;
  }
  return `${d}Z`;
}

export interface VectorSignature {
  /** SVG path data in the viewBox space (origin top-left), nonzero fill. */
  d: string;
  width: number;
  height: number;
}

/** Bounding box of outline polygons. */
function bounds(polys: readonly number[][][]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys)
    for (const [x = 0, y = 0] of poly) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  return { minX, minY, maxX, maxY };
}

/** All strokes as ONE path (so group opacity never darkens overlaps), cropped to its bounds. */
export function strokesToVector(
  strokes: readonly Stroke[],
  s: PenSettings,
  pad = 2,
): VectorSignature | null {
  const polys = strokes.filter((k) => k.points.length > 0).map((k) => strokeOutline(k, s));
  if (polys.length === 0) return null;
  const b = bounds(polys);
  const ox = b.minX - pad;
  const oy = b.minY - pad;
  const d = polys
    .map((poly) => outlineToPath(poly.map(([x = 0, y = 0]) => [x - ox, y - oy])))
    .join('');
  return { d, width: r(b.maxX - b.minX + pad * 2), height: r(b.maxY - b.minY + pad * 2) };
}

/** Stored form of a vector signature (`signatures.svg_path`): a minimal standalone SVG. */
export function vectorToSvg(v: VectorSignature, color: string, opacity: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(v.width)} ${String(v.height)}"><path d="${v.d}" fill="${color}" fill-opacity="${String(opacity)}" fill-rule="nonzero"/></svg>`;
}

/** Parses the stored SVG back into path data + box (only our own minimal format is accepted). */
export function parseStoredSvg(svg: string): VectorSignature | null {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const d = /<path d="([^"]*)"/.exec(svg);
  if (!vb?.[1] || !vb[2] || d?.[1] === undefined) return null;
  if (!/^[MQTLCZz0-9.,\s-]*$/.test(d[1])) return null;
  return { d: d[1], width: Number(vb[1]), height: Number(vb[2]) };
}

/** strokes_json payload: raw points + settings (SPEC Sec 7.1). */
export interface StrokesPayload {
  v: 1;
  width: number;
  height: number;
  strokes: Stroke[];
  settings: PenSettings;
}

/** Initials from a full name: first letter of each word, max 3 ("Ada M. Lovelace" -> "AML"). */
const SEG = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (Array.from(SEG.segment(w))[0]?.segment ?? '').toLocaleUpperCase())
    .join('')
    .slice(0, 3);
}

/** WCAG relative-luminance contrast of a #RRGGBB color on white. */
export function contrastOnWhite(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) return 1;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
  return 1.05 / (L + 0.05);
}
