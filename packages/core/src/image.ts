/**
 * Upload / scan pipeline (SPEC Sec 7.3): adaptive white-background removal (Otsu threshold on
 * luminance with a soft edge), contrast and tint, then trim to the ink's bounding box.
 * Works on plain RGBA buffers so it is testable without a DOM.
 */
export interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface CleanOptions {
  removeBackground: boolean;
  /** -1..1; positive makes faint ink darker and the edge sharper. */
  contrast: number;
  /** #RRGGBB tint for the ink, or null to keep the original colours. */
  tint: string | null;
}

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Otsu's threshold over 0..255 luminance. */
export function otsu(img: Rgba): number {
  const hist = new Array<number>(256).fill(0);
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    const l = Math.round(lum(img.data[k] ?? 0, img.data[k + 1] ?? 0, img.data[k + 2] ?? 0));
    hist[l] = (hist[l] ?? 0) + 1;
  }
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * (hist[t] ?? 0);
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let first = 160;
  let last = 160;
  for (let t = 0; t < 256; t++) {
    wB += hist[t] ?? 0;
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * (hist[t] ?? 0);
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      first = t;
      last = t;
    } else if (between === best) last = t;
  }
  // Plateau of equal scores (two clean classes): take its middle.
  return Math.round((first + last) / 2);
}

function hexRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Returns a new RGBA buffer with the background made transparent and the ink adjusted. */
export function cleanSignatureImage(img: Rgba, o: CleanOptions): Rgba {
  const out = new Uint8ClampedArray(img.data);
  const tint = o.tint ? hexRgb(o.tint) : null;
  const thr = otsu(img);
  // Soft band below the threshold so anti-aliased edges keep partial alpha.
  const band = Math.max(8, 40 * (1 - Math.max(-1, Math.min(1, o.contrast))));
  const gamma = 1 / (1 + Math.max(-0.9, Math.min(1, o.contrast)));
  for (let k = 0; k < out.length; k += 4) {
    const r = out[k] ?? 0;
    const g = out[k + 1] ?? 0;
    const b = out[k + 2] ?? 0;
    const a0 = out[k + 3] ?? 255;
    let alpha = a0;
    if (o.removeBackground) {
      const l = lum(r, g, b);
      const ink = Math.min(1, Math.max(0, (thr + band / 2 - l) / band));
      alpha = Math.round(a0 * ink ** gamma);
    }
    if (tint) {
      out[k] = tint[0];
      out[k + 1] = tint[1];
      out[k + 2] = tint[2];
    }
    out[k + 3] = alpha;
  }
  return { data: out, width: img.width, height: img.height };
}

/** Bounding box of pixels with alpha > `min`, or null when empty. */
export function inkBounds(
  img: Rgba,
  min = 8,
): { x: number; y: number; w: number; h: number } | null {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if ((img.data[(y * img.width + x) * 4 + 3] ?? 0) > min) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
