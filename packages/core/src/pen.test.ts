import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PEN,
  PRESET_IDS,
  clampSettings,
  cleanSignatureImage,
  contrastOnWhite,
  initialsOf,
  inkBounds,
  otsu,
  parseStoredSvg,
  presetSettings,
  strokesToVector,
  vectorToSvg,
  type Stroke,
} from './index.ts';

const zigzag = (): Stroke => ({
  realPressure: false,
  points: Array.from({ length: 40 }, (_, i) => [10 + i * 5, 50 + (i % 2 ? 20 : -20), 0.5, i * 8]),
});

describe('PenEngine', () => {
  it('builds one cropped vector path from strokes, and it round-trips through the stored SVG', () => {
    const v = strokesToVector([zigzag(), zigzag()], DEFAULT_PEN);
    expect(v).not.toBeNull();
    if (!v) return;
    expect(v.d.startsWith('M')).toBe(true);
    expect(v.d.split('Z').length - 1).toBe(2);
    expect(v.width).toBeGreaterThan(190);
    expect(v.height).toBeGreaterThan(40);
    const svg = vectorToSvg(v, '#1B1F2A', 0.5);
    expect(parseStoredSvg(svg)).toEqual(v);
    expect(parseStoredSvg('<svg viewBox="0 0 1 1"><path d="M0,0<script>"/></svg>')).toBeNull();
  });
  it('every setting changes the outline (live preview depends on all of them)', () => {
    const base = strokesToVector([zigzag()], DEFAULT_PEN)?.d;
    for (const patch of [{ weight: 8 }, { thinning: 0.9 }, { taper: 80 }, { smoothing: 0.1 }]) {
      expect(strokesToVector([zigzag()], { ...DEFAULT_PEN, ...patch })?.d).not.toBe(base);
    }
    for (const id of PRESET_IDS)
      expect(strokesToVector([zigzag()], presetSettings(id))?.d).toBeTruthy();
  });
  it('clamps untrusted settings to the spec ranges', () => {
    const c = clampSettings({
      ...DEFAULT_PEN,
      weight: 99,
      opacity: 0,
      thinning: Number.NaN,
      nibAngle: 200,
    });
    expect([c.weight, c.opacity, c.thinning, c.nibAngle]).toEqual([16, 0.1, 0, 90]);
  });
  it('derives initials and colour contrast', () => {
    expect(initialsOf('Ada M. Lovelace')).toBe('AML');
    expect(initialsOf('  émile  zola ')).toBe('ÉZ');
    expect(contrastOnWhite('#1B1F2A')).toBeGreaterThan(16);
    expect(contrastOnWhite('#FFFF00')).toBeLessThan(4.5);
  });
});

describe('image pipeline', () => {
  const img = (w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4).fill(245);
    for (let y = 10; y < 20; y++)
      for (let x = 5; x < 30; x++) data.set([20, 20, 30, 255], (y * w + x) * 4);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    return { data, width: w, height: h };
  };
  it('removes a white background and trims to the ink', () => {
    const src = img(40, 30);
    expect(otsu(src)).toBeGreaterThan(30);
    const out = cleanSignatureImage(src, { removeBackground: true, contrast: 0, tint: '#1F3A8A' });
    expect(out.data[3]).toBe(0);
    const k = (15 * 40 + 10) * 4;
    expect(out.data[k + 3]).toBe(255);
    expect([out.data[k], out.data[k + 1], out.data[k + 2]]).toEqual([0x1f, 0x3a, 0x8a]);
    expect(inkBounds(out)).toEqual({ x: 5, y: 10, w: 25, h: 10 });
  });
});
