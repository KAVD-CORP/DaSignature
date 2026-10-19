import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  brandTokens,
  colorTokens,
  contrastRatio,
  designerColorTokens,
  focusRing,
  inkTokens,
  fontSizes,
  motion,
  radii,
  selectionSizes,
  type ColorToken,
  type DesignerColorToken,
} from './tokens.ts';
import { dasignaturePreset } from './tailwind-preset.ts';

interface PresetShape {
  theme: {
    colors: Record<string, unknown>;
    fontSize: Record<string, unknown>;
    extend: { minHeight: Record<string, string>; minWidth: Record<string, string> };
  };
}
const preset = dasignaturePreset as unknown as PresetShape;

const css = readFileSync(new URL('../tokens/tokens.css', import.meta.url), 'utf8').toUpperCase();
const names = Object.keys(colorTokens) as ColorToken[];

/** SPEC Sec 8.2, typed in from the spec as an independent fixture (tokens.ts reads tokens.json). */
const SPEC_8_2: Record<ColorToken, [string, string]> = {
  bg: ['#FAFAF8', '#0E1126'],
  surface: ['#FFFFFF', '#161B3A'],
  'surface-2': ['#F1F1EE', '#1D2347'],
  text: ['#141A3C', '#F2F1EC'],
  'text-muted': ['#6B7090', '#A3A8C8'],
  border: ['#E4E4EC', '#2A3163'],
  primary: ['#141A3C', '#E8B04A'],
  'on-primary': ['#FFFFFF', '#141A3C'],
  accent: ['#E8B04A', '#E8B04A'],
  danger: ['#C23B3B', '#F07C7C'],
  success: ['#2E8B6A', '#5CCB9E'],
};

