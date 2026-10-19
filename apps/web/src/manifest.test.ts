// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pub = (p: string) => new URL(`../public${p}`, import.meta.url);
const manifest = JSON.parse(readFileSync(pub('/manifest.webmanifest'), 'utf8')) as {
  name: string;
  short_name: string;
  icons: { src: string; purpose: string; sizes: string }[];
};

describe('web manifest', () => {
  it('uses the exact product name (SPEC Sec 11)', () => {
    expect(manifest.name).toBe('DaSignature');
    expect(manifest.short_name).toBe('DaSignature');
  });
  it('only references bundled, same-origin icons that exist', () => {
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/')).toBe(true);
      expect(existsSync(pub(icon.src)), icon.src).toBe(true);
    }
  });
  it('ships maskable 192 and 512 PWA icons (SPEC Sec 11)', () => {
    const maskable = manifest.icons.filter((i) => i.purpose === 'maskable').map((i) => i.sizes);
    expect(maskable).toEqual(['192x192', '512x512']);
  });
});
