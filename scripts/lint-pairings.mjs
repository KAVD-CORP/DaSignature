#!/usr/bin/env node
// DaSignature color-pairing lint (PM decision #31). No dependencies. Runs in `pnpm lint`.
// Based on the Designer's design/tokens/lint-pairings.mjs, extended by the Engineer to:
//  - scan every string literal in .ts/.tsx/.js/.jsx (so className={cond ? '...' : '...'} and
//    template literals are covered, not only className="..."),
//  - check plain CSS declarations (`color: var(--accent)` etc.) per rule block,
//  - export lintSource() so packages/ui/src/lint-pairings.test.ts can prove each rule fires.
// Usage: node scripts/lint-pairings.mjs <dir|file> [...]   e.g. apps/web/src packages/ui/src
// Exit 1 on any violation. Classes behind a `dark:` variant are ignored (dark theme is unrestricted).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RULES = [
  {
    id: 'accent-text',
    test: (c) => c.has('text-accent'),
    msg: 'text-accent: accent is never text on light surfaces (PM #31 rule 1). Use text-text / text-primary; gold only for fills, borders, icons.',
  },
  {
    id: 'success-text',
    test: (c) => c.has('text-success'),
    msg: 'text-success: success is never text in light (PM #31 rule 3). Use an icon (fill/stroke-success) or bg-success-chip-bg + text-text.',
  },
  {
    id: 'muted-on-surface-2',
    test: (c) => c.has('text-text-muted') && (c.has('bg-surface-2') || c.has('bg-canvas')),
    msg: 'text-text-muted on bg-surface-2/bg-canvas: 4.27:1 in light (PM #31 rule 2). Use text-text.',
  },
  {
    id: 'label-on-accent',
    test: (c) =>
      c.has('bg-accent') && [...c].some((x) => /^text-(on-primary|text|surface|bg)$/.test(x)),
    msg: 'Label on bg-accent must be text-on-accent.',
  },
  {
    id: 'label-on-danger',
    test: (c) =>
      c.has('bg-danger') &&
      [...c].some(
        (x) =>
          /^text-/.test(x) &&
          !/^text-(on-danger|xs|sm|base|lg|xl|2xl|caption|body|body-sm|title|headline|display|left|right|center|start|end)$/.test(
            x,
          ),
      ),
    msg: 'Label on bg-danger must be text-on-danger.',
  },
  {
    id: 'solid-success',
    test: (c) => c.has('bg-success'),
    msg: 'bg-success as a label background fails 4.5:1 in light. Use bg-success-chip-bg + text-text.',
  },
  {
    id: 'text-opacity',
    test: (c) => [...c].some((x) => /^text-[a-z0-9-]+\/\d+$/.test(x)),
    msg: 'Opacity modifier on a text color lowers contrast below the verified ratios.',
  },
  {
    id: 'raw-color',
    test: (c) => [...c].some((x) => /\[(#|rgb|hsl)/.test(x)),
    msg: 'Arbitrary color value; use tokens.',
  },
];

// Plain-CSS equivalents, checked per declaration block.
export const CSS_RULES = [
  {
    id: 'accent-text',
    test: (b) => /(^|[;{\s])color\s*:\s*var\(--accent\)/.test(b),
    msg: 'color: var(--accent): accent is never text on light surfaces (PM #31 rule 1).',
  },
  {
    id: 'success-text',
    test: (b) => /(^|[;{\s])color\s*:\s*var\(--success\)/.test(b),
    msg: 'color: var(--success): success is never text in light (PM #31 rule 3).',
  },
  {
    id: 'muted-on-surface-2',
    test: (b) =>
      /(^|[;{\s])color\s*:\s*var\(--text-muted\)/.test(b) &&
      /background(-color)?\s*:\s*var\(--(surface-2|canvas)\)/.test(b),
    msg: 'color: var(--text-muted) on var(--surface-2)/var(--canvas) fails 4.5:1 in light (PM #31 rule 2).',
  },
];

const SCRIPT_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mdx']);
const EXTS = new Set([...SCRIPT_EXTS, '.css', '.html']);
const CLASS_PATTERNS = [
  /class(?:Name)?\s*=\s*["'`]([^"'`]+)["'`]/g,
  /@apply\s+([^;]+);/g,
  /(?:cn|clsx|cva|twMerge)\(([^)]*)\)/g,
];
const STRING_LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

const toClasses = (s) =>
  new Set(
    s
      .replace(/["'`,{}]/g, ' ')
      .split(/\s+/)
      .filter((x) => x && !x.startsWith('dark:'))
      .map((x) => x.replace(/^(?:[a-z0-9-]+:)+/, '')),
  );

/** Lint one file's source. Returns [{ line, id, msg }]. */
export function lintSource(src, ext) {
  const found = [];
  const seen = new Set();
  const report = (index, rule) => {
    const line = src.slice(0, index).split('\n').length;
    const key = `${line}:${rule.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ line, id: rule.id, msg: rule.msg });
  };
  const patterns = SCRIPT_EXTS.has(ext) ? [...CLASS_PATTERNS, STRING_LITERAL] : CLASS_PATTERNS;
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const text = re === STRING_LITERAL ? m[2] : m[1];
      const classes = toClasses(text);
      for (const r of RULES) if (r.test(classes)) report(m.index, r);
    }
  }
  if (ext === '.css') {
    for (const m of src.matchAll(/\{([^{}]*)\}/g)) {
      for (const r of CSS_RULES) if (r.test(m[1])) report(m.index, r);
    }
  }
  return found;
}

function main(args) {
  const files = [];
  const walk = (p) => {
    const s = statSync(p);
    if (s.isDirectory()) {
      for (const f of readdirSync(p))
        if (f !== 'node_modules' && !f.startsWith('.')) walk(join(p, f));
    } else if (EXTS.has(extname(p)) && !/\.test\.[a-z]+$/.test(p)) files.push(p);
  };
  for (const a of args) walk(a);
  let n = 0;
  for (const f of files) {
    for (const v of lintSource(readFileSync(f, 'utf8'), extname(f))) {
      n++;
      console.log(`${f}:${v.line}  [${v.id}] ${v.msg}`);
    }
  }
  console.log(
    n ? `\n${n} pairing violation(s)` : `pairing lint: ${files.length} files, 0 violations`,
  );
  process.exit(n ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
