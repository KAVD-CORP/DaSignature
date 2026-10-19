// Deterministic fixture data for the storage contracts. Marker strings are what the raw-byte scans look for.
export const MARKERS = {
  title: 'QA-MARKER-TITLE-Квартальный-отчёт-報告書',
  signer: 'QA-MARKER-SIGNER-Zoë Ångström',
  typed: 'QA-MARKER-TYPED-Ζωή',
  /** signatures.name: encrypted per PM #65 (added to #17). */
  signatureName: 'QA-MARKER-SIGNAME-Siobhán-Ó-Briain',
  strokes: '{"qaMarker":"QA-MARKER-STROKES","points":[[0.1,0.2,0.5]]}',
  svg: 'M0 0 L10 10 QA-MARKER-SVG',
  placementData: '{"qaMarker":"QA-MARKER-PLACEMENT"}',
  templateName: 'QA-MARKER-TEMPLATE',
  templatePlacements: '[{"qaMarker":"QA-MARKER-TPL-PLACEMENTS"}]',
  pdfBody: 'QA-MARKER-PDF-BODY',
} as const;

/** A small valid single-page PDF whose content stream contains MARKERS.pdfBody. Byte-for-byte deterministic. */
export function fixturePdf(extraBytes = 0): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${MARKERS.pdfBody}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n'; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const head = Uint8Array.from(out, (ch) => ch.charCodeAt(0) & 0xff);
  if (!extraBytes) return head;
  const big = new Uint8Array(head.length + extraBytes); big.set(head); // padding after %%EOF is legal (incremental-update slack)
  for (let i = 0; i < extraBytes; i++) big[head.length + i] = (i * 2654435761) >>> 24;  // deterministic, incompressible-ish
  return big;
}

/** Deterministic pseudo-random bytes (xorshift32). */
export function bytes(n: number, seed = 1): Uint8Array {
  const b = new Uint8Array(n); let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; b[i] = x & 0xff; }
  return b;
}

export async function sha256hex(b: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(b)) /* copy: TS 5.9 BufferSource needs an ArrayBuffer-backed view */);
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Search haystack for needle encoded as UTF-8 and UTF-16LE (SQLite text encodings). Returns the encodings found. */
export function findText(hay: Uint8Array, needle: string): string[] {
  const enc: [string, Uint8Array][] = [['utf8', new TextEncoder().encode(needle)], ['utf16le', Uint8Array.from([...needle].flatMap((ch) => { const c = ch.charCodeAt(0); return [c & 0xff, c >> 8]; }))]];
  return enc.filter(([, n]) => indexOf(hay, n) >= 0).map(([e]) => e);
}
export function indexOf(hay: Uint8Array, n: Uint8Array): number {
  if (!n.length) return 0;
  outer: for (let i = 0; i + n.length <= hay.length; i++) { for (let j = 0; j < n.length; j++) if (hay[i + j] !== n[j]) continue outer; return i; }
  return -1;
}
/** uuid v7: version nibble 7, RFC 4122 variant. */
export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** ISO 8601 with an explicit offset (SPEC Sec 10). */
export const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
