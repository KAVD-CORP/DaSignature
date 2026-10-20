/**
 * Output filename for an export (SPEC Sec 3.1, PM #25/#39/#48/#50). On the basename,
 * case-insensitively strip at most ONE trailing -signed or -signed-N (N 2..999, no leading zero).
 * Counter = max(stripped suffix's counter, highest counter in this document's export history for
 * the same stem) + 1. Matches QA's EXP-NAME-01 oracle (qa/scripts/resign-name.reference.mjs).
 */
const SUFFIX = /^(.*?)-signed(?:-([2-9]|[1-9][0-9]{1,2}))?$/i;
const stemOf = (name: string) => name.replace(/\.pdf$/i, '');
function parse(stem: string): { stem: string; c: number } {
  const m = SUFFIX.exec(stem);
  if (!m) return { stem, c: 0 };
  return { stem: m[1] ?? '', c: m[2] ? Number(m[2]) : 1 };
}

export function signedFileName(original: string, history: readonly string[] = []): string {
  const { stem, c } = parse(stemOf(original));
  let h = 0;
  for (const prev of history) {
    const p = parse(stemOf(prev));
    if (p.c && p.stem.toLowerCase() === stem.toLowerCase()) h = Math.max(h, p.c);
  }
  const k = Math.max(c, h) + 1;
  return k === 1 ? `${stem}-signed.pdf` : `${stem}-signed-${String(k)}.pdf`;
}
