/**
 * Editor screen (design 03-editor). M3: the viewer: top bar (back, title, zoom, fit width, page
 * jump), thumbnails (desktop pane, tablet drawer, phone sheet with peek pill), continuous pages.
 */
import { ArrowLeft, Maximize2, Minus, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@dasignature/i18n';
import { openPdf, pageSize, type PDFDocumentProxy } from '@dasignature/pdf/render';
import type { DocumentRecord } from '@dasignature/storage';
import { Button, IconButton, Spinner } from '../components/ui.tsx';
import {
  PAD,
  PX_PER_PT,
  PdfViewer,
  clampScale,
  type PageSize,
  type ViewerHandle,
} from '../components/PdfViewer.tsx';
import { Thumbnails, releaseThumbnails } from '../components/Thumbnails.tsx';
import { session } from '../services/session.ts';
import { askPassword, useApp } from '../state/app.ts';
import { navigate } from '../state/route.ts';

export interface LoadedDoc {
  rec: DocumentRecord;
  pdf: PDFDocumentProxy;
  bytes: Uint8Array;
  encrypted: boolean;
  sizes: PageSize[];
}

/** Loads the stored original, opens it (asking for the password if needed) and reads page sizes. */
export function useLoadedDoc(docId: string) {
  const services = useApp((s) => s.services);
  const [doc, setDoc] = useState<LoadedDoc | undefined>();
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    if (!services) return;
    const st = { alive: true };
    const alive = () => st.alive;
    let pdf: PDFDocumentProxy | undefined;
    void (async () => {
      try {
        const rec = await services.store.getDocument(docId);
        if (!rec) {
          navigate({ name: 'library' });
          return;
        }
        const bytes = await services.store.getDocumentPdf(rec);
        const handle = openPdf(bytes, { password: session.password(docId), askPassword });
        const opened = await handle.promise;
        pdf = opened.doc;
        if (!alive()) return;
        session.rememberPassword(docId, opened.password);
        const first = pageSize(await pdf.getPage(1));
        const sizes = Array.from({ length: pdf.numPages }, () => first);
        setDoc({ rec, pdf, bytes, encrypted: opened.encrypted, sizes });
        // Real sizes in the background (mixed page sizes are common).
        const real: PageSize[] = [first];
        for (let i = 2; i <= pdf.numPages && alive(); i++)
          real.push(pageSize(await pdf.getPage(i)));
        if (alive() && real.some((s) => s.width !== first.width || s.height !== first.height))
          setDoc((d) => (d ? { ...d, sizes: real } : d));
      } catch (err) {
        if (!alive()) return;
        if (
          err instanceof Error &&
          err.name === 'PdfImportError' &&
          (err as { code?: string }).code === 'password-cancelled'
        ) {
          navigate({ name: 'library' });
          return;
        }
        setError(t('viewer.loadError'));
      }
    })();
    return () => {
      st.alive = false;
      if (pdf) {
        releaseThumbnails(pdf);
        void pdf.destroy();
      }
    };
  }, [services, docId]);
  return { doc, error, setDoc };
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

export function nextZoom(scale: number, dir: 1 | -1): number {
  const pct = scale / PX_PER_PT;
  const steps = dir > 0 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse();
  const next = steps.find((z) => (dir > 0 ? z > pct + 0.001 : z < pct - 0.001));
  return clampScale((next ?? pct) * PX_PER_PT);
}

export function TopBar({
  title,
  scale,
  setScale,
  fit,
  children,
}: {
  title: string;
  scale: number;
  setScale: (s: number) => void;
  fit: () => void;
  children?: React.ReactNode;
}) {
  const pct = Math.round((scale / PX_PER_PT) * 100);
  return (
    <header className="flex min-h-touch items-center gap-1 border-b border-border bg-bg px-2 tablet:px-3">
      <a
        href="#/"
        aria-label={t('viewer.back')}
        title={t('viewer.back')}
        className="inline-flex min-h-target min-w-target items-center justify-center rounded-input text-text hover:bg-surface-2"
      >
        <ArrowLeft aria-hidden size={20} strokeWidth={1.75} />
      </a>
      <h1 className="min-w-0 flex-1 truncate px-1 text-body font-semibold">{title}</h1>
      <div className="flex items-center">
        <IconButton
          label={t('viewer.zoomOut')}
          onClick={() => {
            setScale(nextZoom(scale, -1));
          }}
        >
          <Minus aria-hidden size={20} strokeWidth={1.75} />
        </IconButton>
        <button
          type="button"
          aria-label={t('viewer.zoomLevel', { percent: String(pct) })}
          onClick={() => {
            setScale(PX_PER_PT);
          }}
          className="hidden min-h-target min-w-[3.5rem] rounded-input px-1 text-body-sm tabular-nums text-text hover:bg-surface-2 tablet:inline-block"
        >
          {pct}%
        </button>
        <IconButton
          label={t('viewer.zoomIn')}
          onClick={() => {
            setScale(nextZoom(scale, 1));
          }}
        >
          <Plus aria-hidden size={20} strokeWidth={1.75} />
        </IconButton>
        <IconButton label={t('viewer.fitWidth')} onClick={fit}>
          <Maximize2 aria-hidden size={20} strokeWidth={1.75} />
        </IconButton>
      </div>
      {children}
    </header>
  );
}

