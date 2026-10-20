/** Builds export items from placements and runs the export worker (SPEC Sec 7.5). */
import { APP_VERSION, parseStoredSvg, producerString } from '@dasignature/core';
import type { ExportItem, ExportShape } from '@dasignature/pdf/export';
import type { DataStore, SignatureRecord } from '@dasignature/storage';
import { fieldText } from '../components/PlacementLayer.tsx';
import type { Placed } from '../state/placements.ts';
import type { WorkerMessage, WorkerRequest } from './export.worker.ts';
import { textFontBytes } from '../fonts.ts';

export const PDF_INK = '#141A3C';
const CHECK_BOX = 'M1,1L19,1L19,19L1,19Z';
const CHECK_MARK = 'M4.5,10.5L8.3,14.2L15.5,5.8';

export async function buildItems(
  items: readonly Placed[],
  sigs: ReadonlyMap<string, SignatureRecord>,
  store: DataStore,
  locale?: string,
): Promise<ExportItem[]> {
  const out: ExportItem[] = [];
  for (const p of [...items].sort((a, b) => a.page - b.page || a.z - b.z)) {
    const shapes: ExportShape[] = [];
    if (p.type === 'signature' || p.type === 'initials') {
      const v = p.data.svg ? parseStoredSvg(p.data.svg) : null;
      if (v)
        shapes.push({
          kind: 'path',
          d: v.d,
          vbW: v.width,
          vbH: v.height,
          color: p.data.color ?? PDF_INK,
          opacity: p.opacity * (p.data.sigOpacity ?? 1),
        });
      else {
        const sig = p.signatureId ? sigs.get(p.signatureId) : undefined;
        const png = sig ? await store.getSignatureImage(sig) : undefined;
        if (png) shapes.push({ kind: 'image', png, opacity: p.opacity * (sig?.opacity ?? 1) });
      }
    } else if (p.type === 'checkbox') {
      shapes.push({
        kind: 'path',
        d: CHECK_BOX,
        vbW: 20,
        vbH: 20,
        color: PDF_INK,
        opacity: p.opacity,
        stroke: 1.5,
      });
      if (p.data.checked)
        shapes.push({
          kind: 'path',
          d: CHECK_MARK,
          vbW: 20,
          vbH: 20,
          color: PDF_INK,
          opacity: p.opacity,
          stroke: 2.2,
        });
    } else {
      const text = fieldText(p, locale);
      if (text) shapes.push({ kind: 'text', text, color: PDF_INK, opacity: p.opacity });
    }
    if (shapes.length)
      out.push({ page: p.page, x: p.x, y: p.y, w: p.w, h: p.h, rotation: p.rotation, shapes });
  }
  return out;
}

export interface ExportJob {
  promise: Promise<{ bytes: Uint8Array; sha256: string }>;
  cancel: () => void;
}

export class ExportFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExportFailure';
  }
}

export function runExport(
  req: Omit<WorkerRequest, 'fonts' | 'producer'>,
  onProgress: (stage: 'signatures' | 'flatten' | 'write') => void,
): ExportJob {
  const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
  let reject: ((e: Error) => void) | undefined;
  const promise = (async () => {
    const fonts = await textFontBytes();
    return new Promise<{ bytes: Uint8Array; sha256: string }>((resolve, rej) => {
      reject = rej;
      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const m = e.data;
        if (m.type === 'progress') onProgress(m.stage);
        else if (m.type === 'done') {
          worker.terminate();
          resolve({ bytes: m.bytes, sha256: m.sha256 });
        } else {
          worker.terminate();
          rej(new ExportFailure(m.code, m.message));
        }
      };
      worker.onerror = (e) => {
        worker.terminate();
        rej(new ExportFailure('unknown', e.message));
      };
      const msg: WorkerRequest = { ...req, fonts, producer: producerString(APP_VERSION) };
      worker.postMessage(msg);
    });
  })();
  return {
    promise,
    cancel: () => {
      worker.terminate();
      reject?.(new ExportFailure('cancelled', 'cancelled'));
    },
  };
}
