#!/usr/bin/env node
// DaSignature QA: RENDER-01, Render Static Site header check (PM #62; CSP = PM #1, caching = PM #23). First applies: M8.
// Self-contained (Node >= 18, no dependencies). It parses render.yaml (static-site `headers` + `routes`), serves a built dist
// locally applying those rules the way Render documents them, requests the key asset classes, and asserts the headers.
//
// Usage: node check-render-headers.mjs [--render=render.yaml] [--dist=apps/web/dist] [--allow-missing-sw] [--json]
//   Defaults are resolved from cwd (run from the repo root). Exit 0 = PASS, 1 = FAIL, 2 = usage/setup error.
//   --allow-missing-sw: before M8 the app has no service worker; the sw.js probe is then reported SKIP instead of FAIL.
//
// Render semantics emulated (sources: render.com/docs/static-site-headers, /redirects-rewrites, /blueprint-spec, read 2026-10-19):
//   * A header rule is {path, name, value}; `path` is matched against the REQUEST path. Every matching rule adds its header.
//     Globs: "/*" matches every path; "/x/*" matches everything under /x/ (trailing "/*" spans "/"); otherwise "*" stays within
//     one segment ("/*.css" doesn't match /assets/a.css) and "**" spans segments ("/**/*.css" matches /assets/a.css).
//   * Render doesn't document precedence when two matching rules set the SAME header to different values, so that is a FAIL
//     (the deployed result would be undefined).
//   * Routes: if a file exists at the request path it is served and routes are skipped. Otherwise the FIRST matching
//     redirect/rewrite applies (rewrite = serve the destination at the original URL, 200; redirect = 301). No match = 404.
//     "/" serves index.html. A route source "*" captures the rest of the path; "*" in the destination substitutes it.
//
// Assertions (every probed response unless stated):
//   * Content-Security-Policy equals PM #1 EXACTLY (string compare after trimming).
//   * Referrer-Policy: no-referrer; X-Content-Type-Options: nosniff; Permissions-Policy: camera=(self) (PM #62).
//   * Cache-Control (PM #23): hashed assets are exactly {public, max-age=31536000, immutable} (directive set, order-free);
//     "/", "/index.html" and "/sw.js" contain no-cache with no immutable and no max-age > 0.
//   * The SPA route (/qa/deep/route) is rewritten to index.html (200, HTML body, PM #62). Its Cache-Control must not be
//     immutable or a long max-age (FAIL). If it has none, that's a WARN: Render matches headers on the request path, so
//     a deep route only gets no-cache from a rule that also covers it.
//   * A missing hashed asset (/assets/qa-missing-0000000.js) served as index.html under an immutable rule is a WARN
//     (an HTML body cached for a year at an asset URL).
//   * render.yaml must exist, contain a static site (type web + runtime static, or legacy env static), and have >= 1 header rule.
//     staticPublishPath and the SPA rewrite `/* -> /index.html` are required; a buildCommand without --frozen-lockfile is a WARN.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, extname, normalize } from 'node:path';

export const CSP_PM1 = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data:; img-src 'self' blob: data:; font-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
export const SECURITY = { 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'permissions-policy': 'camera=(self)' };
export const IMMUTABLE = ['immutable', 'max-age=31536000', 'public'];

