// The web app's "initial JS" (SPEC Sec 1 budget): every .js file that dist/index.html loads up front,
// i.e. the module entry <script src> plus every <link rel="modulepreload">, whatever the chunk is named.
// Shared by .size-limit.mjs and scripts/check-size.mjs so both gates measure the same set (QA-M1-03).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Paths (relative to `dist`) of the initial JS chunks referenced by `dist/index.html`. */
export function initialChunksFromHtml(html) {
  const files = [
    ...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="\/?([^"]+\.m?js)"[^>]*>/g),
  ].map((m) => m[1]);
  return [...new Set(files)];
}

export function initialChunks(dist) {
  return initialChunksFromHtml(readFileSync(join(dist, 'index.html'), 'utf8'));
}
