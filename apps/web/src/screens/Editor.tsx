/**
 * Editor screen (design 03-editor): the viewer (top bar, thumbnails, continuous pages) plus the
 * M5 placement editor (side panel / phone dock, per-page placement layers, undo/redo, autosave).
 */
import { ArrowLeft, Maximize2, Minus, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  boxAt,
  defaultSizePt,
  formatDate,
  parseStoredSvg,
  todayIso,
  type FieldType,
} from '@dasignature/core';
import { t } from '@dasignature/i18n';
import { openPdf, pageSize, type PDFDocumentProxy, type Protection } from '@dasignature/pdf/render';
import type { DocumentRecord, SignatureRecord } from '@dasignature/storage';
import { Button, IconButton, Modal, Spinner } from '../components/ui.tsx';
import {
  LiveRegion,
  PhoneDock,
  Properties,
  SavedCaption,
  SidePanel,
  ToolHint,
  UndoRedo,
} from '../components/EditorPanels.tsx';
import { FIELD_LABEL, PlacementLayer, textWidthPt } from '../components/PlacementLayer.tsx';
import { signatureImageUrl } from '../components/SignaturePreview.tsx';
import { placements, usePlacements } from '../state/placements.ts';
import { useSignatures } from './Signatures.tsx';
import { ExportSheet } from '../components/ExportSheet.tsx';
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

const Studio = lazy(() => import('./Studio.tsx'));

export interface LoadedDoc {
  rec: DocumentRecord;
  pdf: PDFDocumentProxy;
  bytes: Uint8Array;
  encrypted: boolean;
  password: string | undefined;
  protection: Protection;
  hasForm: boolean;
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
        const fields = await pdf.getFieldObjects().catch(() => null);
        if (!alive()) return;
        setDoc({
          rec,
          pdf,
          bytes,
          encrypted: opened.encrypted,
          password: opened.password,
          protection: opened.protection,
          hasForm: !!fields && Object.keys(fields).length > 0,
          sizes,
        });
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
      className="absolute bottom-4 left-4 z-10 min-h-target rounded-pill border border-border bg-surface px-4 text-body-sm font-medium text-text shadow-float tablet:hidden"
    >
      {t('viewer.pageShort', { page: String(current + 1), count: String(count) })}
    </button>
  );
}

async function aspectOf(sig: SignatureRecord): Promise<number> {
  const v = sig.svg_path ? parseStoredSvg(sig.svg_path) : null;
  if (v) return v.width / Math.max(1, v.height);
  const url = await signatureImageUrl(sig);
  if (!url) return 3;
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => undefined);
  return img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 3;
}

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable)
  );
};

/** Placement editing: load/flush, place-by-tool, shortcuts. */
function usePlacementEditor(doc: LoadedDoc | undefined, current: number) {
  const services = useApp((s) => s.services);
  const { list: sigs, refresh } = useSignatures();
  const sigMap = useMemo(() => new Map((sigs ?? []).map((s) => [s.id, s])), [sigs]);
  const [studio, setStudio] = useState<'signature' | 'initials' | undefined>();
  const [askName, setAskName] = useState<{ page: number; fx: number; fy: number } | undefined>();
  const [more, setMore] = useState(false);
  const docId = doc?.rec.id;

  useEffect(() => {
    if (!services || !docId) return;
    void placements.load(docId, services.store);
    return () => {
      placements.reset();
    };
  }, [services, docId]);

  const place = useCallback(
    async (page: number, fx: number, fy: number, nameOverride?: string) => {
      const st = usePlacements.getState();
      const tool = st.tool;
      const size = doc?.sizes[page];
      if (!tool || !size || !services) return;
      const base = { page, rotation: 0, opacity: 1, signatureId: null };
      const announce = () => {
        placements.announce(
          t('editor.placedOn', { field: t(FIELD_LABEL[tool]), page: String(page + 1) }),
        );
      };
      if (tool === 'signature' || tool === 'initials') {
        const sig =
          (st.toolSignature ? sigMap.get(st.toolSignature) : undefined) ??
          sigs?.find((s) => s.kind === tool && s.is_default) ??
          sigs?.find((s) => s.kind === tool);
        if (!sig) {
          setStudio(tool);
          return;
        }
        const box = boxAt(fx, fy, defaultSizePt(tool, await aspectOf(sig)), size);
        placements.add({
          ...base,
          ...box,
          type: tool,
          signatureId: sig.id,
          data: sig.svg_path
            ? { svg: sig.svg_path, color: sig.color ?? '#1B1F2A', sigOpacity: sig.opacity ?? 1 }
            : {},
        });
        announce();
        return;
      }
      let text: string | undefined;
      let format: string | undefined;
      if (tool === 'date') {
        text = todayIso();
        format = (await services.store.getSetting('date_format')) ?? 'locale-medium';
      } else if (tool === 'name') {
        text = nameOverride ?? (await services.store.getSetting('signer_name')) ?? '';
        if (!text.trim()) {
          setAskName({ page, fx, fy });
          return;
        }
      } else if (tool === 'text') text = '';
      const pt = defaultSizePt(tool);
      if (text !== undefined && tool !== 'text') {
        const shown = tool === 'date' ? formatDate(text, format ?? '') : text;
        pt.w = Math.max(24, textWidthPt(shown, pt.h));
      }
      const box = boxAt(fx, fy, pt, size);
      placements.add({
        ...base,
        ...box,
        type: tool,
        data: tool === 'checkbox' ? { checked: true } : { text, ...(format ? { format } : {}) },
      });
      announce();
      if (tool === 'text') {
        if (innerWidth < 600) setMore(true);
        requestAnimationFrame(() => {
          document.querySelector<HTMLInputElement>('[data-autofocus-text]')?.focus();
        });
      }
    },
    [doc, services, sigs, sigMap],
  );

  const pick = useCallback(
    (tool: FieldType, signatureId?: string, keyboard?: boolean) => {
      const st = usePlacements.getState();
      if (st.tool === tool && st.toolSignature === signatureId && !keyboard) {
        placements.setTool(undefined);
        return;
      }
      if ((tool === 'signature' || tool === 'initials') && !sigs?.some((s) => s.kind === tool)) {
        setStudio(tool); // none saved: the Studio opens first (design 03)
        return;
      }
      placements.setTool(tool, signatureId);
      // Non-pointer path: keyboard activation places it in the middle of the current page.
      if (keyboard)
        void place(current, 0.5, 0.5).then(() => {
          const id = usePlacements.getState().selected;
          if (id && tool !== 'text')
            document.querySelector<HTMLElement>(`[data-placement="${id}"]`)?.focus();
        });
    },
    [sigs, place, current],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (isTyping(e)) return;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) placements.redo();
        else placements.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        placements.redo();
      } else if (mod && k === 's') {
        e.preventDefault();
        void placements.flush();
      } else if (e.key === 'Escape' && usePlacements.getState().tool) {
        placements.setTool(undefined);
      } else if (
        e.key === 'Enter' &&
        usePlacements.getState().tool &&
        !(e.target as HTMLElement | null)?.closest('button, [role=group]')
      ) {
        e.preventDefault();
        void place(current, 0.5, 0.5);
      }
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  }, [place, current]);

  return {
    sigs,
    sigMap,
    refresh,
    place,
    pick,
    studio,
    setStudio,
    askName,
    setAskName,
    more,
    setMore,
  };
}

function SignerNameDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <Modal open={open} onClose={onClose} title={t('editor.signerPrompt')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim());
        }}
      >
        <input
          aria-label={t('editor.signerPrompt')}
          data-ui-state="input"
          autoComplete="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          className="min-h-target rounded-input border border-border-strong bg-surface px-2 text-body text-text"
        />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('editor.cancelTool')}</Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            {t('editor.signerSave')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Editor({ docId }: { docId: string }) {
  const { doc, error } = useLoadedDoc(docId);
  const { viewer, scale, setScale, current, setCurrent, fit, jump } = useViewer(doc);
  const [thumbs, setThumbs] = useState(() => innerWidth >= 1025);
  const services = useApp((s) => s.services);
  const ed = usePlacementEditor(doc, current);
  const { sigMap, place, setMore } = ed;
  const [exporting, setExporting] = useState(false);
  const items = usePlacements((s) => s.items);
  const openExport = useCallback(() => {
    void placements.flush();
    if (usePlacements.getState().items.length === 0) {
      useApp.getState().showToast({ text: t('export.nothingPlaced') });
      return;
    }
    setExporting(true);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        openExport();
      }
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  }, [openExport]);
  const overlay = useCallback(
    (index: number, size: PageSize, sc: number) => (
      <PlacementLayer
        index={index}
        size={size}
        scale={sc}
        sigs={sigMap}
        onPlace={(page, fx, fy) => {
          void place(page, fx, fy);
        }}
        onMore={() => {
          if (innerWidth < 600) setMore(true);
          else document.querySelector<HTMLElement>('[data-autofocus-text]')?.focus();
        }}
      />
    ),
    [sigMap, place, setMore],
  );

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
        <SavedCaption />
        <UndoRedo />
        <PagesToggle open={thumbs} setOpen={setThumbs} />
        <div className="hidden tablet:block">
          <PageJump current={current} count={doc.sizes.length} onJump={jump} />
        </div>
        <Button
          variant="primary"
          className="ml-2 hidden tablet:inline-flex"
          title={t('editor.exportShortcut')}
          onClick={openExport}
        >
          {t('editor.export')}
        </Button>
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
            overlay={overlay}
          />
          <ToolHint
            onCancel={() => {
              placements.setTool(undefined);
            }}
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
        <SidePanel
          sigs={ed.sigs}
          sizes={doc.sizes}
          onPick={ed.pick}
          onNewSignature={() => {
            ed.setStudio('signature');
          }}
        />
      </div>
      <div className="relative tablet:hidden">
        <Button
          variant="primary"
          pill
          className="absolute -top-14 left-1/2 z-10 -translate-x-1/2 shadow-float"
          onClick={openExport}
        >
          {t('editor.export')}
        </Button>
      </div>
      <PhoneDock onPick={ed.pick} />
      {exporting ? (
        <ExportSheet
          open
          onClose={() => {
            setExporting(false);
          }}
          rec={doc.rec}
          original={doc.bytes}
          password={doc.password}
          protection={doc.protection}
          hasForm={doc.hasForm}
          items={items}
          sigs={sigMap}
        />
      ) : null}
      <LiveRegion />
      <Modal
        open={ed.more}
        onClose={() => {
          setMore(false);
        }}
        title={t('editor.properties')}
      >
        <Properties sizes={doc.sizes} />
      </Modal>
      <SignerNameDialog
        open={ed.askName !== undefined}
        onClose={() => {
          ed.setAskName(undefined);
        }}
        onSave={(name) => {
          const at = ed.askName;
          ed.setAskName(undefined);
          void services?.store.setSetting('signer_name', name);
          if (at) void place(at.page, at.fx, at.fy, name);
        }}
      />
      {ed.studio ? (
        <Suspense fallback={null}>
          <Studio
            open
            initialKind={ed.studio}
            onSaved={(rec) => {
              placements.setTool(rec.kind, rec.id);
            }}
            onClose={() => {
              ed.setStudio(undefined);
              void ed.refresh();
            }}
          />
        </Suspense>
      ) : null}
    </main>
  );
}
