// @vitest-environment node
/**
 * render.yaml (PM #62) stays in sync with the single CSP source (apps/web/csp.ts, PM #1) and keeps
 * the Render Static Site essentials. QA's qa/scripts/check-render-headers.mjs does the full
 * header emulation against a built dist.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CSP } from '../csp.ts';

const yaml = readFileSync(fileURLToPath(new URL('../../../render.yaml', import.meta.url)), 'utf8');
const header = (path: string, name: string) =>
  new RegExp(
    `- path: ${path.replace(/[/*.]/g, (c) => `\\${c}`)}\\n\\s+name: ${name}\\n\\s+value: "?([^"\\n]+)"?\\n`,
  ).exec(yaml)?.[1];

describe('render.yaml (PM #62)', () => {
  it('is a Render static site with the pinned build and publish path', () => {
    expect(yaml).toMatch(/- type: web\n\s+runtime: static\n/);
    expect(yaml).toContain(
      'buildCommand: pnpm install --frozen-lockfile && pnpm --filter web build',
    );
    expect(yaml).toContain('staticPublishPath: apps/web/dist');
    expect(yaml).toMatch(/- type: rewrite\n\s+source: \/\*\n\s+destination: \/index\.html/);
  });

  it('sends the PM #1 CSP and the security headers on every path', () => {
    expect(header('/*', 'Content-Security-Policy')).toBe(CSP);
    expect(header('/*', 'Referrer-Policy')).toBe('no-referrer');
    expect(header('/*', 'X-Content-Type-Options')).toBe('nosniff');
    expect(header('/*', 'Permissions-Policy')).toBe('camera=(self)');
  });

  it('caches per PM #23', () => {
    expect(header('/assets/*', 'Cache-Control')).toBe('public, max-age=31536000, immutable');
    for (const p of ['/', '/index.html', '/sw.js'])
      expect(header(p, 'Cache-Control')).toBe('no-cache');
  });
});
