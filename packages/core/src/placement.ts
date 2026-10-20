/**
 * Placement geometry (SPEC Sec 7.4): page-relative boxes, snapping, nudging, field defaults and
 * date formatting. Coordinates are fractions of the page (0..1), origin top-left, y down; the box
 * is the unrotated rectangle and `rotation` (degrees, clockwise) turns it about its centre.
 */

export type FieldType = 'signature' | 'initials' | 'date' | 'text' | 'checkbox' | 'name';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageDims {
  /** PDF points. */
  width: number;
  height: number;
}

/** Field payload stored (encrypted) in placements.data_json. */
export interface FieldData {
  /** Text / full name content; for dates the ISO day (YYYY-MM-DD). */
  text?: string;
  /** Date format id (see DATE_FORMATS). */
  format?: string;
  checked?: boolean;
  /** Original field kind when it differs from the stored type ('name' is stored as 'text'). */
  field?: FieldType;
}

export const MARGIN_PT = 36; // 1/2 inch (design 03)
export const SNAP_PX = 6;

export interface Guides {
  /** Vertical guide x positions (fractions of page width). */
  v: number[];
  /** Horizontal guide y positions (fractions of page height). */
  h: number[];
}

/**
 * Snaps a moving box's edges and centre to the page centre, the 1/2-inch margins and the other
 * boxes' edges and centres. `tolX`/`tolY` are the snap distances as page fractions.
 */
