/**
 * Build-only Vite plugin: emits the public guide pages and crawler files (decisions.md E-108..E-112).
 *
 *   /guides/index.html, /guides/<slug>/index.html   prerendered HTML (content.ts)
 *   /guides/assets/site-<hash>.css, og-image.png     stylesheet and 1200x630 Open Graph image
 *   /robots.txt, /sitemap.xml, /llms.txt, /llms-full.txt
 *
 * Analytics (owner decision Oct 26, E-112): only when POSTHOG_KEY (or POSTHOG_PROJECT_API_KEY) is
 * set at build time, the guide pages (never the app) get a self-hosted posthog-js bundle and a
 * small loader. Events go to the same-origin relay /ingest/*, which render.yaml rewrites to the
 * PostHog host, so the site CSP stays unchanged (connect-src 'self'). Without a key nothing
 * analytics-related is emitted at all.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { PAGES } from './content.ts';
import { OG_IMAGE, llms, llmsFull, renderPage, robots, sitemap } from './render.ts';
import { GUIDES, RELAY } from './routes.ts';

export const DEFAULT_HOST = 'https://us.i.posthog.com';

export interface AnalyticsConfig {
  key: string;
  host: string;
}

/** Reads the owner's analytics settings; undefined (no analytics) unless a key is set. */
export function analyticsFromEnv(env: NodeJS.ProcessEnv): AnalyticsConfig | undefined {
  const key = (env.POSTHOG_KEY || env.POSTHOG_PROJECT_API_KEY || '').trim();
  if (!key) return undefined;
  const host = (env.POSTHOG_HOST || DEFAULT_HOST).trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(host))
    throw new Error(`POSTHOG_HOST must be an https origin like ${DEFAULT_HOST}, got "${host}"`);
  return { key, host };
}

/** The relay destination host in render.yaml must be the configured PostHog host. */
export function relayHost(renderYaml: string): string | undefined {
  const m = new RegExp(
    `source: ${RELAY.replace(/\//g, '\\/')}\\/\\*\\n\\s+destination: (https:\\/\\/[^/\\s]+)\\/\\*`,
  ).exec(renderYaml);
  return m?.[1];
}

/** The loader: honours DNT/GPC before anything is fetched, then a cookieless, minimal init. */
export function analyticsLoader(cfg: AnalyticsConfig, lib: string): string {
  const options = {
    api_host: RELAY,
    persistence: 'memory',
    person_profiles: 'identified_only',
    autocapture: false,
    capture_pageview: true,
    capture_pageleave: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_web_experiments: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    capture_performance: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_exceptions: false,
    rageclick: false,
    respect_dnt: true,
  };
  return `/* DaSignature guide-page analytics loader (generated; decisions.md E-112). */
(function () {
  'use strict';
  var n = navigator;
  if (n.doNotTrack === '1' || window.doNotTrack === '1' || n.globalPrivacyControl === true) return;
  var s = document.createElement('script');
  s.src = ${JSON.stringify(lib)};
  s.async = true;
  s.onload = function () {
    var ph = window.posthog;
    if (!ph || typeof ph.init !== 'function') return;
    ph.init(${JSON.stringify(cfg.key)}, ${JSON.stringify(options)});
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[data-app-link]') : null;
      if (a) ph.capture('guide_open_app', { placement: a.getAttribute('data-app-link'), guide: location.pathname }, { transport: 'sendBeacon' });
    }, true);
  };
  document.head.appendChild(s);
})();
`;
}

const hash8 = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex').slice(0, 8);
const here = dirname(fileURLToPath(import.meta.url));

export function seoPages(env: NodeJS.ProcessEnv = process.env): Plugin {
  return {
    name: 'dasignature-seo-pages',
    apply: 'build',
    generateBundle() {
      const emit = (fileName: string, source: string | Uint8Array) => {
        this.emitFile({ type: 'asset', fileName, source });
      };
      const cssText = readFileSync(join(here, 'site.css'), 'utf8');
      const css = `${GUIDES}/assets/site-${hash8(cssText)}.css`;
      emit(css.slice(1), cssText);
      emit(OG_IMAGE.slice(1), readFileSync(join(here, 'og-image.png')));

      let analytics: string | undefined;
      const cfg = analyticsFromEnv(env);
      if (cfg) {
        const yaml = readFileSync(join(here, '../../../render.yaml'), 'utf8');
        const relay = relayHost(yaml);
        if (relay !== cfg.host)
          throw new Error(
            `POSTHOG_HOST is ${cfg.host} but render.yaml relays ${RELAY}/* to ${relay ?? 'nothing'}. ` +
              'Change the /ingest/* rewrite destination in render.yaml to the same host (docs/seo.md).',
          );
        const req = createRequire(join(here, '../package.json'));
        const pkgDir = dirname(req.resolve('posthog-js/package.json'));
        const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
          version: string;
        };
        const libSrc = readFileSync(join(pkgDir, 'dist/array.no-external.js'));
        const lib = `${GUIDES}/assets/posthog-js-${version}-${hash8(libSrc)}.js`;
        emit(lib.slice(1), libSrc);
        emit(
          `${GUIDES.slice(1)}/assets/posthog-js-LICENSE.txt`,
          readFileSync(join(pkgDir, 'LICENSE')),
        );
        const loader = analyticsLoader(cfg, lib);
        analytics = `${GUIDES}/assets/analytics-${hash8(loader)}.js`;
        emit(analytics.slice(1), loader);
      }

      for (const p of PAGES)
        emit(
          `${GUIDES.slice(1)}/${p.slug ? p.slug + '/' : ''}index.html`,
          renderPage(p, { css, analytics }),
        );
      emit('robots.txt', robots());
      emit('sitemap.xml', sitemap());
      emit('llms.txt', llms());
      emit('llms-full.txt', llmsFull());
    },
  };
}
