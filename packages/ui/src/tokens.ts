/**
 * Typed access to the design tokens. Source of truth: packages/ui/tokens/tokens.json (the Designer's
 * file; tokens.css, theme.css and tailwind.preset.js are generated from it by tokens/build.py).
 * Nothing here repeats a token value: every value is read from tokens.json, so the code can't drift
 * from the CSS. check_contrast.py verifies tokens.json against SPEC Sec 8.2; the unit tests check
 * that tokens.css carries these values and that the spec values are exact.
 */
import tokensJson from '../tokens/tokens.json' with { type: 'json' };

type Theme = 'light' | 'dark';
export type ResolvedTheme = Theme;
interface JsonToken {
  $value: unknown;
  $extensions?: { 'app.dasignature'?: { dark?: unknown } };
}
type Group = Record<string, JsonToken | string>;
const json = tokensJson as unknown as Record<string, Group | undefined>;

function group(name: string): Record<string, JsonToken> {
  const g = json[name] ?? {};
  return Object.fromEntries(
    Object.entries(g).filter((e): e is [string, JsonToken] => !e[0].startsWith('$')),
  );
}
function token(groupName: string, key: string): JsonToken {
  const t = group(groupName)[key];
  if (!t) throw new Error(`tokens.json has no ${groupName}.${key}`);
  return t;
}
/** CSS form of a token value: `{color.text}` aliases become `var(--text)`. */
function cssValue(value: unknown): string {
  const s = String(value);
  const alias = /^\{color\.([\w-]+)\}$/.exec(s);
  return alias?.[1] ? `var(--${alias[1]})` : s;
}
function themed(t: JsonToken): Record<Theme, string> {
  const light = cssValue(t.$value);
  const dark = t.$extensions?.['app.dasignature']?.dark;
  return { light, dark: dark === undefined ? light : cssValue(dark) };
}
function px(groupName: string, key: string): number {
  return parseFloat(String(token(groupName, key).$value));
}
function pick<K extends string, V>(keys: readonly K[], f: (k: K) => V): Record<K, V> {
  return Object.fromEntries(keys.map((k) => [k, f(k)])) as Record<K, V>;
}

/** The 11 SPEC Sec 8.2 color tokens (exact owner values, PM #31). */
export const SPEC_COLOR_TOKENS = [
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
] as const;
export type ColorToken = (typeof SPEC_COLOR_TOKENS)[number];
export const colorTokens = /*#__PURE__*/ pick(SPEC_COLOR_TOKENS, (k) => themed(token('color', k)));

/** Designer-added color tokens (usage rules: tokens/README.md, PM #31-#33, #47). */
export const DESIGNER_COLOR_TOKENS = [
  'on-accent',
  'on-danger',
  'border-strong',
  'focus-ring',
  'success-chip-bg',
  'selection',
  'selection-halo',
  'pdf-page',
  'pdf-ink',
  'canvas',
  'scrim',
] as const;
export type DesignerColorToken = (typeof DESIGNER_COLOR_TOKENS)[number];
export const designerColorTokens = /*#__PURE__*/ pick(DESIGNER_COLOR_TOKENS, (k) =>
  themed(token('color', k)),
);

/** Brand primitives (SPEC Sec 11): logo and lockup only. Same in both themes. */
export const BRAND_TOKENS = ['brand-navy', 'brand-feather', 'brand-gold'] as const;
export const brandTokens = /*#__PURE__*/ pick(BRAND_TOKENS, (k) =>
  cssValue(token('primitive', k.replace('brand-', '')).$value),
);

/**
 * Signature ink colors (SPEC 7.2, PM #44): theme-independent content colors for strokes and typed
 * signatures on the white PDF page, each >= 7:1 on white. Never UI chrome. Tailwind: `ink-*`.
 */
export const INK_TOKENS = ['black', 'blue', 'deep-red', 'graphite'] as const;
export type InkToken = (typeof INK_TOKENS)[number];
export const inkTokens = /*#__PURE__*/ pick(INK_TOKENS, (k) => cssValue(token('ink', k).$value));
export const DEFAULT_INK: InkToken = 'black';

const REM = 16;
/** Hit-target sizes in px (PM #16, #52): --size-target is 44 (default, coarse pointer) or 32 (fine pointer), at any width. */
export const targetSizes = /*#__PURE__*/ (() => ({
  touch: px('size', 'touch') * REM,
  fine: px('size', 'target-fine') * REM,
}))();

/** Type scale in px (SPEC Sec 8.2), keyed by Tailwind name. */
const TYPE_SCALE = {
  xs: 'caption',
  sm: 'body-sm',
  base: 'body',
  lg: 'title',
  xl: 'headline',
  '2xl': 'display',
} as const;
export const fontSizes = /*#__PURE__*/ pick(
  Object.keys(TYPE_SCALE) as (keyof typeof TYPE_SCALE)[],
  (k) => {
    const v = token('typography', TYPE_SCALE[k]).$value as { fontSize: string };
    return parseFloat(v.fontSize) * REM;
  },
);

/** Font weights (SPEC Sec 8.2). */
export const fontWeights = /*#__PURE__*/ (() => {
  const weights = (json['font'] as unknown as { weight: Record<string, JsonToken> }).weight;
  return {
    normal: Number(weights['regular']?.$value),
    medium: Number(weights['medium']?.$value),
    semibold: Number(weights['semibold']?.$value),
  };
})();

/** Radii in px (SPEC Sec 8.2): inputs, cards, sheets, pills. */
export const radii = /*#__PURE__*/ pick(['input', 'card', 'sheet', 'pill'] as const, (k) =>
  px('radius', k),
);

/** Motion (SPEC Sec 8.2: 150-200 ms ease-out). */
export const motion = /*#__PURE__*/ (() => {
  const m = json['motion'] as unknown as {
    duration: Record<string, JsonToken>;
    easing: Record<string, JsonToken>;
  };
  const easeOut = (m.easing['out']?.$value ?? []) as number[];
  return {
    fast: parseFloat(String(m.duration['fast']?.$value)),
    base: parseFloat(String(m.duration['base']?.$value)),
    easing: `cubic-bezier(${easeOut.join(', ')})`,
  };
})();

/** Spacing grid base in px (SPEC Sec 8.2: 4 pt grid). */
export const GRID = 4;

/**
 * Selection on the PDF page (SPEC Sec 7.4, PM #33), px. Rendered with the Designer classes
 * .ds-selection (2px gold outline + 1px white inset halo) and .ds-selection-handle (12px square,
 * white fill, 1.5px pdf-ink stroke). Handles are DOM elements, never drawn in a canvas.
 */
export const selectionSizes = /*#__PURE__*/ (() => ({
  outline: px('size', 'selection-width'),
  halo: px('size', 'selection-halo-width'),
  handle: px('size', 'handle'),
  handleStroke: px('size', 'handle-stroke'),
}))();

/** Focus ring (PM #33): navy (--primary) in light, gold (--accent) in dark. */
export const focusRing = /*#__PURE__*/ (() => ({
  width: px('size', 'focus-ring-width'),
  offset: px('size', 'focus-ring-offset'),
}))();

/** Relative luminance per WCAG 2.x. */
export function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
