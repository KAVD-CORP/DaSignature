/**
 * Continuous-scroll PDF view (SPEC Sec 3.1 Viewer; design 03-editor): virtualized pages, at most
 * MAX_CANVASES live canvases (PERF-04), pinch / Ctrl+wheel zoom anchored on the viewport centre,
 * per-page error + Retry. The page is painted by pdf.js on a white --pdf-page backdrop and is never
 * filtered or inverted in dark mode (THEME-04).
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { t } from '@dasignature/i18n';
import { renderPage, type PDFDocumentProxy } from '@dasignature/pdf/render';
import { Button, Spinner } from './ui.tsx';

export const MAX_CANVASES = 10;
export const GAP = 16;
export const PAD = 16;
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 8 * (96 / 72); // 800 %
export const PX_PER_PT = 96 / 72; // 100 % zoom

export interface PageSize {
  width: number;
  height: number;
}

export interface ViewerHandle {
  scrollToPage: (index: number) => void;
  element: () => HTMLDivElement | null;
}

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** Page tops in CSS px at `scale`, plus the total height. */
export function layout(
  sizes: readonly PageSize[],
  scale: number,
): { tops: number[]; total: number } {
  const tops: number[] = [];
  let y = PAD;
  for (const s of sizes) {
    tops.push(y);
    y += s.height * scale + GAP;
  }
  return { tops, total: y - GAP + PAD };
}

/** Pages to keep rendered: the visible ones plus one either side, nearest first, capped. */
export function renderSet(
  first: number,
  last: number,
  count: number,
  cap = MAX_CANVASES,
): number[] {
  const want: number[] = [];
  const centre = (first + last) / 2;
  for (let i = Math.max(0, first - 1); i <= Math.min(count - 1, last + 1); i++) want.push(i);
  want.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre));
  return want.slice(0, cap);
}

function PageView({
  pdf,
  index,
  count,
  size,
  scale,
  active,
  overlay,
}: {
  pdf: PDFDocumentProxy;
  index: number;
  count: number;
  size: PageSize;
  scale: number;
  active: boolean;
  overlay?: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle');
  const [attempt, setAttempt] = useState(0);
  const [renderScale, setRenderScale] = useState(scale);

  // Debounce re-rendering while the user zooms; the old bitmap is CSS-scaled meanwhile.
  useEffect(() => {
    const h = setTimeout(() => {
      setRenderScale(scale);
    }, 120);
    return () => {
      clearTimeout(h);
    };
  }, [scale]);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const st = { cancelled: false };
    const stopped = () => st.cancelled;
    let task: ReturnType<typeof renderPage> | undefined;
    void (async () => {
      try {
        const page = await pdf.getPage(index + 1);
        if (stopped()) return;
        // Render off-screen, then swap, so a re-render at a new zoom never flashes blank.
        const off = document.createElement('canvas');
        task = renderPage(page, off, renderScale);
        await task.promise;
        if (stopped()) return;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext('2d')?.drawImage(off, 0, 0);
        off.width = 0;
        off.height = 0;
        setState('done');
      } catch (err) {
        if (stopped() || (err instanceof Error && err.name === 'RenderingCancelledException'))
          return;
        setState('error');
      }
    })();
    return () => {
      st.cancelled = true;
      task?.cancel();
    };
  }, [active, pdf, index, renderScale, attempt]);

  useEffect(() => {
    if (!active) return;
    return () => {
      setState('idle');
    };
  }, [active]);

  const w = size.width * scale;
  const h = size.height * scale;
  return (
    <div
      data-page-index={index}
      className="relative mx-auto border border-border bg-pdf-page"
      style={{ width: w + 2, height: h + 2 }}
    >
      <div
        role="img"
        aria-label={t('viewer.pageOf', { page: String(index + 1), count: String(count) })}
        className="absolute inset-0 bg-pdf-page"
      >
        {active ? <canvas ref={canvasRef} data-pdf-canvas className="block h-full w-full" /> : null}
      </div>
      {state === 'rendering' || state === 'idle' ? (
        <div className="absolute inset-0 flex items-center justify-center text-pdf-ink">
          <Spinner />
        </div>
      ) : null}
      {state === 'error' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-pdf-page p-4 text-center text-pdf-ink">
          <p className="text-body-sm">{t('viewer.pageError', { page: String(index + 1) })}</p>
          <Button
            onClick={() => {
              setAttempt((a) => a + 1);
            }}
          >
            {t('app.retry')}
          </Button>
        </div>
      ) : null}
      {overlay}
    </div>
  );
}

