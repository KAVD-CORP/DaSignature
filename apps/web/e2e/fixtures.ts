/**
 * Test PDFs generated on the fly (pdf-lib), plus three small encrypted fixtures copied from
 * qa/fixtures/pdf/encrypted (user password "user123").
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';

export const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;
const OUT = join(tmpdir(), 'dasig-e2e-fixtures');
mkdirSync(OUT, { recursive: true });

export async function manyPages(n: number, name = `${String(n)}page.pdf`): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`Page ${String(i)}`, { x: 72, y: 700, size: 48, font, color: rgb(0, 0, 0) });
    p.drawRectangle({ x: 72, y: 100, width: 468, height: 40, color: rgb(0.1, 0.2, 0.6) });
  }
  const path = join(OUT, name);
  writeFileSync(path, await doc.save());
  return path;
}

/** A PDF whose OpenAction runs JavaScript that would change the title if executed (SEC-02). */
export async function jsAction(): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]).drawText('js', { x: 20, y: 250, size: 20 });
  const js = doc.context.obj({
    Type: 'Action',
    S: 'JavaScript',
    JS: PDFString.of('app.alert("pwned"); this.print(); document.title = "pwned";'),
  });
  doc.catalog.set(PDFName.of('OpenAction'), js);
  const path = join(OUT, 'js-action.pdf');
  writeFileSync(path, await doc.save());
  return path;
}

export function malformed(): string {
  const path = join(OUT, 'malformed.pdf');
  writeFileSync(path, '%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 9 0 R >> endobj\ngarbage\n%%EOF');
  return path;
}

export function notPdf(): string {
  const path = join(OUT, 'not-really.pdf');
  writeFileSync(path, 'PK\u0003\u0004 this is a zip pretending to be a pdf');
  return path;
}

/** Sparse 51 MB file: only the size matters, it must be rejected before parsing (SEC-03). */
export function tooLarge(): string {
  const path = join(OUT, '51mb.pdf');
  const buf = Buffer.alloc(51 * 1024 * 1024);
  buf.write('%PDF-1.7\n');
  writeFileSync(path, buf);
  return path;
}

/** ~50 MB PDF: a few pages with large incompressible image streams (PERF-03). */
export async function nearLimit(): Promise<string> {
  const path = join(OUT, '50mb.pdf');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 40; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`Big page ${String(i)}`, { x: 72, y: 700, size: 36, font });
    // Incompressible padding stream (not referenced by the page content), ~1.2 MB per page.
    doc.context.register(doc.context.stream(randomBytes(1_200_000)));
  }
  writeFileSync(path, await doc.save({ useObjectStreams: false }));
  return path;
}