/** Body of the first rule whose selector list starts with `selector`. */
function block(selector: string): string {
  const start = css.indexOf(selector.toUpperCase());
  expect(start, `selector ${selector} present`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  return css.slice(open, css.indexOf('}', open));
}

const LIGHT = ':root,\n[data-theme="light"] {';
const DARK = '[data-theme="dark"] {';
const SYSTEM_DARK = ':root:not([data-theme="light"]):not([data-theme="dark"])';

describe('tokens (SPEC Sec 8.2)', () => {
  it('defines every SPEC 8.2 color token', () => {
    expect(names).toEqual([
      'bg',
      'surface',
      'surface-2',
      'text',
      'text-muted',
      'border',
      'primary',
      'on-primary',
      'accent',
      'danger',
      'success',
    ]);
  });

  it.each(names)('tokens.ts and tokens.css carry the exact spec value for --%s', (name) => {
    const { light, dark } = colorTokens[name];
    expect([light, dark]).toEqual(SPEC_8_2[name]);
    const decl = (v: string) => `--${name}: ${v};`.toUpperCase();
    expect(block(LIGHT)).toContain(decl(light));
    expect(block(DARK)).toContain(decl(dark));
    expect(block(SYSTEM_DARK)).toContain(decl(dark));
  });

  it('follows the system theme when no data-theme is set', () => {
    expect(css).toContain('@MEDIA (PREFERS-COLOR-SCHEME: DARK)');
  });

  it('turns motion off under prefers-reduced-motion', () => {
    expect(css).toMatch(/@MEDIA \(PREFERS-REDUCED-MOTION: REDUCE\)[^@]*--MOTION-FAST: 0MS/);
  });

  it('matches the spec type scale, radii and motion', () => {
    for (const [token, value] of [
      ['caption', fontSizes.xs],
      ['body-sm', fontSizes.sm],
      ['body', fontSizes.base],
      ['title', fontSizes.lg],
      ['headline', fontSizes.xl],
      ['display', fontSizes['2xl']],
    ] as const) {
      expect(css).toContain(`--FONT-SIZE-${token.toUpperCase()}: ${String(value / 16)}REM;`);
    }
    expect(css).toContain(`--RADIUS-INPUT: ${String(radii.input)}PX;`);
    expect(css).toContain(`--RADIUS-CARD: ${String(radii.card)}PX;`);
    expect(css).toContain(`--RADIUS-SHEET: ${String(radii.sheet)}PX;`);
    expect(css).toContain(`--MOTION-FAST: ${String(motion.fast)}MS;`);
    expect(css).toContain(`--MOTION-BASE: ${String(motion.base)}MS;`);
    expect(css).toContain(`--MOTION-EASING: ${motion.easing.toUpperCase()};`);
  });

  it('uses no gradients', () => {
    expect(css).not.toContain('GRADIENT(');
  });

  // PM decision #31: allowed text pairings. Restricted pairings are blocked by ESLint.
  it.each(['light', 'dark'] as const)('allowed text pairings are >= 4.5:1 in %s', (theme) => {
    const t = (n: ColorToken) => colorTokens[n][theme];
    for (const bg of ['bg', 'surface', 'surface-2'] as const) {
      expect(contrastRatio(t('text'), t(bg))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t('danger'), t(bg))).toBeGreaterThanOrEqual(4.5);
    }
    for (const bg of ['bg', 'surface'] as const) {
      expect(contrastRatio(t('text-muted'), t(bg))).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(t('on-primary'), t('primary'))).toBeGreaterThanOrEqual(4.5);
  });

  it('documents why the restricted light pairings are restricted', () => {
    const l = (n: ColorToken) => colorTokens[n].light;
    expect(contrastRatio(l('text-muted'), l('surface-2'))).toBeLessThan(4.5);
    expect(contrastRatio(l('success'), l('surface'))).toBeLessThan(4.5);
    expect(contrastRatio(l('accent'), l('bg'))).toBeLessThan(4.5);
  });

  it.each(Object.keys(designerColorTokens) as DesignerColorToken[])(
    'design tokens.css carries Designer token --%s in both themes',
    (name) => {
      const { light, dark } = designerColorTokens[name];
      expect(block(LIGHT)).toContain(`--${name}: ${light};`.toUpperCase());
      expect(block(DARK)).toContain(`--${name}: ${dark};`.toUpperCase());
      expect(block(SYSTEM_DARK)).toContain(`--${name}: ${dark};`.toUpperCase());
    },
  );

  it('carries the brand primitives', () => {
    for (const [name, hex] of Object.entries(brandTokens)) {
      expect(block(':root {')).toContain(`--${name}: ${hex};`.toUpperCase());
    }
  });

  it('keys hit targets on the primary pointer at any width: 44px default/coarse, 32px fine (PM #52)', () => {
    expect(block(':root {')).toContain('--SIZE-TARGET: 2.75REM;');
    expect(css).toMatch(/@MEDIA \(POINTER: COARSE\) \{\s*:ROOT \{ --SIZE-TARGET: 2.75REM; \}/);
    expect(css).toMatch(/@MEDIA \(POINTER: FINE\) \{\s*:ROOT \{ --SIZE-TARGET: 2REM; \}/);
    expect(css).not.toContain('ANY-POINTER');
    expect(css).not.toMatch(/@MEDIA[^{]*WIDTH[^{]*\{\s*:ROOT \{ --SIZE-TARGET/);
    expect(preset.theme.extend.minHeight.target).toBe('var(--size-target)');
    expect(preset.theme.extend.minWidth.target).toBe('var(--size-target)');
  });

  it('re-exports the generated tokens/tailwind.preset.js (no copy)', () => {
    const require = createRequire(import.meta.url);
    expect(dasignaturePreset).toBe(require('../tokens/tailwind.preset.js'));
  });

  it('pins --success-chip-bg (PM #47) and exposes ink.* colors (PM #44)', () => {
    expect(designerColorTokens['success-chip-bg']).toEqual({ light: '#DEECE7', dark: '#21374A' });
    expect(inkTokens).toEqual({
      black: '#1B1F2A',
      blue: '#1F3A8A',
      'deep-red': '#8B1E2B',
      graphite: '#4B4F58',
    });
    const inkColors = preset.theme.colors['ink'] as Record<string, string>;
    for (const [k, hex] of Object.entries(inkTokens)) {
      expect(block(':root {')).toContain(`--ink-${k}: ${hex};`.toUpperCase());
      expect(inkColors[k]).toBe(`var(--ink-${k})`);
      expect(contrastRatio(hex, '#FFFFFF')).toBeGreaterThanOrEqual(7);
    }
    expect(css).not.toContain('COLOR-MIX(');
  });

  it('maps Tailwind colors to the CSS variables, keeping spec names', () => {
    for (const name of names) expect(preset.theme.colors[name]).toBe(`var(--${name})`);
    for (const k of ['xs', 'sm', 'base', 'lg', 'xl', '2xl'] as const) {
      expect(preset.theme.fontSize[k]).toBeDefined();
    }
  });
  it('defines the selection treatment and focus ring (PM #33)', () => {
    const root = block(':root {');
    expect(root).toContain(`--SIZE-SELECTION-WIDTH: ${String(selectionSizes.outline)}PX;`);
    expect(root).toContain(`--SIZE-SELECTION-HALO-WIDTH: ${String(selectionSizes.halo)}PX;`);
    expect(root).toContain(`--SIZE-HANDLE: ${String(selectionSizes.handle)}PX;`);
    expect(root).toContain(`--SIZE-HANDLE-STROKE: ${String(selectionSizes.handleStroke)}PX;`);
    expect(root).toContain(`--SIZE-FOCUS-RING-WIDTH: ${String(focusRing.width)}PX;`);
    expect(css).toMatch(
      /\.DS-SELECTION \{[^}]*OUTLINE: VAR\(--SIZE-SELECTION-WIDTH\) SOLID VAR\(--SELECTION\)/,
    );
    expect(css).toMatch(
      /\.DS-SELECTION \{[^}]*INSET 0 0 0 VAR\(--SIZE-SELECTION-HALO-WIDTH\) VAR\(--SELECTION-HALO\)/,
    );
    expect(css).toMatch(
      /\.DS-SELECTION-HANDLE \{[^}]*BACKGROUND: VAR\(--PDF-PAGE\)[^}]*VAR\(--PDF-INK\)/,
    );
    expect(designerColorTokens['focus-ring']).toEqual({
      light: 'var(--primary)',
      dark: 'var(--accent)',
    });
    const ext = preset.theme.extend as unknown as Record<string, Record<string, string>>;
    expect(ext['outlineColor']?.['selection']).toBe('var(--selection)');
    expect(ext['outlineWidth']?.['selection']).toBe('var(--size-selection-width)');
  });
});
