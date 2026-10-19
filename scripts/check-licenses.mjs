// License allowlist check (PM decision #21). Fails on any installed npm package whose license
// is not on the allowlist. Shipped (production) dependencies must be strictly on the allowlist;
// dev-only packages may additionally use an entry from DEV_EXCEPTIONS (each needs PM approval
// and a line in docs/decisions.md). Reads package.json files from node_modules/.pnpm, no network.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ALLOWLIST = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'MPL-2.0',
  'OFL-1.1',
  'Unlicense',
  'CC0-1.0',
  'Zlib',
  'BlueOak-1.0.0',
]);

/** Dev-only exceptions: license -> reason. PENDING PM APPROVAL (decisions.md E-2). */
export const DEV_EXCEPTIONS = new Map([
  ['MIT-0', 'MIT without the attribution clause (strictly more permissive than MIT).'],
  ['CC-BY-4.0', 'caniuse-lite browser data used by autoprefixer at build time; not shipped.'],
]);

/** SPDX expression check: OR needs one allowed operand, AND needs all. */
export function allowed(expr, set) {
  const e = expr.replace(/[()]/g, '').trim();
  if (/\sOR\s/.test(e)) return e.split(/\s+OR\s+/).some((x) => allowed(x, set));
  if (/\sAND\s/.test(e)) return e.split(/\s+AND\s+/).every((x) => allowed(x, set));
  return set.has(e);
}

const licenseOf = (j) => {
  if (typeof j.license === 'string') return j.license;
  if (j.license?.type) return j.license.type;
  if (Array.isArray(j.licenses)) return j.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
};

function installed() {
  const root = 'node_modules/.pnpm';
  const pkgs = new Map();
  for (const d of readdirSync(root)) {
    const nm = join(root, d, 'node_modules');
    if (!existsSync(nm)) continue;
    for (const e of readdirSync(nm)) {
      const names = e.startsWith('@') ? readdirSync(join(nm, e)).map((x) => `${e}/${x}`) : [e];
      for (const name of names) {
        const pj = join(nm, name, 'package.json');
        if (!existsSync(pj)) continue;
        let j;
        try {
          j = JSON.parse(readFileSync(pj, 'utf8'));
        } catch {
          continue;
        }
        if (j.name && j.version) pkgs.set(`${j.name}@${j.version}`, licenseOf(j));
      }
    }
  }
  return pkgs;
}

function productionSet() {
  const out = execFileSync('pnpm', ['list', '-r', '--prod', '--json', '--depth', 'Infinity'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const ids = new Set();
  const walk = (deps) => {
    for (const [name, info] of Object.entries(deps ?? {})) {
      if (info.version?.startsWith('link:')) continue;
      const id = `${name}@${info.version}`;
      if (ids.has(id)) continue;
      ids.add(id);
      walk(info.dependencies);
    }
  };
  for (const project of JSON.parse(out)) walk(project.dependencies);
  return ids;
}

const pkgs = installed();
const prod = productionSet();
const devAllowed = new Set([...ALLOWLIST, ...DEV_EXCEPTIONS.keys()]);
const failures = [];
const exceptions = [];
const counts = {};
for (const [id, lic] of pkgs) {
  counts[lic] = (counts[lic] ?? 0) + 1;
  if (allowed(lic, ALLOWLIST)) continue;
  if (!prod.has(id) && allowed(lic, devAllowed)) exceptions.push(`${id} (${lic}, dev-only)`);
  else failures.push(`${id}: ${lic}${prod.has(id) ? ' [SHIPPED]' : ''}`);
}
console.log(`Checked ${String(pkgs.size)} packages (${String(prod.size)} production).`);
console.log(
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  ${k}: ${String(v)}`)
    .join('\n'),
);
if (exceptions.length)
  console.log(`Dev-only exceptions (PM approval pending):\n  ${exceptions.join('\n  ')}`);
if (failures.length) {
  console.error(`FAIL: licenses not on the allowlist (PM #21):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('OK: all licenses allowed.');
