/**
 * Drawing pad (SPEC Sec 7.1): Pointer Events with coalesced points, real pressure from pens and
 * simulated pressure otherwise, palm rejection once a stylus is seen, DPR-scaled canvases with a
 * separate live layer, group opacity on the wrapper (overlaps never darken), touch-action:none.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { strokeOutline, type PenSettings, type RawPoint, type Stroke } from '@dasignature/core';
import { t } from '@dasignature/i18n';

export function drawOutline(ctx: CanvasRenderingContext2D, poly: readonly number[][]): void {
  if (poly.length < 2) return;
  ctx.beginPath();
  const [x0 = 0, y0 = 0] = poly[0] ?? [];
  ctx.moveTo(x0, y0);
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i] ?? [0, 0];
    const b = poly[(i + 1) % poly.length] ?? a;
    ctx.quadraticCurveTo(
      a[0] ?? 0,
      a[1] ?? 0,
      ((a[0] ?? 0) + (b[0] ?? 0)) / 2,
      ((a[1] ?? 0) + (b[1] ?? 0)) / 2,
    );
  }
  ctx.closePath();
  ctx.fill();
}

function setup(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function paintStrokes(
  canvas: HTMLCanvasElement,
  strokes: readonly Stroke[],
  s: PenSettings,
  w: number,
  h: number,
) {
  const ctx = setup(canvas, w, h);
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = s.color;
  for (const k of strokes) drawOutline(ctx, strokeOutline(k, s));
}

export function SignaturePad({
  strokes,
  settings,
  onStroke,
  height,
  label,
}: {
  strokes: readonly Stroke[];
  settings: PenSettings;
  onStroke: (s: Stroke) => void;
  height: number;
  label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 0, h: height });
  const latest = useRef({ strokes, settings });

  const repaint = () => {
    const c = base.current;
    if (c)
      paintStrokes(
        c,
        latest.current.strokes,
        latest.current.settings,
        size.current.w,
        size.current.h,
      );
  };

  useLayoutEffect(() => {
    latest.current = { strokes, settings };
    repaint();
  });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      size.current = { w: el.clientWidth, h: el.clientHeight };
      if (live.current) setup(live.current, size.current.w, size.current.h);
      repaint();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const el = live.current;
    if (!el) return;
    let current: { id: number; pts: RawPoint[]; t0: number; real: boolean } | undefined;
    let stylusSeen = false;
    let frame = 0;
    const toPoint = (e: PointerEvent, t0: number): RawPoint => {
      const r = el.getBoundingClientRect();
      const p =
        e.pointerType === 'pen' || (e.pressure > 0 && e.pressure !== 0.5) ? e.pressure : 0.5;
      return [e.clientX - r.left, e.clientY - r.top, p, e.timeStamp - t0];
    };
    const drawLive = () => {
      frame = 0;
      const ctx = el.getContext('2d');
      if (!ctx || !current) return;
      ctx.clearRect(0, 0, size.current.w, size.current.h);
      ctx.fillStyle = latest.current.settings.color;
      drawOutline(
        ctx,
        strokeOutline(
          { points: current.pts, realPressure: current.real },
          latest.current.settings,
          false,
        ),
      );
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'pen') stylusSeen = true;
      if (stylusSeen && e.pointerType === 'touch') return; // palm rejection
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      current = { id: e.pointerId, pts: [], t0: e.timeStamp, real: e.pointerType === 'pen' };
      current.pts.push(toPoint(e, current.t0));
      frame ||= requestAnimationFrame(drawLive);
    };
    const move = (e: PointerEvent) => {
      if (current?.id !== e.pointerId) return;
      e.preventDefault();
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const ce of events.length ? events : [e]) current.pts.push(toPoint(ce, current.t0));
      frame ||= requestAnimationFrame(drawLive);
    };
    const up = (e: PointerEvent) => {
      if (current?.id !== e.pointerId) return;
      const done = current;
      current = undefined;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      el.getContext('2d')?.clearRect(0, 0, size.current.w, size.current.h);
      if (done.pts.length > 0) onStroke({ points: done.pts, realPressure: done.real });
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [onStroke]);

  return (
    <div
      ref={wrap}
      role="img"
      aria-label={label}
      className="relative w-full select-none overflow-hidden rounded-card border border-border-strong bg-pdf-page [touch-action:none]"
      style={{ height }}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-[72%] border-t-[1.5px] border-dashed border-pdf-ink"
      />
      {strokes.length === 0 ? (
        <p
          aria-hidden
          className="pointer-events-none absolute inset-x-6 top-[calc(72%+6px)] text-caption text-pdf-ink"
        >
          {t('studio.hint')}
        </p>
      ) : null}
      <div className="absolute inset-0" style={{ opacity: settings.opacity }}>
        <canvas ref={base} data-pad-layer="strokes" className="absolute inset-0 h-full w-full" />
        <canvas
          ref={live}
          data-pad-layer="live"
          className="absolute inset-0 h-full w-full [touch-action:none]"
        />
      </div>
    </div>
  );
}
