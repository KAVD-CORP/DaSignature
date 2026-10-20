// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { swSource } from '../pwa.ts';

const manifest = JSON.parse(
  readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'),
) as {
  share_target: { action: string; method: string; params: { files: { name: string }[] } };
  file_handlers: { accept: Record<string, string[]> }[];
};

describe('PWA (M8)', () => {
  it('generates a versioned, same-origin precache worker with no remote URLs', () => {
    const src = swSource('abc123', ['index.html', 'assets/a-1234abcd.js']);
    expect(src).toContain("'dasig-' + VERSION");
    expect(src).toContain('"/assets/a-1234abcd.js"');
    expect(src).not.toMatch(/https?:\/\//);
  });
  it('declares a PDF share target and file handler that the worker serves', () => {
    expect(manifest.share_target.method).toBe('POST');
    expect(swSource('v', [])).toContain(`'${manifest.share_target.action}'`);
    expect(swSource('v', [])).toContain(
      `getAll('${manifest.share_target.params.files[0]?.name ?? ''}')`,
    );
    expect(manifest.file_handlers[0]?.accept['application/pdf']).toEqual(['.pdf']);
  });
});
