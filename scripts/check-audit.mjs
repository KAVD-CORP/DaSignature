// pnpm audit gate (PM #21) with documented, expiring ignores (PM #54).
// 1. Every auditConfig.ignoreGhsas id in pnpm-workspace.yaml must be documented in
//    audit-exceptions.json (reason, approval, expiry milestone).
// 2. Fails once package.json config.milestone >= expiresAt; warns one milestone before.
// 3. Runs `pnpm audit --audit-level high` (fails on any un-ignored high/critical advisory).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');
const milestoneNumber = (m) => {
  const n = /^M(\d+)$/.exec(String(m));
  if (!n) throw new Error(`invalid milestone "${String(m)}" (expected M<number>)`);
  return Number(n[1]);
};

export function checkExceptions(ignored, exceptions, milestone) {
  const now = milestoneNumber(milestone);
  const errors = [];
  const warnings = [];
  for (const id of ignored) {
    const e = exceptions.find((x) => x.id === id);
    if (!e) {
      errors.push(
        `${id}: ignored in pnpm-workspace.yaml but not documented in audit-exceptions.json`,
      );
      continue;
    }
    for (const k of ['reason', 'approved', 'expiresAt']) {
      if (!e[k]) errors.push(`${id}: missing "${k}" in audit-exceptions.json`);
    }
    if (!e.expiresAt) continue;
    const exp = milestoneNumber(e.expiresAt);
    if (now >= exp)
      errors.push(
        `${id}: audit exception EXPIRED at ${e.expiresAt} (now ${milestone}). ${e.action ?? ''}`,
      );
    else if (now === exp - 1)
      warnings.push(
        `${id}: audit exception expires at ${e.expiresAt} (next milestone). ${e.action ?? ''}`,
      );
    else console.log(`ok   ${id} ignored until ${e.expiresAt} (${e.approved}; now ${milestone})`);
  }
  for (const e of exceptions) {
    if (!ignored.includes(e.id))
      warnings.push(
        `${e.id}: documented but no longer ignored; remove it from audit-exceptions.json`,
      );
  }
  return { errors, warnings };
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const ws = read('pnpm-workspace.yaml');
  const block = /ignoreGhsas:\s*\n((?:\s+(?:#.*|-\s*\S+)\n?)*)/.exec(ws)?.[1] ?? '';
  const ignored = [...block.matchAll(/-\s*(GHSA-[\w-]+)/g)].map((m) => m[1]);
  const { exceptions } = JSON.parse(read('audit-exceptions.json'));
  const { milestone } = JSON.parse(read('package.json')).config ?? {};
  const { errors, warnings } = checkExceptions(ignored, exceptions, milestone);
  for (const w of warnings) console.warn(`WARN ${w}`);
  for (const e of errors) console.error(`FAIL ${e}`);
  if (errors.length) process.exit(1);
  execFileSync('pnpm', ['audit', '--audit-level', 'high'], { cwd: root, stdio: 'inherit' });
}
