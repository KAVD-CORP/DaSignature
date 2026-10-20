/**
 * Per-page placement overlay (design 03 "Placement", SPEC Sec 7.4): renders placed fields in
 * `--pdf-ink`, handles selection (gold outline + halo + 4 corner handles + rotate handle),
 * drag with snap guides, resize (aspect locked unless Shift / unlocked), rotate, and keyboard.
 */
import { Copy, Droplet, MoreHorizontal, Trash2 } from 'lucide-react';
import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import {
  SNAP_PX,
  clampBox,
  formatDate,
  nudge,
  parseStoredSvg,
  resizeBox,
  rotationTo,
  sizePercent,
  snapBox,
  type Box,
  type FieldType,
  type Guides,
} from '@dasignature/core';
import { t, type MessageKey } from '@dasignature/i18n';
import type { SignatureRecord } from '@dasignature/storage';
import type { PageSize } from './PdfViewer.tsx';
import { SignatureGraphic } from './SignaturePreview.tsx';
import { placements, usePlacements, type Placed } from '../state/placements.ts';
import { useApp } from '../state/app.ts';

export const FIELD_LABEL: Record<FieldType, MessageKey> = {
  signature: 'editor.toolSignature',
  initials: 'editor.toolInitials',
  date: 'editor.toolDate',
  text: 'editor.toolText',
  checkbox: 'editor.toolCheckbox',
  name: 'editor.toolName',
};

export const TEXT_FONT = '"Inter Variable", Inter, system-ui, sans-serif';
/** Text glyph size as a fraction of the field height (shared with export). */
export const TEXT_SIZE_RATIO = 0.75;

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Width in points of `text` in a field `hPt` tall. */
export function textWidthPt(text: string, hPt: number): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const size = hPt * TEXT_SIZE_RATIO;
  if (!measureCtx) return text.length * size * 0.55 + 4;
  measureCtx.font = `100px ${TEXT_FONT}`;
  return (measureCtx.measureText(text || ' ').width / 100) * size + hPt * 0.3;
}

export function fieldText(p: Placed, locale?: string): string {
  if (p.type === 'date')
    return formatDate(p.data.text ?? '', p.data.format ?? 'locale-medium', locale);
  return p.data.text ?? '';
}

/** The visual content of a placement, sized to its box (theme-independent ink). */
export function PlacedContent({
  p,
  hPx,
  sig,
}: {
  p: Placed;
  hPx: number;
  sig: SignatureRecord | undefined;
}) {
  if (p.type === 'signature' || p.type === 'initials') {
    const v = p.data.svg ? parseStoredSvg(p.data.svg) : null;
    if (v)
      return (
        <svg
          aria-hidden
          viewBox={`0 0 ${String(v.width)} ${String(v.height)}`}
          preserveAspectRatio="none"
          className="block h-full w-full"
        >
          <path d={v.d} fill={p.data.color ?? '#1B1F2A'} fillOpacity={p.data.sigOpacity ?? 1} />
        </svg>
      );
    if (sig) return <SignatureGraphic sig={sig} className="block h-full w-full" />;
    return (
      <span className="flex h-full w-full items-center justify-center border border-dashed border-pdf-ink text-pdf-ink text-caption">
        {t('editor.missingSignature')}
      </span>
    );
  }
  if (p.type === 'checkbox')
    return (
      <svg aria-hidden viewBox="0 0 20 20" className="block h-full w-full">
        <rect
          x="1"
          y="1"
          width="18"
          height="18"
          fill="none"
          stroke="var(--pdf-ink)"
          strokeWidth="1.5"
        />
        {p.data.checked ? (
          <path
            d="M4.5 10.5 8.3 14.2 15.5 5.8"
            fill="none"
            stroke="var(--pdf-ink)"
            strokeWidth="2.2"
          />
        ) : null}
      </svg>
    );
  return (
    <span
      className="block h-full w-full overflow-visible whitespace-nowrap text-pdf-ink"
      style={{
        fontFamily: TEXT_FONT,
        fontSize: hPx * TEXT_SIZE_RATIO,
        lineHeight: `${String(hPx)}px`,
        paddingLeft: hPx * 0.15,
      }}
    >
      {fieldText(p) || (p.type === 'text' ? '\u00a0' : '')}
    </span>
  );
}

