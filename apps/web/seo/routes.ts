/**
 * Public SEO / guide pages (decisions.md E-108..E-112). Shared by the page generator (plugin.ts)
 * and the service worker (pwa.ts), so the worker never precaches these files and never answers
 * their navigations with the app shell.
 *
 * Everything public-facing that isn't the app lives under GUIDES (one path prefix), so Render
 * header and cache rules for it can't overlap the app's routes.
 */
export const GUIDES = '/guides';

/** Same-origin analytics relay (render.yaml rewrite), used only by the guide pages. */
export const RELAY = '/ingest';

/** Crawler files at the site root (Render serves them before the SPA rewrite). */
export const ROOT_FILES = ['robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt'] as const;

/** dist-relative file the worker must not precache. */
export function isPublicFile(file: string): boolean {
  return file.startsWith(GUIDES.slice(1) + '/') || (ROOT_FILES as readonly string[]).includes(file);
}
