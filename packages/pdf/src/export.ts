/**
 * Export pipeline (SPEC Sec 7.5). Lazy: only the export worker imports this.
 * 1 load the original and verify its SHA-256; 2 map page fractions to PDF user space (CropBox and
 * /Rotate aware); 3 draw every placement as vector paths (images as PNG) with group opacity via
 * an ExtGState constant alpha; 4 optionally flatten AcroForm fields; 5 optional audit page;
 * 6 metadata (Producer, signer, time; never location or IP) plus the in-PDF audit trail;
 * 7 save a new file. The original bytes are never modified.
 */
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFInvalidObject,
  PDFName,
  PDFStream,
  PDFString,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFPage,
} from '@cantoo/pdf-lib';
import { textLine } from './glyphs.ts';

export type ExportShape =
  | {
      kind: 'path';
      /** SVG path data in a vbW × vbH frame, y down. */
      d: string;
      vbW: number;
      vbH: number;
      color: string;
      opacity: number;
      /** Stroke instead of fill (checkbox outlines). */
      stroke?: number;
    }
  | { kind: 'image'; png: Uint8Array; opacity: number }
  /** One line of text, laid out like the editor (glyph outlines, no embedded font). */
  | { kind: 'text'; text: string; color: string; opacity: number };

export interface ExportItem {
  page: number;
  /** Fractions of the displayed page (top-left origin). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise as displayed. */
  rotation: number;
  shapes: ExportShape[];
}

export interface TrailEntry {
  /** ISO 8601 with the local UTC offset. */
  at: string;
  signer: string;
  /** SHA-256 of the file this export started from. */
  sourceSha256: string;
  app: string;
  platform: string;
}

export interface ExportInput {
  original: Uint8Array;
  expectedSha256: string;
  password?: string | undefined;
  items: readonly ExportItem[];
  flattenForms: boolean;
  auditPage: boolean;
  signer: string;
  producer: string;
  platform: string;
  /** Fonts for text fields and the audit page (first = main, others fallback). */
  fonts: readonly Uint8Array[];
  now?: Date;
  onProgress?: (stage: 'signatures' | 'flatten' | 'write') => void;
}

