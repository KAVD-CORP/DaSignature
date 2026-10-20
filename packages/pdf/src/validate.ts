/** Import checks that run before any parsing (SPEC Sec 9: sanitize and size-limit imports). */

/** Maximum import size in bytes (SPEC Sec 3.1: files up to 50 MB; PM #2 binary units). */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/** Imports above this show "Large file, this may take a moment" (design 02-library). */
export const LARGE_PDF_BYTES = 20 * 1024 * 1024;

export type PdfImportErrorCode = 'not-pdf' | 'too-large' | 'damaged' | 'password-cancelled';

export class PdfImportError extends Error {
  override name = 'PdfImportError';
  constructor(
    readonly code: PdfImportErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** User-facing copy for each import error (design 02-library error states). */
export const IMPORT_ERROR_COPY: Record<
  Exclude<PdfImportErrorCode, 'password-cancelled'>,
  string
> = {
  'not-pdf': "That file isn't a PDF. DaSignature can open .pdf files only.",
  'too-large': 'This PDF is larger than 50 MB. Try a smaller file.',
  damaged: "This PDF couldn't be read. It may be damaged.",
};

const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

/** True when `%PDF-` appears in the first 1024 bytes (the PDF spec allows leading junk there). */
export function hasPdfMagic(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 1024) - MAGIC.length;
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < MAGIC.length; j++) if (bytes[i + j] !== MAGIC[j]) continue outer;
    return true;
  }
  return false;
}

/** Size first (cheap, no read), then the magic bytes. The file name and MIME are not trusted. */
export function checkPdfSize(size: number): void {
  if (size > MAX_PDF_BYTES) throw new PdfImportError('too-large', IMPORT_ERROR_COPY['too-large']);
}

export function validatePdfBytes(bytes: Uint8Array): void {
  checkPdfSize(bytes.length);
  if (!hasPdfMagic(bytes)) throw new PdfImportError('not-pdf', IMPORT_ERROR_COPY['not-pdf']);
}

/** Document title from a file name: strip the extension, keep the rest. */
export function titleFromFileName(name: string): string {
  const t = name.replace(/\.pdf$/i, '').trim();
  return t || 'Untitled';
}
