import { describe, expect, it } from 'vitest';
import {
  History,
  boxAt,
  formatDate,
  normalizeAngle,
  nudge,
  resizeBox,
  rotationTo,
  snapBox,
} from './placement.ts';

const page = { width: 612, height: 792 };

describe('placement geometry', () => {
  it('snaps the centre to the page centre and edges to margins and other boxes', () => {
    const s = snapBox({ x: 0.401, y: 0.2, w: 0.2, h: 0.05 }, [], page, 0.01, 0.01);
    expect(s.x).toBeCloseTo(0.4);
    expect(s.guides.v).toEqual([0.5]);
    const m = snapBox({ x: 36 / 612 + 0.004, y: 0.3, w: 0.1, h: 0.1 }, [], page, 0.01, 0.0001);
    expect(m.x).toBeCloseTo(36 / 612);
    const o = snapBox(
      { x: 0.2, y: 0.705, w: 0.1, h: 0.1 },
      [{ x: 0.6, y: 0.6, w: 0.1, h: 0.1 }],
      page,
      0.0001,
      0.01,
    );
    expect(o.y).toBeCloseTo(0.7);
    expect(o.guides.h).toEqual([0.7]);
  });
  it('nudges by screen pixels at the current zoom', () => {
    const b = nudge({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 10, -1, page, 96 / 72);
    expect((b.x - 0.5) * 612 * (96 / 72)).toBeCloseTo(10);
    expect((b.y - 0.5) * 792 * (96 / 72)).toBeCloseTo(-1);
  });
  it('resizes from a corner keeping the aspect ratio and the opposite corner', () => {
    const b = { x: 0.1, y: 0.1, w: 100 / 612, h: 50 / 792 };
    const r = resizeBox(b, 2, 100, 0, page, true);
    expect(r.w * 612).toBeCloseTo(200);
    expect(r.h * 792).toBeCloseTo(100);
    expect(r.x).toBeCloseTo(0.1);
    const tl = resizeBox(b, 0, 50, 0, page, false);
    expect(tl.w * 612).toBeCloseTo(50);
    expect((tl.x + tl.w) * 612).toBeCloseTo((b.x + b.w) * 612);
  });
  it('rotation snaps near right angles and normalizes', () => {
    expect(rotationTo(0, 0, 100, 2)).toBe(90);
    expect(rotationTo(0, 0, 0, -10)).toBe(0);
    expect(normalizeAngle(270)).toBe(-90);
    expect(boxAt(0.5, 0.5, { w: 61.2, h: 79.2 }, page)).toEqual({
      x: 0.45,
      y: 0.45,
      w: 0.1,
      h: 0.1,
    });
  });
  it('formats dates in fixed and locale formats', () => {
    expect(formatDate('2026-10-20', 'DD/MM/YYYY')).toBe('20/10/2026');
    expect(formatDate('2026-10-20', 'locale-medium', 'en-US')).toBe('Oct 20, 2026');
    expect(formatDate('2026-10-20', 'locale-long', 'de-DE')).toBe('20. Oktober 2026');
  });
  it('keeps an undo/redo history', () => {
    const h = new History<number>();
    h.push(1);
    h.push(2);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBe(1);
    expect(h.redo(1)).toBe(2);
    expect(h.canRedo).toBe(true);
    h.push(2);
    expect(h.canRedo).toBe(false);
  });
});
