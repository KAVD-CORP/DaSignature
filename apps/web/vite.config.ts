import react from '@vitejs/plugin-react';
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

export default defineConfig({
  plugins: [react(), securityHeaders()],
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
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
