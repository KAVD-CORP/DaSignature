/**
 * Import pipeline (SPEC Sec 3.1, 9): size check before reading, magic-byte check, then pdf.js
 * opens it in its worker (password prompt if needed) to get the page count, then the original
 * bytes are stored once, encrypted, with their SHA-256 (HASH-01). The original is never modified.
 */
import { t } from '@dasignature/i18n';
import {
  LARGE_PDF_BYTES,
  PdfImportError,
  checkPdfSize,
  titleFromFileName,
  validatePdfBytes,
} from '@dasignature/pdf';
import type { DocumentRecord } from '@dasignature/storage';
import { askPassword, useApp } from '../state/app.ts';
import { session } from './session.ts';

export class ImportCancelled extends Error {}

function isQuota(err: unknown): boolean {
  return (
    err instanceof Error &&
    /quota|QuotaExceeded|no space|disk full/i.test(`${err.name} ${err.message}`)
  );
}

export async function importPdf(file: File): Promise<DocumentRecord | undefined> {
  const app = useApp.getState();
  const services = app.services;
  if (!services) return undefined;
  let cancel: () => void = () => undefined;
  const st = { cancelled: false };
  const stopped = () => st.cancelled;
  app.set({
    opening: {
      name: file.name,
      large: file.size > LARGE_PDF_BYTES,
      cancel: () => {
        st.cancelled = true;
        cancel();
        useApp.getState().set({ opening: undefined });
      },
    },
  });
  try {
    checkPdfSize(file.size);
    const bytes = new Uint8Array(await file.arrayBuffer());
    validatePdfBytes(bytes);
    if (stopped()) throw new ImportCancelled();
    const { openPdf } = await import('@dasignature/pdf/render');
    const handle = openPdf(bytes, { askPassword });
    cancel = handle.cancel;
    const opened = await handle.promise;
    const pageCount = opened.doc.numPages;
    void opened.doc.destroy();
    if (stopped()) throw new ImportCancelled();
    const rec = await services.store.addDocument({
      title: titleFromFileName(file.name),
      pdf: bytes,
      pageCount,
    });
    session.rememberPassword(rec.id, opened.password);
    await useApp.getState().refreshDocs();
    return rec;
  } catch (err) {
    if (err instanceof ImportCancelled) return undefined;
    if (err instanceof PdfImportError) {
      if (err.code !== 'password-cancelled' && !stopped())
        useApp.getState().set({ alert: err.message });
      return undefined;
    }
    useApp
      .getState()
      .set({ alert: isQuota(err) ? t('library.storageFull') : t('viewer.loadError') });
    return undefined;
  } finally {
    useApp.getState().set({ opening: undefined });
  }
}