export const PdfViewer = forwardRef<
  ViewerHandle,
  {
    pdf: PDFDocumentProxy;
    sizes: readonly PageSize[];
    scale: number;
    onScale: (s: number) => void;
    onCurrent: (index: number) => void;
    overlay?: (index: number, size: PageSize, scale: number) => ReactNode;
  }
>(function PdfViewer({ pdf, sizes, scale, onScale, onCurrent, overlay }, ref) {
  const scroller = useRef<HTMLDivElement>(null);
  const { tops, total } = useMemo(() => layout(sizes, scale), [sizes, scale]);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const count = sizes.length;
  const maxW = useMemo(
    () => Math.max(0, ...sizes.map((s) => s.width)) * scale + 2 + PAD * 2,
    [sizes, scale],
  );

  const update = useCallback(() => {
    const el = scroller.current;
    if (!el || count === 0) return;
    const top = el.scrollTop;
    const bottom = top + el.clientHeight;
    let first = 0;
    while (first < count - 1 && (tops[first] ?? 0) + (sizes[first]?.height ?? 0) * scale < top)
      first++;
    let last = first;
    while (last < count - 1 && (tops[last + 1] ?? Infinity) < bottom) last++;
    setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
    const mid = top + el.clientHeight / 2;
    let cur = first;
    while (cur < last && (tops[cur + 1] ?? Infinity) <= mid) cur++;
    onCurrent(cur);
  }, [count, tops, sizes, scale, onCurrent]);

  // Keep the point under the viewport centre fixed across zoom changes.
  const prev = useRef({ scale, tops });
  useLayoutEffect(() => {
    const el = scroller.current;
    const p = prev.current;
    prev.current = { scale, tops };
    if (!el || p.scale === scale) return;
    const mid = el.scrollTop + el.clientHeight / 2;
    let i = 0;
    while (i < count - 1 && (p.tops[i + 1] ?? Infinity) <= mid) i++;
    const ratio = (mid - (p.tops[i] ?? 0)) / ((sizes[i]?.height ?? 1) * p.scale);
    el.scrollTop = (tops[i] ?? 0) + ratio * (sizes[i]?.height ?? 1) * scale - el.clientHeight / 2;
    const midX = el.scrollLeft + el.clientWidth / 2;
    el.scrollLeft = midX * (scale / p.scale) - el.clientWidth / 2;
  }, [scale, tops, sizes, count]);

  useEffect(() => {
    // Syncing with the DOM scroll position (an external system) after layout changes.
    update();
  }, [update]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToPage: (index: number) => {
        const el = scroller.current;
        if (el) el.scrollTop = (tops[index] ?? 0) - PAD;
      },
      element: () => scroller.current,
    }),
    [tops],
  );

  // Pinch (two touch pointers) and Ctrl/trackpad-pinch wheel zoom.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let start: { d: number; scale: number } | undefined;
    let current = scale;
    const dist = () => {
      const [a, b] = [...pts.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) start = { d: dist(), scale: current };
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (start && pts.size === 2 && start.d > 0) {
        current = clampScale(start.scale * (dist() / start.d));
        onScale(current);
      }
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) start = undefined;
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      current = clampScale(current * Math.exp(-e.deltaY * 0.01));
      onScale(current);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [scale, onScale]);

  const active = useMemo(() => new Set(renderSet(range[0], range[1], count)), [range, count]);
  const from = Math.max(0, range[0] - 2);
  const to = Math.min(count - 1, range[1] + 2);

  return (
    <div
      ref={scroller}
      data-viewer-scroll
      onScroll={update}
      className="relative h-full overflow-auto bg-canvas [touch-action:pan-x_pan-y]"
    >
      <div style={{ height: total, minWidth: maxW }} className="relative">
        {Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => {
          const i = from + k;
          const size = sizes[i];
          if (!size) return null;
          return (
            <div key={i} className="absolute inset-x-0" style={{ top: tops[i] }}>
              <PageView
                pdf={pdf}
                index={i}
                count={count}
                size={size}
                scale={scale}
                active={active.has(i)}
                overlay={overlay?.(i, size, scale)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});
