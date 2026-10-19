/**
 * Content Security Policy and security headers (PM decision #1, #23; SPEC Sec 5 rule 1, Sec 9).
 * Single source of truth for the web build (<meta> + _headers) and checked against the
 * Tauri config by tests. Everything is same-origin; no remote host is allowed anywhere.
 */
export const CSP_DIRECTIVES: Readonly<Record<string, string>> = {
  'default-src': "'self'",
  'script-src': "'self' 'wasm-unsafe-eval'",
  'worker-src': "'self' blob:",
  'connect-src': "'self' blob: data:",
  'img-src': "'self' blob: data:",
  'font-src': "'self'",
  // 'unsafe-inline' for Radix UI inline styles (PM decision #1).
  'style-src': "'self' 'unsafe-inline'",
  'object-src': "'none'",
  'base-uri': "'none'",
  'frame-ancestors': "'none'",
  'form-action': "'none'",
};

/** Directives browsers ignore (and warn about) in a <meta> CSP; they are sent as a header only. */
const HEADER_ONLY = new Set(['frame-ancestors']);

export function serializeCsp(directives: Readonly<Record<string, string>>): string {
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v}`)
    .join('; ');
}

/** Full policy, for the HTTP header and the Tauri webview. */
export const CSP = serializeCsp(CSP_DIRECTIVES);

/** Policy for the <meta http-equiv> tag in index.html (header-only directives removed). */
export const CSP_META = serializeCsp(
  Object.fromEntries(Object.entries(CSP_DIRECTIVES).filter(([k]) => !HEADER_ONLY.has(k))),
);

/** Headers every static host must send for the app (SPEC Sec 9, 14). */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CSP,
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

/**
 * `_headers` file (Netlify / Cloudflare Pages format) emitted into dist/.
 * Hashed assets are immutable; index.html, sw.js and the manifest are no-cache (PM decision #23).
 */
export function headersFile(): string {
  const security = Object.entries(SECURITY_HEADERS)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');
  return [
    '/*',
    security,
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    '/index.html',
    '  Cache-Control: no-cache',
    '',
    '/',
    '  Cache-Control: no-cache',
    '',
    '/sw.js',
    '  Cache-Control: no-cache',
    '',
    '/manifest.webmanifest',
    '  Cache-Control: no-cache',
    '',
  ].join('\n');
}