export function snapBox(
  box: Box,
  others: readonly Box[],
  page: PageDims,
  tolX: number,
  tolY: number,
): Box & { guides: Guides } {
  const mx = MARGIN_PT / page.width;
  const my = MARGIN_PT / page.height;
  const xs = [0.5, mx, 1 - mx];
  const ys = [0.5, my, 1 - my];
  for (const o of others) {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  const pick = (start: number, size: number, targets: number[], tol: number) => {
    let best: { d: number; at: number; line: number } | undefined;
    for (const off of [0, size / 2, size]) {
      for (const tgt of targets) {
        const d = Math.abs(start + off - tgt);
        if (d <= tol && (!best || d < best.d)) best = { d, at: tgt - off, line: tgt };
      }
    }
    return best;
  };
  const sx = pick(box.x, box.w, xs, tolX);
  const sy = pick(box.y, box.h, ys, tolY);
  return {
    ...box,
    x: sx ? sx.at : box.x,
    y: sy ? sy.at : box.y,
    guides: { v: sx ? [sx.line] : [], h: sy ? [sy.line] : [] },
  };
}

/** Keeps the box centre on the page so a placement can never be lost off-page. */
export function clampBox(box: Box): Box {
  const cx = Math.min(1, Math.max(0, box.x + box.w / 2));
  const cy = Math.min(1, Math.max(0, box.y + box.h / 2));
  return { ...box, x: cx - box.w / 2, y: cy - box.h / 2 };
}

/** Arrow-key nudge: 1 px (10 with Shift) in screen pixels at the current zoom. */
export function nudge(box: Box, dx: number, dy: number, page: PageDims, pxPerPt: number): Box {
  return clampBox({
    ...box,
    x: box.x + dx / (page.width * pxPerPt),
    y: box.y + dy / (page.height * pxPerPt),
  });
}

/**
 * Resizes from a corner (0 = top-left, 1 = top-right, 2 = bottom-right, 3 = bottom-left) to the
 * pointer, in page points. With `lock` the aspect ratio is kept. Rotation is handled by the caller
 * by un-rotating the pointer into the box frame first.
 */
export function resizeBox(
  box: Box,
  corner: 0 | 1 | 2 | 3,
  dxPt: number,
  dyPt: number,
  page: PageDims,
  lock: boolean,
  minPt = 8,
): Box {
  let w = box.w * page.width;
  let h = box.h * page.height;
  const sx = corner === 1 || corner === 2 ? 1 : -1;
  const sy = corner === 2 || corner === 3 ? 1 : -1;
  let nw = Math.max(minPt, w + sx * dxPt);
  let nh = Math.max(minPt, h + sy * dyPt);
  if (lock) {
    const k = Math.max(nw / w, nh / h);
    nw = Math.max(minPt, w * k);
    nh = Math.max(minPt, h * k);
  }
  // Anchor the opposite corner.
  const left = box.x * page.width;
  const top = box.y * page.height;
  const x = sx > 0 ? left : left + w - nw;
  const y = sy > 0 ? top : top + h - nh;
  w = nw;
  h = nh;
  return { x: x / page.width, y: y / page.height, w: w / page.width, h: h / page.height };
}

/** Angle in degrees from the box centre to a point, 0 = straight up; snaps near 0/90/180/270. */
export function rotationTo(cx: number, cy: number, px: number, py: number, snap = true): number {
  let a = (Math.atan2(px - cx, cy - py) * 180) / Math.PI;
  if (snap) {
    for (const s of [-180, -90, 0, 90, 180]) if (Math.abs(a - s) < 4) a = s;
  }
  return normalizeAngle(a);
}

export function normalizeAngle(a: number): number {
  let r = a % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return Math.round(r * 10) / 10;
}

/** Default size in points for a new field of each kind. */
export function defaultSizePt(type: FieldType, aspect = 3): { w: number; h: number } {
  switch (type) {
    case 'signature': {
      const w = 160;
      return { w, h: w / Math.max(0.2, aspect) };
    }
    case 'initials': {
      const h = 36;
      return { w: h * Math.max(0.5, aspect), h };
    }
    case 'checkbox':
      return { w: 14, h: 14 };
    case 'date':
      return { w: 96, h: 16 };
    case 'text':
    case 'name':
      return { w: 140, h: 16 };
  }
}

/** Box of `sizePt` centred on the page point (fractions). */
export function boxAt(
  cx: number,
  cy: number,
  sizePt: { w: number; h: number },
  page: PageDims,
): Box {
  const w = sizePt.w / page.width;
  const h = sizePt.h / page.height;
  return clampBox({ x: cx - w / 2, y: cy - h / 2, w, h });
}

/* ------------------------------ dates ------------------------------ */

export const DATE_FORMATS = [
  'locale-medium',
  'locale-short',
  'locale-long',
  'YYYY-MM-DD',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'DD.MM.YYYY',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** Today as YYYY-MM-DD in local time. */
export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(now.getFullYear())}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Formats an ISO day; locale formats use Intl so they follow the user's language. */
export function formatDate(iso: string, format: string, locale?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y = '', mo = '', d = ''] = m;
  switch (format) {
    case 'YYYY-MM-DD':
      return `${y}-${mo}-${d}`;
    case 'DD/MM/YYYY':
      return `${d}/${mo}/${y}`;
    case 'MM/DD/YYYY':
      return `${mo}/${d}/${y}`;
    case 'DD.MM.YYYY':
      return `${d}.${mo}.${y}`;
    default: {
      const style =
        format === 'locale-short' ? 'short' : format === 'locale-long' ? 'long' : 'medium';
      const date = new Date(Number(y), Number(mo) - 1, Number(d));
      try {
        return new Intl.DateTimeFormat(locale, { dateStyle: style }).format(date);
      } catch {
        return `${y}-${mo}-${d}`;
      }
    }
  }
}

/** Accessible size phrase: "42 by 13 percent" of the page. */
export function sizePercent(box: Box): { w: number; h: number } {
  return { w: Math.round(box.w * 100), h: Math.round(box.h * 100) };
}

/** Bounded undo/redo history of immutable snapshots. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(private readonly limit = 200) {}
  push(prev: T): void {
    this.past.push(prev);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(current: T): T | undefined {
    const prev = this.past.pop();
    if (prev !== undefined) this.future.push(current);
    return prev;
  }
  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next !== undefined) this.past.push(current);
    return next;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
