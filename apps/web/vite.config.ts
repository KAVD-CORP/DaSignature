import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { CSP_META, headersFile } from './csp.ts';

/**
 * Build-only: inject the Content-Security-Policy <meta> tag and emit the `_headers` file.
 * Not applied to the dev server, whose React Fast Refresh preamble is an inline script.
 */
function securityHeaders(): Plugin {
  return {
    name: 'dasignature-security-headers',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP_META },
        injectTo: 'head-prepend',
      },
    ],
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile() });
    },
  };
}

/**
 * pdf.js data files (cmaps, standard fonts, wasm decoders, ICC profiles) served same-origin under
 * /pdfjs/ so pdf.js never fetches from a CDN (SPEC Sec 1.1: all fonts, workers and WASM bundled).
 */
const PDFJS_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
function pdfjsAssets(): Plugin {
  const req = createRequire(join(process.cwd(), '../../packages/pdf/package.json'));
  const root = dirname(req.resolve('pdfjs-dist/package.json'));
  const files = PDFJS_DIRS.flatMap((d) =>
    readdirSync(join(root, d))
      .filter((f) => statSync(join(root, d, f)).isFile())
      .map((f) => `${d}/${f}`),
  );
  return {
    name: 'dasignature-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs/', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\//, '');
        if (!files.includes(rel)) {
          next();
          return;
        }
        res.setHeader(
          'Content-Type',
          rel.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
        );
        res.end(readFileSync(join(root, rel)));
      });
    },
    generateBundle() {
      for (const f of files)
        this.emitFile({
          type: 'asset',
          fileName: `pdfjs/${f}`,
          source: readFileSync(join(root, f)),
        });
    },
  };
}

export default defineConfig({
  plugins: [react(), securityHeaders(), pdfjsAssets()],
  build: {
    target: 'es2022',
    // Never inline assets as data: URIs; every asset is a same-origin hashed file.
    assetsInlineLimit: 0,
    sourcemap: false,
    rollupOptions: {
      // showcase.html: token/contrast review page for QA and Designer (not a product screen).
      input: { main: 'index.html', showcase: 'showcase.html' },
    },
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