// ---------- minimal YAML subset parser (block maps, block sequences, scalars, quotes, | and > block scalars) ----------
export function parseYaml(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((raw, i) => ({ raw, n: i + 1 }));
  const stripComment = (s) => { let q = null; for (let i = 0; i < s.length; i++) { const c = s[i];
    if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i); } return s; };
  const items = [];
  for (let k = 0; k < lines.length; k++) {
    const { raw, n } = lines[k];
    if (/\t/.test(raw.match(/^\s*/)[0])) throw new Error(`YAML line ${n}: tab indentation`);
    const s = stripComment(raw).replace(/\s+$/, '');
    if (!s.trim() || s.trim() === '---') continue;
    items.push({ ind: s.match(/^ */)[0].length, text: s.trim(), n, k });
  }
  const scalar = (v, n) => {
    if (v === '' ) return null;
    if (v.startsWith('"')) { if (!v.endsWith('"') || v.length < 2) throw new Error(`YAML line ${n}: unterminated string`); return JSON.parse(v); }
    if (v.startsWith("'")) { if (!v.endsWith("'") || v.length < 2) throw new Error(`YAML line ${n}: unterminated string`); return v.slice(1, -1).replace(/''/g, "'"); }
    if (/^[[{]/.test(v)) throw new Error(`YAML line ${n}: flow collections are not supported by this checker`);
    if (v === 'true') return true; if (v === 'false') return false; if (v === 'null' || v === '~') return null;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  };
  let i = 0;
  const blockScalar = (style, parentInd) => {
    const startK = items[i - 1].k + 1; const out = []; let ind = null; let k = startK;
    for (; k < lines.length; k++) { const r = lines[k].raw; if (!r.trim()) { out.push(''); continue; }
      const li = r.match(/^ */)[0].length; if (li <= parentInd) break; if (ind === null) ind = li; out.push(r.slice(ind)); }
    while (i < items.length && items[i].k < k) i++;
    while (out.length && out[out.length - 1] === '') out.pop();
    return style === '|' ? out.join('\n') : out.join(' ').replace(/\s+/g, ' ').trim();
  };
  const splitKV = (t, n) => { const m = t.match(/^("[^"]*"|'[^']*'|[^:]+?):(\s+(.*))?$/); if (!m) throw new Error(`YAML line ${n}: expected "key: value", got "${t}"`); return [scalar(m[1], n), (m[3] ?? '').trim()]; };
  const value = (v, ind, n) => {
    if (v === '|' || v === '>' || v === '|-' || v === '>-') return blockScalar(v[0], ind);
    if (v !== '') return scalar(v, n);
    if (i < items.length && items[i].ind > ind) return node(items[i].ind);
    if (i < items.length && items[i].ind === ind && items[i].text.startsWith('- ')) return node(ind); // "key:" then same-indent list
    return null;
  };
  function node(ind) {
    const first = items[i];
    if (first.text === '-' || first.text.startsWith('- ')) {
      const arr = [];
      while (i < items.length && items[i].ind === ind && (items[i].text === '-' || items[i].text.startsWith('- '))) {
        const it = items[i]; const rest = it.text === '-' ? '' : it.text.slice(2).trim(); i++;
        if (rest === '') { arr.push(i < items.length && items[i].ind > ind ? node(items[i].ind) : null); continue; }
        if (/^("[^"]*"|'[^']*'|[^:'"]+?):(\s|$)/.test(rest)) { // inline map start: "- key: value"
          const childInd = ind + 2 + (it.text.slice(2).length - it.text.slice(2).trimStart().length);
          items.splice(i, 0, { ind: childInd, text: rest, n: it.n, k: it.k }); arr.push(node(childInd));
        } else arr.push(scalar(rest, it.n));
      }
      return arr;
    }
    const obj = {};
    while (i < items.length && items[i].ind === ind && !items[i].text.startsWith('- ')) {
      const it = items[i]; i++; const [key, v] = splitKV(it.text, it.n);
      if (Object.hasOwn(obj, key)) throw new Error(`YAML line ${it.n}: duplicate key "${key}"`);
      obj[key] = value(v, ind, it.n);
    }
    if (i < items.length && items[i].ind > ind) throw new Error(`YAML line ${items[i].n}: unexpected indentation`);
    return obj;
  }
  if (!items.length) return null;
  const doc = node(items[0].ind);
  if (i < items.length) throw new Error(`YAML line ${items[i].n}: could not parse (indentation?)`);
  return doc;
}

// ---------- Render glob matching ----------
export function renderGlobToRegExp(p) {
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  if (p.endsWith('/*') && !p.slice(0, -2).includes('*')) return new RegExp('^' + esc(p.slice(0, -1)) + '.*$'); // "/x/*" and "/*"
  let re = ''; for (let k = 0; k < p.length; k++) {
    if (p[k] === '*' && p[k + 1] === '*') { re += '.*'; k++; } else if (p[k] === '*') re += '[^/]*'; else re += esc(p[k]); }
  return new RegExp('^' + re + '$');
}
export const headerMatches = (rulePath, reqPath) => renderGlobToRegExp(rulePath).test(reqPath);

// ---------- config extraction ----------
export function loadRenderConfig(file) {
  const problems = [], warns = [];
  if (!existsSync(file)) return { problems: [`render.yaml not found at ${file}`], warns };
  let doc; try { doc = parseYaml(readFileSync(file, 'utf8')); } catch (e) { return { problems: [`render.yaml parse error: ${e.message}`], warns }; }
  const services = Array.isArray(doc?.services) ? doc.services : [];
  const statics = services.filter((s) => s && s.type === 'web' && (s.runtime === 'static' || s.env === 'static'));
  if (!statics.length) return { problems: ['render.yaml has no static site service (type: web, runtime: static)'], warns };
  if (statics.length > 1) warns.push(`${statics.length} static sites in render.yaml; checking the first ("${statics[0].name}")`);
  const site = statics[0];
  const headers = Array.isArray(site.headers) ? site.headers : [];
  const routes = Array.isArray(site.routes) ? site.routes : [];
  if (!headers.length) problems.push('render.yaml static site has no headers');
  headers.forEach((h, k) => { if (!h || typeof h.path !== 'string' || !h.path.startsWith('/') || typeof h.name !== 'string' || h.value == null) problems.push(`headers[${k}] needs path (starting with /), name and value`); });
  routes.forEach((r, k) => { if (!r || !['rewrite', 'redirect'].includes(r.type) || typeof r.source !== 'string' || typeof r.destination !== 'string') problems.push(`routes[${k}] needs type rewrite|redirect, source and destination`); });
  if (!site.staticPublishPath) problems.push('staticPublishPath missing (PM #62: apps/web/dist)');
  else if (normalize(String(site.staticPublishPath)).replace(/^\.\//, '').replace(/\/$/, '') !== 'apps/web/dist') warns.push(`staticPublishPath is "${site.staticPublishPath}", PM #62 says apps/web/dist`);
  if (!routes.some((r) => r?.type === 'rewrite' && r.source === '/*' && r.destination === '/index.html')) problems.push('SPA rewrite missing: routes needs {type: rewrite, source: /*, destination: /index.html} (PM #62)');
  if (!/--frozen-lockfile/.test(String(site.buildCommand ?? ''))) warns.push(`buildCommand lacks --frozen-lockfile (PM #62): "${site.buildCommand ?? ''}"`);
  return { site, headers: headers.filter(Boolean), routes: routes.filter(Boolean), problems, warns };
}

// ---------- local Render emulator ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain' };
export function resolveFile(dist, p) {
  const rel = p === '/' ? '/index.html' : p;
  const f = resolve(dist, '.' + rel);
  if (!f.startsWith(resolve(dist))) return null;
  if (existsSync(f) && statSync(f).isFile()) return f;
  if (existsSync(f) && statSync(f).isDirectory() && existsSync(join(f, 'index.html'))) return join(f, 'index.html');
  return null;
}
function routeDest(r, p) {
  const src = r.source;
  if (src.endsWith('*')) { const pre = src.slice(0, -1); if (!p.startsWith(pre)) return null; return r.destination.replace('*', p.slice(pre.length)); }
  if (src.includes(':')) { const names = []; const re = new RegExp('^' + src.replace(/:[A-Za-z_]\w*/g, (m) => { names.push(m.slice(1)); return '([^/]+)'; }) + '$'); const m = p.match(re); if (!m) return null;
    let d = r.destination; names.forEach((nm, k) => { d = d.replace(':' + nm, m[k + 1]); }); return d; }
  return src === p ? r.destination : null;
}
export function computeHeaders(headers, reqPath) {
  const out = {}, conflicts = [];
  for (const h of headers) if (headerMatches(h.path, reqPath)) {
    const k = h.name.toLowerCase(); const v = String(h.value);
    if (k in out && out[k].value !== v) conflicts.push(`${k}: "${out[k].value}" (${out[k].path}) vs "${v}" (${h.path})`);
    else out[k] = { value: v, path: h.path };
  }
  return { headers: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.value])), conflicts };
}
export function startServer(dist, cfg) {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); let file = resolveFile(dist, p), status = 200, hops = 0;
    while (!file && hops++ < 10) {
      const r = cfg.routes.find((rt) => routeDest(rt, p) !== null);
      if (!r) break; const d = routeDest(r, p);
      if (r.type === 'redirect') { const { headers } = computeHeaders(cfg.headers, p); res.writeHead(301, { ...headers, location: d }); return res.end(); }
      p = d; file = resolveFile(dist, p);
    }
    if (!file) status = 404;
    const reqPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const { headers, conflicts } = computeHeaders(cfg.headers, reqPath); // Render: header rules match the request path
    const h = { ...headers, 'x-qa-conflicts': JSON.stringify(conflicts), 'x-qa-served-file': file ? file.slice(resolve(dist).length) : '' };
    if (file) h['content-type'] = TYPES[extname(file)] ?? 'application/octet-stream';
    res.writeHead(status, h); res.end(file ? readFileSync(file) : 'Not Found');
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

