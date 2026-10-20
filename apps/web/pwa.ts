/**
 * Build-only PWA service worker (SPEC Sec 4 web target, PM #23). After the bundle is written, every
 * file in dist (except QA-only pages) is listed in a precache whose name is a content hash, so a
 * new deploy installs a new cache and drops the old one. No runtime network beyond same-origin.
 * The share target (manifest `share_target`) POSTs to /share-target; the worker stashes the files
 * in a dedicated cache and redirects to /?shared=1, where the app picks them up (inbound.ts).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

const SKIP = new Set(['sw.js', '_headers', 'showcase.html', 'missing-asset.txt']);

function walk(dir: string, root: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, root, out);
    else out.push(relative(root, p).split(sep).join('/'));
  }
  return out;
}

export function swSource(version: string, files: readonly string[]): string {
  return `/* DaSignature service worker (generated at build; do not edit). */
'use strict';
const VERSION = ${JSON.stringify(version)};
const CACHE = 'dasig-' + VERSION;
const SHARE = 'dasig-share';
const PRECACHE = ${JSON.stringify(['/', ...files.map((f) => '/' + f)])};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dasig-') && k !== CACHE && k !== SHARE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
async function share(req) {
  const form = await req.formData();
  const c = await caches.open(SHARE);
  let i = 0;
  for (const f of form.getAll('file')) {
    if (typeof f === 'string') continue;
    await c.put('/__shared/' + i++, new Response(f, { headers: { 'content-type': f.type || 'application/pdf', 'x-name': encodeURIComponent(f.name || 'shared.pdf') } }));
  }
  return Response.redirect('/?shared=1', 303);
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method === 'POST' && url.pathname === '/share-target') { e.respondWith(share(req)); return; }
  if (req.method !== 'GET') return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreVary: true, ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') { const shell = await c.match('/index.html', { ignoreVary: true }); if (shell) return shell; }
    return fetch(req);
  })());
});
`;
}

export function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'dasignature-service-worker',
    apply: 'build',
    configResolved(c) {
      outDir = join(c.root, c.build.outDir);
    },
    closeBundle() {
      const files = walk(outDir, outDir, [])
        .filter((f) => !SKIP.has(f))
        .sort();
      const h = createHash('sha256');
      for (const f of files) h.update(f).update(readFileSync(join(outDir, f)));
      writeFileSync(join(outDir, 'sw.js'), swSource(h.digest('hex').slice(0, 16), files));
    },
  };
}
