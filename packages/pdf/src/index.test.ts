import { describe, expect, it } from 'vitest';
import {
  MAX_PDF_BYTES,
  PdfImportError,
  hasPdfMagic,
  signedFileName,
  titleFromFileName,
  validatePdfBytes,
} from './index.ts';

const enc = (s: string) => new TextEncoder().encode(s);

// EXP-NAME-01 cases copied verbatim from qa/scripts/resign-name.reference.mjs.
const CASES: [string, string[], string][] = [
  ['x.pdf', [], 'x-signed.pdf'],
  ['x.pdf', ['x-signed.pdf'], 'x-signed-2.pdf'],
  ['x.pdf', ['x-signed.pdf', 'x-signed-2.pdf', 'x-signed-3.pdf'], 'x-signed-4.pdf'],
  ['x.pdf', ['x-signed.pdf', 'x-signed-3.pdf'], 'x-signed-4.pdf'],
  ['x.pdf', ['X-Signed-2.pdf'], 'x-signed-3.pdf'],
  ['x-signed.pdf', [], 'x-signed-2.pdf'],
  ['x-signed-2.pdf', [], 'x-signed-3.pdf'],
  ['x-signed.pdf', ['x-signed-2.pdf', 'x-signed-5.pdf'], 'x-signed-6.pdf'],
  ['X-SIGNED.PDF', [], 'X-signed-2.pdf'],
  ['x-Signed-3.pdf', [], 'x-signed-4.pdf'],
  ['x-SIGNED-12.Pdf', [], 'x-signed-13.pdf'],
  ['x-signed-999.pdf', [], 'x-signed-1000.pdf'],
  ['x-signed-1000.pdf', [], 'x-signed-1000-signed.pdf'],
  ['x-signed-01.pdf', [], 'x-signed-01-signed.pdf'],
  ['x-signed-1.pdf', [], 'x-signed-1-signed.pdf'],
  ['x-signed-0.pdf', [], 'x-signed-0-signed.pdf'],
  ['report-signed-2024.pdf', [], 'report-signed-2024-signed.pdf'],
  ['a-signed-signed.pdf', [], 'a-signed-signed-2.pdf'],
  ['a-signed-2-signed-3.pdf', [], 'a-signed-2-signed-4.pdf'],
  ['design-signedoff.pdf', [], 'design-signedoff-signed.pdf'],
  ['Résumé 2026 (final).pdf', [], 'Résumé 2026 (final)-signed.pdf'],
  ['x.pdf', ['y-signed.pdf'], 'x-signed.pdf'],
];

describe('@dasignature/pdf naming (EXP-NAME-01, PM #25/#39/#48/#50)', () => {
  it.each(CASES)('%s history=%j -> %s', (input, history, want) => {
    expect(signedFileName(input, history)).toBe(want);
  });
});

describe('@dasignature/pdf import validation (SEC-03)', () => {
  it('caps imports at 50 MB', () => {
    expect(MAX_PDF_BYTES).toBe(52_428_800);
    const big = new Uint8Array(MAX_PDF_BYTES + 1);
    big.set(enc('%PDF-1.7'));
    expect(() => {
      validatePdfBytes(big);
    }).toThrow(/larger than 50 MB/);
  });
  it('rejects non-PDF bytes whatever the name, accepts leading junk before %PDF-', () => {
    expect(() => {
      validatePdfBytes(enc('PK\u0003\u0004 not a pdf'));
    }).toThrow(PdfImportError);
    expect(hasPdfMagic(enc('junk\n%PDF-1.4\n'))).toBe(true);
    expect(hasPdfMagic(enc('%PDF'))).toBe(false);
  });
  it('derives titles from file names', () => {
    expect(titleFromFileName('Lease 2026.pdf')).toBe('Lease 2026');
    expect(titleFromFileName('.pdf')).toBe('Untitled');
  });
});
