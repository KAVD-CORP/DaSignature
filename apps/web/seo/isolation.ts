/**
 * Analytics isolation (decisions.md E-112): the app stays analytics-free. Fails the build when the
 * word "posthog" (any case) appears in any built file outside /guides/ (app bundle, workers,
 * sw.js, index.html, showcase.html, crawler files), or anywhere at all when no key is configured.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';
import { analyticsFromEnv } from './plugin.ts';
import { GUIDES } from './routes.ts';

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
}

/** Built files (relative, "/"-separated) that mention PostHog where they must not. */
export function analyticsLeaks(outDir: string, analyticsEnabled: boolean): string[] {
  const guides = GUIDES.slice(1) + '/';
  return walk(outDir)
    .map((f) => relative(outDir, f).split(sep).join('/'))
    .filter((f) => !(analyticsEnabled && f.startsWith(guides)))
    .filter((f) => /posthog/i.test(readFileSync(join(outDir, f), 'latin1')));
}

/** Runs after every other plugin (place it last), once sw.js has been written. */
export function analyticsIsolation(env: NodeJS.ProcessEnv = process.env): Plugin {
  let outDir = '';
  return {
    name: 'dasignature-analytics-isolation',
    apply: 'build',
    enforce: 'post',
    configResolved(c) {
      outDir = join(c.root, c.build.outDir);
    },
    closeBundle: {
      order: 'post',
      handler() {
        const leaks = analyticsLeaks(outDir, analyticsFromEnv(env) !== undefined);
        if (leaks.length)
          throw new Error(
            `Analytics isolation (E-112): "posthog" found outside ${GUIDES}/ or without a key in: ${leaks.join(', ')}`,
          );
      },
    },
  };
}
