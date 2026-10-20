#!/usr/bin/env node
// DaSignature offline web server: zero dependencies, binds 127.0.0.1 only and makes no
// outbound network calls. Serves ./dist with the same headers as render.yaml (CSP, nosniff,
// no-referrer, caching) and the SPA fallback. Usage: node server.mjs [port] [--open]
// (default port 4173; the next free port is used if it is taken; --open opens the browser).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const HOST = '127.0.0.1';
const args = process.argv.slice(2);
const OPEN = args.includes('--open');
const START_PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? process.env.PORT ?? 4173);
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data:; img-src 'self' blob: data:; font-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pfb': 'application/octet-stream',
  '.bcmap': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

async function file(path) {
  try {
    const s = await stat(path);
    return s.isFile() ? path : null;
  } catch {
    return null;
  }
}

async function handle(req, res) {
  const base = {
    'Content-Security-Policy': CSP,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(self)',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...base, Allow: 'GET, HEAD' }).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400, base).end();
    return;
  }
  const rel = normalize(pathname).replace(/^([/\\])+/, '');
  const target = join(ROOT, rel);
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    res.writeHead(403, base).end();
    return;
  }
  let found = rel === '' ? null : await file(target);
  if (!found && pathname.startsWith('/assets/')) found = join(ROOT, 'missing-asset.txt');
  if (!found) found = join(ROOT, 'index.html');
  const immutable = pathname.startsWith('/assets/') && !found.endsWith('missing-asset.txt');
  const body = await readFile(found);
  res.writeHead(200, {
    ...base,
    'Content-Type': TYPES[extname(found).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function openBrowser(url) {
  const [cmd, argv] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, argv, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => console.log(`Open ${url} in your browser.`));
    child.unref();
  } catch {
    console.log(`Open ${url} in your browser.`);
  }
}

function listen(port, triesLeft) {
  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) listen(port + 1, triesLeft - 1);
    else {
      console.error(`DaSignature: could not start the server (${err.message}).`);
      process.exit(1);
    }
  });
  server.listen(port, HOST, () => {
    console.log(`DaSignature is running at http://${HOST}:${port}/`);
    console.log('Everything stays on this computer. Press Ctrl+C to stop.');
    if (OPEN) openBrowser(`http://${HOST}:${port}/`);
  });
}

listen(START_PORT, 10);