interface Gesture {
  kind: 'move' | 'resize' | 'rotate';
  corner?: 0 | 1 | 2 | 3;
  startX: number;
  startY: number;
  box: Box;
  moved: boolean;
}

const CORNERS: { c: 0 | 1 | 2 | 3; cursor: string }[] = [
  { c: 0, cursor: 'nwse-resize' },
  { c: 1, cursor: 'nesw-resize' },
  { c: 2, cursor: 'nwse-resize' },
  { c: 3, cursor: 'nesw-resize' },
];

export function PlacementLayer({
  index,
  size,
  scale,
  sigs,
  onPlace,
  onMore,
}: {
  index: number;
  size: PageSize;
  scale: number;
  sigs: ReadonlyMap<string, SignatureRecord>;
  onPlace: (page: number, fx: number, fy: number) => void;
  onMore: () => void;
}) {
  const items = usePlacements((s) => s.items);
  const selected = usePlacements((s) => s.selected);
  const tool = usePlacements((s) => s.tool);
  const lockAspect = usePlacements((s) => s.lockAspect);
  const showToast = useApp((s) => s.showToast);
  const [guides, setGuides] = useState<Guides>({ v: [], h: [] });
  const [opacityOpen, setOpacityOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const layer = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | undefined>(undefined);
  const w = size.width * scale;
  const h = size.height * scale;
  const page = items.filter((p) => p.page === index).sort((a, b) => a.z - b.z);
  const sel = page.find((p) => p.id === selected);

  const start = (e: RPointerEvent, p: Placed, kind: Gesture['kind'], corner?: 0 | 1 | 2 | 3) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    placements.select(p.id);
    setOpacityOpen(false);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    placements.beginGesture();
    gesture.current = { kind, corner, startX: e.clientX, startY: e.clientY, box: p, moved: false };
    setDragging(true);
  };

  const move = (e: RPointerEvent, p: Placed) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < 2) return;
    g.moved = true;
    if (g.kind === 'move') {
      let box = clampBox({ ...g.box, x: g.box.x + dx / w, y: g.box.y + dy / h });
      if (!e.altKey) {
        const others = page.filter((o) => o.id !== p.id);
        const s = snapBox(box, others, size, SNAP_PX / w, SNAP_PX / h);
        setGuides(s.guides);
        box = { x: s.x, y: s.y, w: s.w, h: s.h };
      } else setGuides({ v: [], h: [] });
      placements.live(p.id, { x: box.x, y: box.y });
    } else if (g.kind === 'resize' && g.corner !== undefined) {
      // Un-rotate the pointer delta into the box frame.
      const a = (-p.rotation * Math.PI) / 180;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      const lock = p.type === 'checkbox' || lockAspect !== e.shiftKey;
      const box = resizeBox(g.box, g.corner, lx / scale, ly / scale, size, lock);
      placements.live(p.id, box);
    } else if (g.kind === 'rotate') {
      const r = layer.current?.getBoundingClientRect();
      if (!r) return;
      const cx = r.left + (p.x + p.w / 2) * w;
      const cy = r.top + (p.y + p.h / 2) * h;
      placements.live(p.id, { rotation: rotationTo(cx, cy, e.clientX, e.clientY, !e.altKey) });
    }
  };

  const end = () => {
    const g = gesture.current;
    gesture.current = undefined;
    setDragging(false);
    setGuides({ v: [], h: [] });
    if (placements.endGesture() && g?.kind === 'move') placements.announce(t('editor.moved'));
  };

  const remove = (p: Placed) => {
    placements.remove(p.id);
    placements.announce(t('editor.deleted'));
    showToast({
      text: t('editor.deleted'),
      action: {
        label: t('editor.undo'),
        run: () => {
          placements.undo();
        },
      },
    });
  };

  const onKey = (e: React.KeyboardEvent, p: Placed) => {
    const mod = e.ctrlKey || e.metaKey;
    const step = e.shiftKey ? 10 : 1;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = arrows[e.key];
    if (d && !mod) {
      e.preventDefault();
      const b = nudge(p, d[0], d[1], size, scale);
      placements.update(p.id, { x: b.x, y: b.y });
      placements.announce(t('editor.moved'));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(p);
    } else if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      placements.duplicate(p.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      placements.select(undefined);
      (e.currentTarget as HTMLElement).blur();
    } else if ((e.key === ' ' || e.key === 'Enter') && p.type === 'checkbox') {
      e.preventDefault();
      placements.update(p.id, { data: { ...p.data, checked: !p.data.checked } });
    }
  };

  // Floating toolbar sits above the selection (below it near the page top), unrotated.
  const bar = sel
    ? (() => {
        const top = sel.y * h;
        const above = top > 64;
        return {
          left: (sel.x + sel.w / 2) * w,
          top: above ? top - 56 : (sel.y + sel.h) * h + 24,
        };
      })()
    : undefined;

  return (
    <div
      ref={layer}
      data-placement-layer={index}
      data-qa-backdrop="#FFFFFF"
      className={`absolute left-px top-px ${tool ? 'cursor-crosshair' : ''}`}
      style={{ width: w, height: h }}
      onClick={(e) => {
        if (tool) {
          const r = e.currentTarget.getBoundingClientRect();
          onPlace(index, (e.clientX - r.left) / w, (e.clientY - r.top) / h);
        } else if (selected && e.target === e.currentTarget) placements.select(undefined);
      }}
    >
      {page.map((p) => {
        const isSel = p.id === selected;
        const pct = sizePercent(p);
        const field = t(FIELD_LABEL[p.type]);
        return (
          <div
            key={p.id}
            role="group"
            tabIndex={0}
            aria-roledescription={t('editor.roleDescription', { field: field.toLowerCase() })}
            aria-label={t('editor.placementName', {
              field,
              page: String(index + 1),
              w: String(pct.w),
              h: String(pct.h),
            })}
            data-placement={p.id}
            data-placement-type={p.type}
            className="absolute touch-none select-none outline-none"
            style={{
              left: p.x * w,
              top: p.y * h,
              width: p.w * w,
              height: p.h * h,
              transform: p.rotation ? `rotate(${String(p.rotation)}deg)` : undefined,
              zIndex: isSel ? 2 : 1,
              cursor: tool ? 'crosshair' : 'move',
            }}
            onFocus={() => {
              if (!isSel) placements.select(p.id);
            }}
            onKeyDown={(e) => {
              onKey(e, p);
            }}
            onPointerDown={(e) => {
              if (tool) return;
              start(e, p, 'move');
            }}
            onPointerMove={(e) => {
              move(e, p);
            }}
            onPointerUp={end}
            onPointerCancel={end}
            onDoubleClick={() => {
              if (p.type === 'checkbox')
                placements.update(p.id, { data: { ...p.data, checked: !p.data.checked } });
              else onMore();
            }}
          >
            <div className="h-full w-full" style={{ opacity: p.opacity }}>
              <PlacedContent
                p={p}
                hPx={p.h * h}
                sig={p.signatureId ? sigs.get(p.signatureId) : undefined}
              />
            </div>
            {isSel ? (
              <div
                className="ds-selection pointer-events-none absolute inset-0"
                data-ui-state="selection"
                style={{
                  outline: 'var(--size-selection-width) solid var(--selection)',
                  boxShadow:
                    '0 0 0 calc(var(--size-selection-width) + var(--size-selection-halo-width)) var(--selection-halo)',
                }}
              >
                {CORNERS.map(({ c, cursor }) => (
                  <span
                    key={c}
                    aria-hidden
                    className="pointer-events-auto absolute flex min-h-target min-w-target -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                    style={{ cursor, ...cornerOffset(c) }}
                    onPointerDown={(e) => {
                      start(e, p, 'resize', c);
                    }}
                    onPointerMove={(e) => {
                      move(e, p);
                    }}
                    onPointerUp={end}
                    onPointerCancel={end}
                  >
                    <span
                      className="ds-selection-handle block rounded-full bg-pdf-page"
                      data-ui-state="handle"
                      style={{
                        width: 'var(--size-handle)',
                        height: 'var(--size-handle)',
                        border: 'var(--size-handle-stroke) solid var(--pdf-ink)',
                      }}
                    />
                  </span>
                ))}
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-1/2 w-px -translate-x-1/2 bg-pdf-ink"
                  style={{ top: -16, height: 16 }}
                />
                <span
                  aria-label={t('editor.rotate')}
                  className="pointer-events-auto absolute left-1/2 flex min-h-target min-w-target -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center"
                  style={{ top: -16 }}
                  onPointerDown={(e) => {
                    start(e, p, 'rotate');
                  }}
                  onPointerMove={(e) => {
                    move(e, p);
                  }}
                  onPointerUp={end}
                  onPointerCancel={end}
                >
                  <span
                    className="ds-selection-handle block rounded-full bg-pdf-page"
                    data-ui-state="handle"
                    style={{
                      width: 'var(--size-handle)',
                      height: 'var(--size-handle)',
                      border: 'var(--size-handle-stroke) solid var(--pdf-ink)',
                    }}
                  />
                </span>
              </div>
            ) : null}
          </div>
        );
      })}
      {guides.v.map((x) => (
        <span
          key={`v${String(x)}`}
          aria-hidden
          data-snap-guide="v"
          className="pointer-events-none absolute top-0 h-full"
          style={{
            left: x * w,
            width: 1,
            background: 'var(--selection)',
            boxShadow: '0 0 0 1px var(--selection-halo)',
            zIndex: 3,
          }}
        />
      ))}
      {guides.h.map((y) => (
        <span
          key={`h${String(y)}`}
          aria-hidden
          data-snap-guide="h"
          className="pointer-events-none absolute left-0 w-full"
          style={{
            top: y * h,
            height: 1,
            background: 'var(--selection)',
            boxShadow: '0 0 0 1px var(--selection-halo)',
            zIndex: 3,
          }}
        />
      ))}
      {sel && bar && !dragging ? (
        <div
          role="toolbar"
          aria-label={t(FIELD_LABEL[sel.type])}
          className="absolute z-10 flex -translate-x-1/2 items-center gap-1 rounded-pill border border-border bg-surface p-1 text-text shadow-float"
          style={{ left: bar.left, top: bar.top }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
        >
          <FloatButton
            label={t('editor.duplicate')}
            onClick={() => {
              placements.duplicate(sel.id);
            }}
          >
            <Copy aria-hidden size={18} strokeWidth={1.75} />
          </FloatButton>
          <FloatButton
            label={t('editor.opacity')}
            pressed={opacityOpen}
            onClick={() => {
              setOpacityOpen((o) => !o);
            }}
          >
            <Droplet aria-hidden size={18} strokeWidth={1.75} />
          </FloatButton>
          <FloatButton label={t('editor.more')} onClick={onMore}>
            <MoreHorizontal aria-hidden size={18} strokeWidth={1.75} />
          </FloatButton>
          <FloatButton
            label={t('editor.delete')}
            onClick={() => {
              remove(sel);
            }}
          >
            <Trash2 aria-hidden size={18} strokeWidth={1.75} />
          </FloatButton>
          {opacityOpen ? (
            <label className="flex items-center gap-2 px-2 text-body-sm">
              <span className="sr-only">{t('editor.opacity')}</span>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={Math.round(sel.opacity * 100)}
                aria-valuetext={`${String(Math.round(sel.opacity * 100))}%`}
                data-ui-state="input"
                className="w-28 accent-[var(--primary)]"
                onPointerDown={() => {
                  placements.beginGesture();
                }}
                onPointerUp={() => {
                  placements.endGesture();
                }}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  if (gestureActive()) placements.live(sel.id, { opacity: v });
                  else placements.update(sel.id, { opacity: v });
                }}
              />
              <span className="w-10 tabular-nums">{Math.round(sel.opacity * 100)}%</span>
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function gestureActive(): boolean {
  return placements.inGesture();
}

function cornerOffset(c: 0 | 1 | 2 | 3): React.CSSProperties {
  return {
    left: c === 0 || c === 3 ? 0 : '100%',
    top: c === 0 || c === 1 ? 0 : '100%',
  };
}

function FloatButton({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="inline-flex min-h-target min-w-target items-center justify-center rounded-pill text-text hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring"
    >
      {children}
    </button>
  );
}
