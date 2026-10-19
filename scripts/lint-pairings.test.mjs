// Proves each banned PM #31 pairing is caught (kept outside apps/ and packages/ so the
// fixtures below never trip QA's static scans of app source).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lintSource } from './lint-pairings.mjs';

const ids = (src, ext = '.tsx') => lintSource(src, ext).map((v) => v.id);

describe('pairing lint (PM decision #31)', () => {
  describe('bans --accent as text', () => {
    it('in className', () => {
      expect(ids('<a className="text-accent underline">x</a>')).toContain('accent-text');
    });
    it('behind a state variant and inside a ternary', () => {
      expect(ids("const c = active ? 'hover:text-accent' : 'text-text';")).toContain('accent-text');
    });
    it('in plain CSS', () => {
      expect(ids('.link { color: var(--accent); }', '.css')).toContain('accent-text');
    });
    it('in @apply', () => {
      expect(ids('.link { @apply text-accent; }', '.css')).toContain('accent-text');
    });
  });

  describe('bans --text-muted on --surface-2', () => {
    it('in className', () => {
      expect(ids('<p className="bg-surface-2 text-text-muted">x</p>')).toContain(
        'muted-on-surface-2',
      );
    });
    it('in a template literal', () => {
      expect(ids('const c = `p-2 ${x} text-text-muted bg-surface-2`;')).toContain(
        'muted-on-surface-2',
      );
    });
    it('in plain CSS', () => {
      expect(
        ids('.cell { background: var(--surface-2); color: var(--text-muted); }', '.css'),
      ).toContain('muted-on-surface-2');
    });
  });

  describe('bans --success as text', () => {
    it('in className', () => {
      expect(ids('<span className="text-success">Signed</span>')).toContain('success-text');
    });
    it('in clsx()', () => {
      expect(ids("clsx('font-medium', 'text-success')")).toContain('success-text');
    });
    it('in plain CSS', () => {
      expect(ids('.ok { color: var(--success); }', '.css')).toContain('success-text');
    });
  });

  it('allows the sanctioned alternatives', () => {
    expect(ids('<p className="bg-surface text-text-muted">x</p>')).toEqual([]);
    expect(ids('<p className="bg-surface-2 text-text">x</p>')).toEqual([]);
    expect(ids('<span className="bg-success-chip-bg text-text">Signed</span>')).toEqual([]);
    expect(ids('<button className="bg-accent text-on-accent">Go</button>')).toEqual([]);
    expect(ids('<i className="dark:text-accent" />')).toEqual([]);
    expect(ids('.ring { outline-color: var(--accent); }', '.css')).toEqual([]);
  });

  it('the CLI exits 1 on a violation and 0 on clean files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pairings-'));
    const cli = new URL('./lint-pairings.mjs', import.meta.url).pathname;
    try {
      writeFileSync(join(dir, 'ok.tsx'), 'export const a = <p className="text-text" />;');
      expect(() => execFileSync('node', [cli, dir], { stdio: 'pipe' })).not.toThrow();
      writeFileSync(join(dir, 'bad.tsx'), 'export const b = <p className="text-success" />;');
      expect(() => execFileSync('node', [cli, dir], { stdio: 'pipe' })).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
