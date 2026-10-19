import { describe, expect, it } from 'vitest';
import { CSP, CSP_DIRECTIVES, CSP_META, headersFile, SECURITY_HEADERS } from '../csp.ts';

describe('CSP (PM decision #1)', () => {
  it('matches the PM decision exactly', () => {
    expect(CSP).toBe(
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; " +
        "connect-src 'self' blob: data:; img-src 'self' blob: data:; font-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; " +
        "frame-ancestors 'none'; form-action 'none'",
    );
  });
  it('allows no remote origins', () => {
    expect(CSP).not.toMatch(/https?:|\*|wss?:/);
  });
  it('drops header-only directives from the meta tag', () => {
    expect(CSP_META).not.toContain('frame-ancestors');
    expect(CSP_META).toContain("default-src 'self'");
    expect(CSP_DIRECTIVES['frame-ancestors']).toBe("'none'");
  });
  it('emits the required security headers', () => {
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('no-referrer');
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(headersFile()).toContain(`Content-Security-Policy: ${CSP}`);
    expect(headersFile()).toContain('Cache-Control: public, max-age=31536000, immutable');
  });
});