export class ExportError extends Error {
  constructor(
    readonly code: 'integrity' | 'load' | 'write',
    message: string,
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

const TRAIL_KEY = 'DaSignatureTrail';

/** The trailer /Info dictionary (pdf-lib keeps its own accessor private). */
function infoDict(doc: PDFDocument): PDFDict {
  const existing = doc.context.lookup(doc.context.trailerInfo.Info);
  if (existing instanceof PDFDict) return existing;
  const dict = doc.context.obj({});
  doc.context.trailerInfo.Info = doc.context.register(dict);
  return dict;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** ISO 8601 local time with offset, e.g. 2026-10-20T14:03:00+02:00. */
export function isoWithOffset(d: Date): string {
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes(),
  )}:${p(d.getSeconds())}${sign}${p(off / 60)}:${p(off % 60)}`;
}

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Displayed (y-down, rotated, CropBox-relative points) → PDF user space. */
export function displayToUser(
  crop: { x: number; y: number; width: number; height: number },
  rotate: number,
): { m: Matrix; width: number; height: number } {
  const r = (((Math.round(rotate / 90) * 90) % 360) + 360) % 360;
  const x0 = crop.x;
  const y0 = crop.y;
  const x1 = crop.x + crop.width;
  const y1 = crop.y + crop.height;
  switch (r) {
    case 90:
      return { m: [0, 1, 1, 0, x0, y0], width: crop.height, height: crop.width };
    case 180:
      return { m: [-1, 0, 0, 1, x1, y0], width: crop.width, height: crop.height };
    case 270:
      return { m: [0, -1, -1, 0, x1, y1], width: crop.height, height: crop.width };
    default:
      return { m: [1, 0, 0, -1, x0, y1], width: crop.width, height: crop.height };
  }
}

function hexColor(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1] ?? '000000', 16) : 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Item frame (vbW × vbH, y down) → PDF user space for a placement on a page. */
export function itemMatrix(
  page: { m: Matrix; width: number; height: number },
  it: Pick<ExportItem, 'x' | 'y' | 'w' | 'h' | 'rotation'>,
  vbW: number,
  vbH: number,
): Matrix {
  const wPt = it.w * page.width;
  const hPt = it.h * page.height;
  const cx = (it.x + it.w / 2) * page.width;
  const cy = (it.y + it.h / 2) * page.height;
  const a = (it.rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  let m = page.m;
  m = mul(m, [1, 0, 0, 1, cx, cy]);
  m = mul(m, [c, s, -s, c, 0, 0]);
  m = mul(m, [wPt / vbW, 0, 0, hPt / vbH, 0, 0]);
  m = mul(m, [1, 0, 0, 1, -vbW / 2, -vbH / 2]);
  return m;
}

function removeEncryptDicts(doc: PDFDocument): void {
  // Leftovers from the encrypted original: its /Encrypt dictionary and old cross-reference
  // streams (which still point at it). The new file gets a fresh xref table.
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFInvalidObject) {
      doc.context.delete(ref);
      continue;
    }
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : undefined;
    if (!dict) continue;
    const filter = dict.get(PDFName.of('Filter'));
    const type = dict.get(PDFName.of('Type'));
    const isEncrypt =
      filter instanceof PDFName &&
      filter.asString() === '/Standard' &&
      dict.has(PDFName.of('O')) &&
      dict.has(PDFName.of('U'));
    // Object streams were already unpacked into the context when the file was parsed.
    const isXref =
      type instanceof PDFName && (type.asString() === '/XRef' || type.asString() === '/ObjStm');
    if (isEncrypt || isXref) doc.context.delete(ref);
  }
}

/** Reads the embedded DaSignature audit trail (empty if none). */
export function readTrailFrom(doc: PDFDocument): TrailEntry[] {
  const v = infoDict(doc).get(PDFName.of(TRAIL_KEY));
  if (!(v instanceof PDFHexString || v instanceof PDFString)) return [];
  try {
    const parsed = JSON.parse(v.decodeText()) as { v?: number; entries?: TrailEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

export async function readTrail(bytes: Uint8Array, password?: string): Promise<TrailEntry[]> {
  const doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  return readTrailFrom(doc);
}

function drawPath(page: PDFPage, m: Matrix, shape: Extract<ExportShape, { kind: 'path' }>) {
  // drawSvgPath applies its own y flip (scale 1,-1); pre-flip so the net transform is `m`.
  const flip = mul(m, [1, 0, 0, -1, 0, 0]);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...flip));
  if (shape.stroke)
    page.drawSvgPath(shape.d, {
      x: 0,
      y: 0,
      borderColor: hexColor(shape.color),
      borderWidth: shape.stroke,
      borderOpacity: shape.opacity,
    });
  else
    page.drawSvgPath(shape.d, {
      x: 0,
      y: 0,
      color: hexColor(shape.color),
      opacity: shape.opacity,
    });
  page.pushOperators(popGraphicsState());
}

export async function exportSigned(
  input: ExportInput,
): Promise<{ bytes: Uint8Array; sha256: string }> {
  const sourceSha = await sha256Hex(input.original);
  if (sourceSha !== input.expectedSha256)
    throw new ExportError('integrity', 'The original file changed since it was opened.');
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input.original.slice(), {
      password: input.password ?? '',
      updateMetadata: false,
    });
  } catch (err) {
    throw new ExportError('load', err instanceof Error ? err.message : String(err));
  }
  removeEncryptDicts(doc);
  const now = input.now ?? new Date();

  input.onProgress?.('signatures');
  const pages = doc.getPages();
  for (const it of input.items) {
    const page = pages[it.page];
    if (!page) continue;
    const frame = displayToUser(page.getCropBox(), page.getRotation().angle);
    for (const shape of it.shapes) {
      if (shape.kind === 'path') drawPath(page, itemMatrix(frame, it, shape.vbW, shape.vbH), shape);
      else if (shape.kind === 'text') {
        const wPt = it.w * frame.width;
        const hPt = it.h * frame.height;
        const { d } = textLine(input.fonts, shape.text, hPt);
        if (d)
          drawPath(page, itemMatrix(frame, it, wPt, hPt), {
            kind: 'path',
            d,
            vbW: wPt,
            vbH: hPt,
            color: shape.color,
            opacity: shape.opacity,
          });
      } else {
        const img = await doc.embedPng(shape.png);
        // Image unit square has y up: flip it into the y-down item frame.
        const m = mul(itemMatrix(frame, it, 1, 1), [1, 0, 0, -1, 0, 1]);
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m));
        page.drawImage(img, { x: 0, y: 0, width: 1, height: 1, opacity: shape.opacity });
        page.pushOperators(popGraphicsState());
      }
    }
  }

  if (input.flattenForms) {
    input.onProgress?.('flatten');
    try {
      const form = doc.getForm();
      if (form.getFields().length > 0) form.flatten();
    } catch {
      /* odd or broken forms stay as they are */
    }
  }

  const trail = [
    ...readTrailFrom(doc),
    {
      at: isoWithOffset(now),
      signer: input.signer,
      sourceSha256: sourceSha,
      app: input.producer,
      platform: input.platform,
    },
  ];

  if (input.auditPage) addAuditPage(doc, trail, input.fonts);

  input.onProgress?.('write');
  doc.setProducer(input.producer);
  doc.setModificationDate(now);
  const info = infoDict(doc);
  if (input.signer) info.set(PDFName.of('DaSignatureSigner'), PDFHexString.fromText(input.signer));
  info.set(PDFName.of('DaSignatureSignedAt'), PDFString.of(isoWithOffset(now)));
  info.set(PDFName.of(TRAIL_KEY), PDFHexString.fromText(JSON.stringify({ v: 1, entries: trail })));
  let bytes: Uint8Array;
  try {
    bytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  } catch (err) {
    throw new ExportError('write', err instanceof Error ? err.message : String(err));
  }
  return { bytes, sha256: await sha256Hex(bytes) };
}

/** Audit certificate page (SPEC Sec 3.2): fingerprint, signer, time with TZ, app, platform. */
function addAuditPage(
  doc: PDFDocument,
  trail: readonly TrailEntry[],
  fonts: readonly Uint8Array[],
) {
  const last = doc.getPages()[doc.getPageCount() - 1];
  const size = last ? last.getSize() : { width: 612, height: 792 };
  const width = Math.min(size.width, size.height) === size.width ? size.width : 612;
  const height = width === size.width ? size.height : 792;
  const page = doc.addPage([width, height]);
  const frame = displayToUser({ x: 0, y: 0, width, height }, 0);
  const margin = 54;
  let y = margin;
  const line = (text: string, hPt: number, color = '#1B1F2A', gap = 4) => {
    if (!fonts.length || !text) {
      y += hPt + gap;
      return;
    }
    const { d, width: w } = textLine(fonts, text, hPt, 0.75, 0);
    if (d)
      drawPath(
        page,
        itemMatrix(
          frame,
          { x: margin / width, y: y / height, w: w / width, h: hPt / height, rotation: 0 },
          w,
          hPt,
        ),
        {
          kind: 'path',
          d,
          vbW: w,
          vbH: hPt,
          color,
          opacity: 1,
        },
      );
    y += hPt + gap;
  };
  line('DaSignature audit certificate', 24, '#1B1F2A', 10);
  line(
    'Simple electronic signature. This page records who exported this copy and when.',
    12,
    '#4B4F58',
    18,
  );
  trail.forEach((e, i) => {
    line(`Entry ${String(i + 1)} of ${String(trail.length)}`, 15, '#1B1F2A', 6);
    line(`Signer: ${e.signer || '(not given)'}`, 12);
    line(`Time: ${e.at}`, 12);
    line(`Source document SHA-256:`, 12);
    line(e.sourceSha256.slice(0, 32), 11, '#4B4F58', 2);
    line(e.sourceSha256.slice(32), 11, '#4B4F58');
    line(`App: ${e.app} · Platform: ${e.platform}`, 12, '#1B1F2A', 16);
  });
  line('No location or IP address is recorded.', 11, '#4B4F58');
}
