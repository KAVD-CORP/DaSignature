/**
 * PDF package placeholder (Milestone 1).
 * Worker wrappers for pdf.js (render) and pdf-lib (export) land in Milestones 3 and 6.
 */

/** Maximum import size in bytes (SPEC Sec 3.1: files up to 50 MB). */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/** Output filename for an exported document: <original>-signed.pdf (SPEC Sec 3.1). */
export function signedFileName(original: string): string {
  const base = original.replace(/\.pdf$/i, '');
  return `${base}-signed.pdf`;
}
