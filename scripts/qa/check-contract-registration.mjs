#!/usr/bin/env node
// ADP-REG-01: SPEC Sec 6 "Adapter contract tests must run against every implementation."
// Finds every class that `implements StorageAdapter` (non-test sources) and requires a test file that both references
// the class name and calls runStorageContract(...). With --milestone=M2 the migration, encryption and .dasig contracts
// must also be registered somewhere. Self-contained (node >= 18, no deps). Exit 0 PASS, 1 FAIL, 2 usage.
// Usage: node check-contract-registration.mjs --root=<repo> [--milestone=M2] [--json]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : ['_bad', a]; }));
if (args._bad || !args.root) { console.error('usage: check-contract-registration.mjs --root=<repo> [--milestone=M2] [--json]'); process.exit(2); }
const root = path.resolve(String(args.root));
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.turbo', 'coverage', 'android', 'ios', 'gen']);
const files = [];
(function walk(d) { for (const e of readdirSync(d)) { if (SKIP.has(e)) continue; const p = path.join(d, e); const st = statSync(p); if (st.isDirectory()) walk(p); else if (/\.(c|m)?tsx?$/.test(e) && !e.endsWith('.d.ts')) files.push(p); } })(root);
const isTest = (p) => /(\.|\/)(test|spec)\.[cm]?tsx?$/.test(p) || /\/(test|tests|__tests__)\//.test(p);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const impls = [];
for (const f of files.filter((p) => !isTest(p))) {
  const src = strip(readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/class\s+([A-Za-z_$][\w$]*)(?:\s*<[^>{]*>)?(?:\s+extends\s+[\w$.<>, ]+)?\s+implements\s+([^{]+)\{/g))
    if (/\bStorageAdapter\b/.test(m[2])) impls.push({ name: m[1], file: path.relative(root, f) });
}
const tests = files.filter(isTest).map((f) => ({ file: path.relative(root, f), src: strip(readFileSync(f, 'utf8')) }));
// A call site, not the definition (`function runX(` in the copied contract files must not count as a registration).
const calls = (fn) => tests.filter((t) => new RegExp(`(?<!function\\s+)\\b${fn}\\s*\\(`).test(t.src));
const results = [];
const add = (status, id, msg) => results.push({ status, id, msg });
if (!impls.length) add('FAIL', 'REG-00', 'no class implementing StorageAdapter found (expected at least the web adapter)');
for (const c of impls) {
  const reg = calls('runStorageContract').filter((t) => new RegExp(`\\b${c.name}\\b`).test(t.src));
  add(reg.length ? 'PASS' : 'FAIL', 'REG-01', `${c.name} (${c.file}) ${reg.length ? `registered in ${reg.map((t) => t.file).join(', ')}` : 'is NOT registered with runStorageContract in any test file'}`);
}
if (args.milestone === 'M2') for (const fn of ['runMigrationContract', 'runEncryptionContract', 'runBackupContract']) {
  const r = calls(fn); add(r.length ? 'PASS' : 'FAIL', 'REG-02', `${fn} ${r.length ? `registered in ${r.map((t) => t.file).join(', ')}` : 'not registered in any test file (required at M2)'}`);
}
const fail = results.some((r) => r.status === 'FAIL');
if (args.json) console.log(JSON.stringify({ root, impls, results, verdict: fail ? 'FAIL' : 'PASS' }, null, 2));
else { for (const r of results) console.log(`${r.status.padEnd(4)} ${r.id} ${r.msg}`); console.log(`VERDICT: ${fail ? 'FAIL' : 'PASS'} (${impls.length} adapter class(es), ${tests.length} test file(s) scanned)`); }
process.exit(fail ? 1 : 0);
