import { describe, expect, it } from 'vitest';
import { MAX_PDF_BYTES, signedFileName } from './index.ts';

describe('@dasignature/pdf', () => {
  it('names exports <original>-signed.pdf', () => {
    expect(signedFileName('contract.pdf')).toBe('contract-signed.pdf');
    expect(signedFileName('Lease.PDF')).toBe('Lease-signed.pdf');
    expect(signedFileName('notes')).toBe('notes-signed.pdf');
  });
  it('caps imports at 50 MB', () => {
    expect(MAX_PDF_BYTES).toBe(52_428_800);
  });
});