export function PageJump({
  current,
  count,
  onJump,
}: {
  current: number;
  count: number;
  onJump: (i: number) => void;
}) {
  const [editing, setEditing] = useState<string | undefined>();
  const value = editing ?? String(current + 1);
  return (
    <form
      className="flex items-center gap-1 text-body-sm text-text"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Math.round(Number(value));
        if (Number.isFinite(n)) onJump(Math.min(count, Math.max(1, n)) - 1);
        setEditing(undefined);
      }}
    >
      <input
        aria-label={t('viewer.goToPage')}
        inputMode="numeric"
        data-ui-state="input"
        value={value}
        onChange={(e) => {
          setEditing(e.target.value);
        }}
        onBlur={() => {
          setEditing(undefined);
        }}
        className="min-h-target w-12 rounded-input border border-border-strong bg-surface px-1 text-center tabular-nums"
      />
      <span className="tabular-nums">/ {count}</span>
    </form>
  );
}

/** Shared viewer state + chrome for the Editor. */
export function useViewer(doc: LoadedDoc | undefined) {
  const viewer = useRef<ViewerHandle>(null);
  const [scale, setScaleRaw] = useState(PX_PER_PT);
  const [current, setCurrent] = useState(0);
  const fitted = useRef(false);
  const setScale = useCallback((s: number) => {
    setScaleRaw(clampScale(s));
  }, []);
  const fit = useCallback(() => {
    const el = viewer.current?.element();
    if (!el || !doc) return;
    const maxW = Math.max(...doc.sizes.map((s) => s.width));
    setScale((el.clientWidth - PAD * 2 - 2) / maxW);
  }, [doc, setScale]);
  useEffect(() => {
    if (doc && !fitted.current) {
      fitted.current = true;
      requestAnimationFrame(fit);
    }
  }, [doc, fit]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setScaleRaw((s) => nextZoom(s, 1));
      } else if (e.key === '-') {
        e.preventDefault();
        setScaleRaw((s) => nextZoom(s, -1));
      } else if (e.key === '0') {
        e.preventDefault();
        fit();
      }
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  }, [fit]);
  const jump = useCallback((i: number) => {
    viewer.current?.scrollToPage(i);
  }, []);
  return { viewer, scale, setScale, current, setCurrent, fit, jump };
}

export function ThumbPane({
  doc,
  current,
  jump,
  open,
  setOpen,
}: {
  doc: LoadedDoc;
  current: number;
  jump: (i: number) => void;
  open: boolean;
  setOpen: (o: boolean) => void;
}) {
  return (
    <>
      {/* Desktop: collapsible left pane. Tablet/phone: drawer over the canvas. */}
      {open ? (
        <aside
          aria-label={t('viewer.pages')}
          className="absolute inset-y-0 left-0 z-20 w-[200px] overflow-y-auto border-r border-border bg-surface desktop:static desktop:z-auto"
        >
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="text-caption font-semibold uppercase tracking-[0.04em] text-text-muted">
              {t('viewer.pages')}
            </span>
            <IconButton
              label={t('viewer.collapsePages')}
              onClick={() => {
                setOpen(false);
              }}
            >
              <PanelLeftClose aria-hidden size={20} strokeWidth={1.75} />
            </IconButton>
          </div>
          <Thumbnails
            pdf={doc.pdf}
            sizes={doc.sizes}
            current={current}
            onSelect={(i) => {
              jump(i);
              if (innerWidth < 1025) setOpen(false);
            }}
          />
        </aside>
      ) : null}
    </>
  );
}

export function PagesToggle({ open, setOpen }: { open: boolean; setOpen: (o: boolean) => void }) {
  return open ? null : (
    <IconButton
      label={t('viewer.expandPages')}
      onClick={() => {
        setOpen(true);
      }}
      className="hidden tablet:inline-flex"
    >
      <PanelLeftOpen aria-hidden size={20} strokeWidth={1.75} />
    </IconButton>
  );
}

export function PeekPill({
  current,
  count,
  onClick,
}: {
  current: number;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('viewer.expandPages')}
      className="absolute bottom-4 left-1/2 z-10 min-h-target -translate-x-1/2 rounded-pill border border-border bg-surface px-4 text-body-sm font-medium text-text shadow-float tablet:hidden"
    >
      {t('viewer.pageShort', { page: String(current + 1), count: String(count) })}
    </button>
  );
}

export default function Editor({ docId }: { docId: string }) {
  const { doc, error } = useLoadedDoc(docId);
  const { viewer, scale, setScale, current, setCurrent, fit, jump } = useViewer(doc);
  const [thumbs, setThumbs] = useState(() => innerWidth >= 1025);

  if (error)
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <h1 className="text-title font-semibold">{error}</h1>
        <Button
          variant="primary"
          onClick={() => {
            navigate({ name: 'library' });
          }}
        >
          {t('viewer.back')}
        </Button>
      </main>
    );
  if (!doc)
    return (
      <main className="flex min-h-dvh items-center justify-center bg-canvas">
        <Spinner label={t('app.loading')} />
      </main>
    );

  return (
    <main className="flex h-dvh flex-col bg-bg">
      <TopBar title={doc.rec.title} scale={scale} setScale={setScale} fit={fit}>
        <PagesToggle open={thumbs} setOpen={setThumbs} />
        <div className="hidden tablet:block">
          <PageJump current={current} count={doc.sizes.length} onJump={jump} />
        </div>
      </TopBar>
      <div className="relative flex min-h-0 flex-1">
        <ThumbPane doc={doc} current={current} jump={jump} open={thumbs} setOpen={setThumbs} />
        <div className="relative min-w-0 flex-1">
          <PdfViewer
            ref={viewer}
            pdf={doc.pdf}
            sizes={doc.sizes}
            scale={scale}
            onScale={setScale}
            onCurrent={setCurrent}
          />
          {!thumbs ? (
            <PeekPill
              current={current}
              count={doc.sizes.length}
              onClick={() => {
                setThumbs(true);
              }}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
