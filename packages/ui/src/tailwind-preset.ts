/**
 * The Designer's Tailwind v3.4 preset, re-exported from the generated file
 * packages/ui/tokens/tailwind.preset.js (single source of truth; no copy to drift).
 * Node-only (used by tailwind.config.ts); import it via `@dasignature/ui/tailwind-preset`.
 */
import { createRequire } from 'node:module';
import type { Config } from 'tailwindcss';

const require = createRequire(import.meta.url);

export const dasignaturePreset = require('../tokens/tailwind.preset.js') as Omit<Config, 'content'>;

export default dasignaturePreset;
