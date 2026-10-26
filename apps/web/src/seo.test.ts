/**
 * Public guide pages and crawler files (decisions.md E-108..E-112): unique metadata, parseable
 * JSON-LD, a well-formed sitemap, internal links that resolve, render.yaml routing that keeps the
 * guides and the analytics relay apart from the app, and analytics isolation (dummy key only).
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { swSource } from '../pwa.ts';
import { ORIGIN, PAGES, pathOf } from '../seo/content.ts';
import { analyticsLeaks } from '../seo/isolation.ts';
import { DEFAULT_HOST, analyticsFromEnv, analyticsLoader, relayHost } from '../seo/plugin.ts';
import { llms, llmsFull, renderPage, robots, sitemap } from '../seo/render.ts';
import { isPublicFile } from '../seo/routes.ts';

// jsdom replaces the global URL, so resolve paths from the file URL string.
const here = dirname(fileURLToPath(import.meta.url));
const DUMMY = 'phc_dummy_test_key_not_real';
const css = '/guides/assets/site-test.css';
const yaml = readFileSync(join(here, '../../../render.yaml'), 'utf8');
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const pages = PAGES.map((p) => ({
  p,
  html: renderPage(p, { css }),
  doc: parse(renderPage(p, { css })),
}));
const meta = (d: Document, sel: string) => d.querySelector(sel)?.getAttribute('content') ?? '';

// Render header-glob semantics, as emulated by scripts/qa/check-render-headers.mjs.
const glob = (p: string) =>
  p.endsWith('/*') && !p.slice(0, -2).includes('*')
    ? new RegExp('^' + p.slice(0, -1).replace(/[.]/g, '\\.') + '.*$')
    : new RegExp('^' + p.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*') + '$');
const headerRules = [...yaml.matchAll(/- path: (\S+)\n\s+name: (\S+)\n\s+value: (.+)\n/g)].map(
  (m) => ({ path: m[1] ?? '', name: m[2] ?? '', value: m[3] ?? '' }),
);
const routeSources = [
  ...yaml.matchAll(/- type: rewrite\n\s+source: (\S+)\n\s+destination: (\S+)/g),
];

describe('guide pages (E-108)', () => {
  it('has a landing page and about ten use-case pages, all under /guides', () => {
    expect(PAGES[0]?.slug).toBe('');
    expect(PAGES.length).toBeGreaterThanOrEqual(11);
    for (const { p } of pages) expect(pathOf(p.slug)).toMatch(/^\/guides(\/[a-z0-9-]+)?$/);
  });

  it('gives every page a unique title, description and canonical, plus OG and Twitter tags', () => {
    const seen = { t: new Set(), d: new Set(), c: new Set() };
    for (const { p, doc } of pages) {
      const title = doc.title;
      const desc = meta(doc, 'meta[name="description"]');
      const canon = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
      expect(title.length).toBeLessThanOrEqual(70);
      expect(desc.length).toBeGreaterThan(50);
      expect(desc.length).toBeLessThanOrEqual(160);
      expect(canon).toBe(ORIGIN + pathOf(p.slug));
      seen.t.add(title);
      seen.d.add(desc);
      seen.c.add(canon);
      expect(meta(doc, 'meta[property="og:url"]')).toBe(canon);
      expect(meta(doc, 'meta[property="og:title"]')).toBe(title);
      expect(meta(doc, 'meta[property="og:image"]')).toBe(`${ORIGIN}/guides/assets/og-image.png`);
      expect(meta(doc, 'meta[property="og:image:width"]')).toBe('1200');
      expect(meta(doc, 'meta[property="og:image:height"]')).toBe('630');
      expect(meta(doc, 'meta[name="twitter:card"]')).toBe('summary_large_image');
    }
    expect(seen.t.size).toBe(PAGES.length);
    expect(seen.d.size).toBe(PAGES.length);
    expect(seen.c.size).toBe(PAGES.length);
  });

  it('puts the content in the raw HTML with no scripts, inline styles or redirects', () => {
    for (const { p, html, doc } of pages) {
      expect(doc.querySelector('h1')?.textContent).toBe(p.h1);
      for (const s of p.howTo?.steps ?? []) expect(html).toContain(s.name);
      for (const f of p.faqs) expect(doc.body.textContent).toContain(f.q);
      expect([...doc.scripts].map((s) => s.type)).toEqual(['application/ld+json']);
      expect(html).not.toMatch(/ style=|<style|http-equiv="refresh"/i);
      expect(doc.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe(css);
      expect(doc.querySelectorAll('a[href="/"][data-app-link]').length).toBeGreaterThanOrEqual(2);
      expect(html).not.toMatch(/posthog/i);
    }
  });

  it('keeps the legal wording to simple e-signatures (spec Sec 9)', () => {
    for (const { doc } of pages) {
      const text = doc.body.textContent;
      expect(text).toContain('simple electronic signature');
      expect(text).not.toMatch(/\b(is|are|creates?|makes?) (a )?(qualified|advanced) electronic/i);
      // AES/QES may only be named to say DaSignature does not make them (AES-256 is the cipher).
      for (const sentence of text.split(/(?<=[.?!])/))
        if (/\b(QES|AES)\b(?!-256)/.test(sentence)) expect(sentence).toMatch(/\bnot\b/);
    }
  });

  it('has JSON-LD that parses, with SoftwareApplication on the landing page only', () => {
    for (const { p, doc } of pages) {
      const ld = JSON.parse(
        doc.querySelector('script[type="application/ld+json"]')?.textContent ?? '',
      ) as {
        '@graph': { '@type': string }[];
      };
      const types = ld['@graph'].map((n) => n['@type']);
      expect(types).toContain('BreadcrumbList');
      expect(types).toContain('FAQPage');
      if (p.howTo) expect(types).toContain('HowTo');
      expect(types.includes('SoftwareApplication')).toBe(p.slug === '');
    }
  });

  it('links only to paths that exist', () => {
    const known = new Set([
      '/',
      '/favicon.svg',
      '/favicon.ico',
      '/icons/apple-touch-icon-180.png',
      css,
    ]);
    for (const { p } of pages) known.add(pathOf(p.slug));
    const html = readFileSync(join(here, '../index.html'), 'utf8');
    for (const doc of [...pages.map((x) => x.doc), parse(html)])
      for (const el of doc.querySelectorAll('[href], [src]')) {
        const v = el.getAttribute('href') ?? el.getAttribute('src') ?? '';
        if (!v.startsWith('/') || v.startsWith('/src/') || v === '/manifest.webmanifest') continue;
        expect(known, v).toContain(v);
      }
  });
});

describe('crawler files (E-108)', () => {
  it('robots.txt allows all and names the sitemap', () => {
    expect(robots()).toMatch(/^User-agent: \*\nAllow: \/$/m);
    expect(robots()).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });
  it('sitemap.xml is well-formed and lists the app and every guide', () => {
    const xml = new DOMParser().parseFromString(sitemap(), 'application/xml');
    expect(xml.getElementsByTagName('parsererror')).toHaveLength(0);
    const locs = [...xml.getElementsByTagName('loc')].map((l) => l.textContent);
    expect(locs).toEqual([`${ORIGIN}/`, ...PAGES.map((p) => ORIGIN + pathOf(p.slug))]);
  });
  it('llms.txt links every guide and llms-full.txt carries their text', () => {
    for (const p of PAGES) {
      expect(llms()).toContain(ORIGIN + pathOf(p.slug));
      expect(llmsFull()).toContain(p.h1);
    }
    expect(llms() + llmsFull()).not.toMatch(/posthog/i);
  });
});

describe('render.yaml routing for public pages (E-108, E-110)', () => {
  it('serves guides, the relay and crawler files before the SPA rewrite', () => {
    const order = routeSources.map((m) => m[1]);
    const spa = order.indexOf('/*');
    expect(spa).toBe(order.length - 1);
    for (const s of ['/guides', '/guides/', '/guides/:slug', '/guides/:slug/', '/ingest/*'])
      expect(order.indexOf(s)).toBeGreaterThan(-1);
    expect(relayHost(yaml)).toBe(DEFAULT_HOST);
  });
  it('guide header rules never match app paths, and the CSP comes from one rule only', () => {
    const app = ['/', '/index.html', '/sw.js', '/showcase.html', '/assets/main-1.js', '/doc/x'];
    for (const r of headerRules.filter((h) => h.path.startsWith('/guides')))
      for (const a of app) expect(glob(r.path).test(a), `${r.path} vs ${a}`).toBe(false);
    expect(headerRules.filter((h) => h.name === 'Content-Security-Policy')).toHaveLength(1);
    for (const p of ['/guides', '/guides/x', '/robots.txt', '/sitemap.xml', '/llms.txt']) {
      const cc = headerRules.filter((h) => h.name === 'Cache-Control' && glob(h.path).test(p));
      expect(new Set(cc.map((h) => h.value)).size, p).toBe(1);
    }
  });
  it('the service worker never handles or precaches public pages', () => {
    const src = swSource('v', ['index.html']);
    expect(src).toContain('if (isPublic(url.pathname)) return;');
    expect(src).not.toMatch(/https?:\/\/|posthog/i);
    for (const f of [
      'guides/index.html',
      'guides/a/index.html',
      'guides/assets/x.css',
      'robots.txt',
      'sitemap.xml',
      'llms.txt',
      'llms-full.txt',
    ])
      expect(isPublicFile(f), f).toBe(true);
    for (const f of ['index.html', 'sw.js', 'assets/guides-1.js', 'showcase.html'])
      expect(isPublicFile(f), f).toBe(false);
  });
});

describe('guide-page analytics (E-112, dummy key only)', () => {
  it('is off without a key, and reads POSTHOG_KEY before POSTHOG_PROJECT_API_KEY', () => {
    expect(analyticsFromEnv({})).toBeUndefined();
    expect(analyticsFromEnv({ POSTHOG_KEY: ' ' })).toBeUndefined();
    expect(analyticsFromEnv({ POSTHOG_PROJECT_API_KEY: DUMMY })).toEqual({
      key: DUMMY,
      host: DEFAULT_HOST,
    });
    expect(analyticsFromEnv({ POSTHOG_KEY: DUMMY, POSTHOG_PROJECT_API_KEY: 'other' })?.key).toBe(
      DUMMY,
    );
    expect(
      analyticsFromEnv({ POSTHOG_KEY: DUMMY, POSTHOG_HOST: 'https://eu.i.posthog.com/' })?.host,
    ).toBe('https://eu.i.posthog.com');
    expect(() => analyticsFromEnv({ POSTHOG_KEY: DUMMY, POSTHOG_HOST: 'http://x' })).toThrow();
  });
  it('the loader skips everything under DNT/GPC and uses a cookieless, minimal config', () => {
    const src = analyticsLoader({ key: DUMMY, host: DEFAULT_HOST }, '/guides/assets/ph.js');
    expect(src.indexOf('globalPrivacyControl')).toBeLessThan(src.indexOf('createElement'));
    expect(src).toContain("n.doNotTrack === '1'");
    for (const kv of [
      '"api_host":"/ingest"',
      '"persistence":"memory"',
      '"autocapture":false',
      '"disable_session_recording":true',
      '"respect_dnt":true',
      '"capture_pageview":true',
    ])
      expect(src).toContain(kv);
    expect(src).toContain("'guide_open_app'");
    expect(src).not.toMatch(/https?:\/\//);
  });
  it('adds the loader script only to pages rendered with analytics', () => {
    const guide = PAGES.find((p) => p.slug);
    if (!guide) throw new Error('no guide page');
    const doc = parse(renderPage(guide, { css, analytics: '/guides/assets/analytics-x.js' }));
    expect([...doc.scripts].map((s) => s.getAttribute('src'))).toContain(
      '/guides/assets/analytics-x.js',
    );
  });
  it('flags "posthog" outside /guides/, or anywhere without a key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dasig-iso-'));
    mkdirSync(join(dir, 'guides/assets'), { recursive: true });
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'guides/assets/posthog.js'), 'posthog');
    writeFileSync(join(dir, 'assets/main.js'), 'clean');
    writeFileSync(join(dir, 'sw.js'), 'clean');
    expect(analyticsLeaks(dir, true)).toEqual([]);
    expect(analyticsLeaks(dir, false)).toEqual(['guides/assets/posthog.js']);
    writeFileSync(join(dir, 'sw.js'), 'PostHog');
    expect(analyticsLeaks(dir, true)).toEqual(['sw.js']);
  });
});
