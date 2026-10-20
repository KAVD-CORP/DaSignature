import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { textToVector } from './glyphs.ts';

const req = createRequire(import.meta.url);
const caveat = new Uint8Array(
  readFileSync(req.resolve('@fontsource/caveat/files/caveat-latin-400-normal.woff2')),
);

describe('typed signature outlines', () => {
  it('turns text into one cropped vector path', () => {
    const v = textToVector(caveat, 'Jane Doe');
    expect(v).not.toBeNull();
    if (!v) return;
    expect(v.d).toMatch(/^M[\d.]+,[\d.]+/);
    expect(v.d).not.toMatch(/-\d/); // cropped: no negative coordinates
    expect(v.width).toBeGreaterThan(150);
    expect(v.height).toBeGreaterThan(40);
    expect(textToVector(caveat, ' ')).toBeNull();
  });
});
