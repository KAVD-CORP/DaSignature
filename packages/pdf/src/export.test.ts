import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from '@cantoo/pdf-lib';
import {
  ExportError,
  displayToUser,
  exportSigned,
  isoWithOffset,
  itemMatrix,
  readTrail,
  sha256Hex,
  type ExportInput,
} from './export.ts';

const req = createRequire(import.meta.url);
const font = new Uint8Array(
  readFileSync(req.resolve('@fontsource/caveat/files/caveat-latin-400-normal.woff2')),
);
const fixture = (n: string) =>
  new Uint8Array(readFileSync(new URL(`../../../apps/web/e2e/fixtures/${n}`, import.meta.url)));

const apply = (m: number[], x: number, y: number) => [
  (m[0] ?? 0) * x + (m[2] ?? 0) * y + (m[4] ?? 0),
  (m[1] ?? 0) * x + (m[3] ?? 0) * y + (m[5] ?? 0),
];

async function base(rotate = 0) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([600, 800]);
  p.setCropBox(50, 100, 500, 600);
  p.setRotation(degrees(rotate));
  doc.addPage([600, 800]);
  return doc.save();
}

const input = async (
  original: Uint8Array,
  extra: Partial<ExportInput> = {},
): Promise<ExportInput> => ({
  original,
  expectedSha256: await sha256Hex(original),
  items: [
    {
      page: 0,
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.1,
      rotation: 15,
      shapes: [
        { kind: 'path', d: 'M0,0L10,0L10,5Z', vbW: 10, vbH: 5, color: '#1F3A8A', opacity: 0.5 },
      ],
    },
  ],
  flattenForms: true,
  auditPage: false,
  signer: 'Ama Mensah',
  producer: 'DaSignature 0.1.0',
  platform: 'web',
  fonts: [font],
  now: new Date('2026-10-20T12:00:00Z'),
  ...extra,
});

describe('export geometry', () => {
  it('maps displayed corners to the CropBox for every /Rotate', () => {
    const crop = { x: 50, y: 100, width: 450, height: 500 };
    const tl: Record<number, number[]> = {
      0: [50, 600],
      90: [50, 100],
      180: [500, 100],
      270: [500, 600],
    };
    for (const r of [0, 90, 180, 270]) {
      const f = displayToUser(crop, r);
      expect(apply(f.m, 0, 0)).toEqual(tl[r]);
      // The opposite displayed corner is the opposite CropBox corner.
      const br = apply(f.m, f.width, f.height);
      expect(br[0]).toBe((tl[r]?.[0] ?? 0) === 50 ? 500 : 50);
      expect(br[1]).toBe((tl[r]?.[1] ?? 0) === 600 ? 100 : 600);
    }
    expect(displayToUser(crop, 90).width).toBe(500);
  });
  it('places the item frame centre at the box centre', () => {
    const f = displayToUser({ x: 0, y: 0, width: 600, height: 800 }, 0);
    const m = itemMatrix(f, { x: 0.25, y: 0.25, w: 0.5, h: 0.5, rotation: 30 }, 10, 10);
    const c = apply(m, 5, 5);
    expect(c[0]).toBeCloseTo(300);
    expect(c[1]).toBeCloseTo(400);
  });
  it('formats times with the local offset', () => {
    expect(isoWithOffset(new Date())).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
  });
});

describe('exportSigned', () => {
  it('writes a new file, leaves the original untouched, records metadata and the trail', async () => {
    const original = await base(90);
    const copy = original.slice();
    const inp = await input(original, { auditPage: true });
    const out = await exportSigned(inp);
    expect(original).toEqual(copy);
    expect(out.sha256).toBe(await sha256Hex(out.bytes));
    const doc = await PDFDocument.load(out.bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(3); // + audit page
    expect(doc.getProducer()).toBe('DaSignature 0.1.0');
    const trail = await readTrail(out.bytes);
    expect(trail).toHaveLength(1);
    expect(trail[0]?.sourceSha256).toBe(inp.expectedSha256);
    expect(trail[0]?.signer).toBe('Ama Mensah');
    const text = Buffer.from(out.bytes).toString('latin1');
    expect(text).toContain('/ca 0.5'); // group opacity via ExtGState
    expect(text).not.toMatch(/Location|IPAddress/);
    // Re-signing appends to the trail (multi-signer by file exchange).
    const again = await exportSigned(await input(out.bytes));
    expect(await readTrail(again.bytes)).toHaveLength(2);
  });
  it('refuses when the original changed (integrity, step 1)', async () => {
    const original = await base();
    const inp = await input(original);
    await expect(exportSigned({ ...inp, expectedSha256: '0'.repeat(64) })).rejects.toBeInstanceOf(
      ExportError,
    );
  });
  it('decrypts password and restricted PDFs; the copy has no encryption', async () => {
    for (const [name, password] of [
      ['user-password.pdf', 'user123'],
      ['owner-edit-restricted.pdf', undefined],
    ] as const) {
      const original = fixture(name);
      const out = await exportSigned(await input(original, { password }));
      const text = Buffer.from(out.bytes).toString('latin1');
      expect(text).not.toContain('/Encrypt');
      const doc = await PDFDocument.load(out.bytes);
      expect(doc.isEncrypted).toBe(false);
    }
  });
});