// ---------- assertions ----------
const directives = (v) => (v ?? '').split(',').map((d) => d.trim().toLowerCase().replace(/\s*=\s*/, '=')).filter(Boolean);
const maxAge = (ds) => { const m = ds.find((d) => d.startsWith('max-age=')); return m ? Number(m.slice(8)) : null; };
export function findHashedAsset(dist) {
  const dir = join(dist, 'assets'); if (!existsSync(dir)) return null;
  const f = readdirSync(dir).filter((x) => /-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(x)).sort()[0];
  return f ? `/assets/${f}` : null;
}
export async function runCheck({ renderFile, dist, allowMissingSw = false }) {
  const results = []; const add = (level, msg) => results.push({ level, msg });
  const cfg = loadRenderConfig(renderFile);
  for (const w of cfg.warns) add('WARN', w);
  for (const p of cfg.problems) add('FAIL', p);
  if (!cfg.site || !cfg.headers?.length) return results;
  if (!existsSync(join(dist, 'index.html'))) { add('FAIL', `dist has no index.html: ${dist} (build first)`); return results; }
  const server = await startServer(dist, cfg); const base = `http://127.0.0.1:${server.address().port}`;
  const asset = findHashedAsset(dist);
  const hasSw = existsSync(join(dist, 'sw.js'));
  const probes = [
    { url: '/', cls: 'html', status: 200 }, { url: '/index.html', cls: 'html', status: 200 },
    asset ? { url: asset, cls: 'hashed', status: 200 } : null,
    hasSw ? { url: '/sw.js', cls: 'html', status: 200, label: 'sw' } : null,
    { url: '/qa/deep/route', cls: 'spa', status: 200 },
    { url: '/assets/qa-missing-0000000.js', cls: 'missing-asset' },
  ].filter(Boolean);
  if (!asset) add('FAIL', 'no hashed asset (assets/*-<hash>.js|css) found in dist');
  if (!hasSw) add(allowMissingSw ? 'SKIP' : 'FAIL', 'dist has no sw.js (service worker is an M8 deliverable)' + (allowMissingSw ? ', --allow-missing-sw' : ''));
  try {
    for (const pr of probes) {
      const r = await fetch(base + pr.url, { redirect: 'manual' }); const body = await r.text();
      const g = (k) => r.headers.get(k); const tag = `${pr.url}`;
      const conflicts = JSON.parse(g('x-qa-conflicts') || '[]');
      for (const c of conflicts) add('FAIL', `${tag}: conflicting rules for the same header (Render precedence undefined): ${c}`);
      if (pr.status && r.status !== pr.status) add('FAIL', `${tag}: status ${r.status}, expected ${pr.status}`);
      const isHtml = /<html/i.test(body);
      if (pr.cls === 'spa' && !isHtml) add('FAIL', `${tag}: SPA route did not serve index.html (PM #62 rewrite)`);
      const csp = g('content-security-policy');
      if (csp?.trim() === CSP_PM1) add('PASS', `${tag}: CSP equals PM #1`);
      else add('FAIL', `${tag}: CSP ${csp == null ? 'missing' : 'differs from PM #1'}\n      got:      ${csp}\n      expected: ${CSP_PM1}`);
      for (const [k, v] of Object.entries(SECURITY)) { const got = g(k); if (got?.trim().toLowerCase() === v) add('PASS', `${tag}: ${k}: ${v}`); else add('FAIL', `${tag}: ${k} is ${got == null ? 'missing' : `"${got}"`}, expected "${v}" (PM #62)`); }
      const cc = g('cache-control'); const ds = directives(cc); const ma = maxAge(ds);
      if (pr.cls === 'hashed') {
        const ok = ds.length === IMMUTABLE.length && IMMUTABLE.every((d) => ds.includes(d));
        add(ok ? 'PASS' : 'FAIL', `${tag}: Cache-Control "${cc}" ${ok ? 'matches' : 'must be'} "public, max-age=31536000, immutable" (PM #23)`);
      } else if (pr.cls === 'html') {
        const ok = ds.includes('no-cache') && !ds.includes('immutable') && !(ma > 0);
        add(ok ? 'PASS' : 'FAIL', `${tag}: Cache-Control "${cc}" ${ok ? 'is' : 'must be'} no-cache (PM #23${pr.label === 'sw' ? ', sw.js' : ''})`);
      } else if (pr.cls === 'spa') {
        if (ds.includes('immutable') || ma > 0) add('FAIL', `${tag}: SPA route (index.html content) gets Cache-Control "${cc}"; must not be cached long (PM #23)`);
        else if (!cc) add('WARN', `${tag}: SPA route has no Cache-Control (header rules match the request path, so no-cache for index.html doesn't apply)`);
        else add('PASS', `${tag}: SPA route Cache-Control "${cc}"`);
      } else if (pr.cls === 'missing-asset') {
        if (isHtml && ds.includes('immutable')) add('WARN', `${tag}: missing asset is rewritten to index.html AND gets "${cc}" (HTML cached immutable at an asset URL)`);
        else add('INFO', `${tag}: status ${r.status}, ${isHtml ? 'HTML' : 'non-HTML'} body, Cache-Control "${cc}"`);
      }
    }
  } finally { server.close(); }
  return results;
}

// ---------- CLI ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (!m) { console.error(`bad argument ${a}`); process.exit(2); } return [m[1], m[2] ?? true]; }));
  const renderFile = resolve(args.render ?? 'render.yaml'); const dist = resolve(args.dist ?? 'apps/web/dist');
  const results = await runCheck({ renderFile, dist, allowMissingSw: !!args['allow-missing-sw'] });
  const count = (l) => results.filter((r) => r.level === l).length;
  if (args.json) console.log(JSON.stringify({ renderFile, dist, results }, null, 2));
  else { console.log(`RENDER-01 render.yaml=${renderFile} dist=${dist}`); for (const r of results) console.log(`${r.level.padEnd(4)} ${r.msg}`); }
  console.log(`Summary: FAIL ${count('FAIL')} | WARN ${count('WARN')} | PASS ${count('PASS')} | SKIP ${count('SKIP')} -> ${count('FAIL') ? 'FAIL' : 'PASS'}`);
  process.exit(count('FAIL') ? 1 : 0);
}
