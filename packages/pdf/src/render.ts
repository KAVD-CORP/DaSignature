/**
 * pdf.js wrapper (SPEC Sec 4/5: parsing in a Web Worker). Lazy: only the viewer chunk imports this.
 * Hardening (SEC-02): no eval, no PDF JavaScript, no XFA, no remote fetches (the bundled cmaps,
 * standard fonts and wasm decoders are same-origin under /pdfjs/).
 */
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { IMPORT_ERROR_COPY, PdfImportError, validatePdfBytes } from './validate.ts';

export type { PDFDocumentProxy, PDFPageProxy };

let worker: Worker | undefined;
function pdfWorker(): Worker {
  worker ??= new Worker(workerUrl, { type: 'module', name: 'dasig-pdf' });
  return worker;
}

/** Base URL of the bundled pdf.js data (copied by scripts/copy-pdfjs-assets.mjs). */
export const PDFJS_ASSET_BASE = '/pdfjs/';

/** The getDocument options DaSignature always uses (exported so SEC-02 tests can assert them). */
export function documentOptions(data: Uint8Array, password?: string) {
  return {
    data,
    password,
    isEvalSupported: false,
    enableScripting: false,
    enableXfa: false,
    isOffscreenCanvasSupported: true,
    useSystemFonts: false,
    disableFontFace: false,
    stopAtErrors: false,
    cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
    wasmUrl: `${PDFJS_ASSET_BASE}wasm/`,
    iccUrl: `${PDFJS_ASSET_BASE}iccs/`,
  } as const;
}

/** Asked when the PDF is encrypted. Resolve with the password, or null to cancel. */
export type PasswordPrompt = (retry: boolean) => Promise<string | null>;

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** True when the file had any encryption (user or owner password): PM #45 export notice. */
  encrypted: boolean;
  /** The password that worked, kept in memory for this session only. */
  password: string | undefined;
}

export interface OpenHandle {
  promise: Promise<OpenedPdf>;
  cancel: () => void;
  onProgress: (cb: (loaded: number, total: number) => void) => void;
}

/**
 * Opens a PDF. `bytes` is copied because pdf.js transfers (detaches) its input to the worker.
 * Throws PdfImportError('damaged' | 'not-pdf' | 'too-large' | 'password-cancelled').
 */
export function openPdf(
  bytes: Uint8Array,
  opts: { password?: string; askPassword?: PasswordPrompt } = {},
): OpenHandle {
  validatePdfBytes(bytes);
  pdfjs.GlobalWorkerOptions.workerPort ??= pdfWorker();
  const st = { cancelled: false };
  const stopped = () => st.cancelled;
  let used = opts.password;
  const task = pdfjs.getDocument(documentOptions(bytes.slice(), opts.password));
  let progress: ((l: number, t: number) => void) | undefined;
  task.onProgress = (p: { loaded: number; total: number }) => progress?.(p.loaded, p.total);
  task.onPassword = (update: (pw: string) => void, reason: number) => {
    const retry = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
    const ask = opts.askPassword;
    if (!ask) {
      void task.destroy();
      return;
    }
    void ask(retry).then((pw) => {
      if (pw === null) {
        st.cancelled = true;
        void task.destroy();
      } else {
        used = pw;
        update(pw);
      }
    });
  };
  const promise = (async () => {
    try {
      const doc = await task.promise;
      const encrypted = await isEncrypted(doc);
      return { doc, encrypted, password: used };
    } catch (err) {
      if (stopped()) throw new PdfImportError('password-cancelled', 'cancelled');
      if (err instanceof Error && err.name === 'PasswordException')
        throw new PdfImportError('password-cancelled', 'cancelled');
      throw new PdfImportError('damaged', IMPORT_ERROR_COPY.damaged);
    }
  })();
  return {
    promise,
    cancel: () => {
      st.cancelled = true;
      void task.destroy();
    },
    onProgress: (cb) => {
      progress = cb;
    },
  };
}

async function isEncrypted(doc: PDFDocumentProxy): Promise<boolean> {
  try {
    const meta = (await doc.getMetadata()) as { info?: { EncryptFilterName?: unknown } };
    if (meta.info?.EncryptFilterName) return true;
    const perms = await doc.getPermissions();
    return perms !== null;
  } catch {
    return false;
  }
}

/** Page size in PDF points with /Rotate applied (what the user sees). */
export function pageSize(page: PDFPageProxy): { width: number; height: number } {
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}

/** Largest canvas we render (pixels), so 800% zoom on a big page can't exhaust memory (PERF-04). */
export const MAX_CANVAS_PIXELS = 16_777_216;

/**
 * Renders `page` into `canvas` at `cssScale` (CSS px per PDF pt) times the device pixel ratio,
 * capped at MAX_CANVAS_PIXELS. Never applies any colour filter: dark mode does not touch the page.
 */
export function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  cssScale: number,
  dpr = globalThis.devicePixelRatio || 1,
): RenderTask {
  const base = page.getViewport({ scale: 1 });
  let scale = cssScale * dpr;
  const px = base.width * base.height * scale * scale;
  if (px > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / px);
  const vp = page.getViewport({ scale });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('no 2d context');
  return page.render({
    canvasContext: ctx,
    canvas,
    viewport: vp,
    annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
  });
}

export { pdfjs };
