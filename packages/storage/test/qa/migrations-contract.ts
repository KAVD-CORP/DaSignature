// MIG-01..06: migration contract (SPEC Sec 6 schema_migrations, M2 "migrations"; MIG-06 = PM #69). Runs against every adapter.
// The harness's adapter.open() must NOT auto-migrate: the suite drives the Engineer's runner explicitly so it can stop at
// any prior version. (If init() auto-migrates in production, expose the runner and a raw open for tests.)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AdapterHarness, StorageAdapter } from './types.ts';
import { diffSpecSchema } from './schema.ts';
import { ISO_WITH_OFFSET } from './fixtures.ts';
import { updateRequiredProblems, rawDiff, type UpdateRequiredSpec, type RawFile } from './checks.ts';

/** One migration. `up` receives the handle the runner gives it: with tx-handle adapters the runner MUST pass `tx`.
 *  Adapting the Engineer's `{ version, name, statements[] }`: `up: async (tx) => { for (const s of m.statements) await tx.exec(s); }`. */
export interface Migration { version: number; name: string; up(a: StorageAdapter): Promise<void> }
export interface MigrationHarness {
  adapter: AdapterHarness;
  /** The Engineer's real, ordered migration list. */
  migrations: Migration[];
  /** The Engineer's runner: applies every migration in `list` whose version isn't recorded yet. */
  /** Runs `list` (NOT a built-in global list): MIG-04/05 inject prefixes and a deliberately broken migration through it.
   *  Engineer note: packages/storage/src/schema.ts migrate(db, now) uses the global MIGRATIONS, so it needs a
   *  `migrations = MIGRATIONS` parameter (test seam) for this harness. */
  migrate(a: StorageAdapter, list: Migration[]): Promise<void>;
  /** Insert representative rows valid at schema `version` (0 = empty DB). Must touch every table that exists at that version. */
  seed(a: StorageAdapter, version: number): Promise<void>;
  /** Tables/columns a migration deliberately rewrites (excluded from the no-data-loss value comparison). */
  /** MIG-06 (PM #69): every persisted byte of the store (DB file(s) incl. -wal/-journal, blobs), for byte-identity. */
  rawBytes(): Promise<RawFile[]>;
  /** MIG-06 (PM #69): the dedicated "newer database" error and the message the user sees for it. */
  newerSchema: UpdateRequiredSpec;
  transforms?: { version: number; table: string; column: string }[];
  extraTables?: string[];
}

async function schemaSql(a: StorageAdapter): Promise<string> {
  return (await a.query<{ type: string; name: string; sql: string | null }>("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")).map((r) => `${r.type} ${r.name}: ${r.sql}`).join('\n');
}
async function dump(a: StorageAdapter): Promise<Record<string, Record<string, unknown>[]>> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const { name } of await a.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"))
    out[name] = await a.query<Record<string, unknown>>(`SELECT * FROM "${name}" ORDER BY 1`);
  return out;
}
const versions = async (a: StorageAdapter) => (await a.query<{ version: number; applied_at: string }>('SELECT version, applied_at FROM schema_migrations ORDER BY version'));

export function runMigrationContract(name: string, h: MigrationHarness, timeout = 120_000): void {
  describe(`MIG migration contract: ${name}`, () => {
    let a: StorageAdapter;
    beforeEach(async () => { await h.adapter.destroy(); a = await h.adapter.open(); }, timeout);
    afterEach(async () => { await h.adapter.close(a); await h.adapter.destroy(); }, timeout);
    const all = h.migrations;

    it('MIG-01 versions are positive integers, strictly ascending, unique, and named', () => {
      expect(all.length).toBeGreaterThan(0);
      all.forEach((m, i) => { expect(Number.isInteger(m.version) && m.version > 0).toBe(true); expect(m.name).toBeTruthy(); if (i) expect(m.version).toBeGreaterThan(all[i - 1]!.version); });
    });

    it('MIG-02 fresh DB: migrate() applies every migration once, records each version with an ISO-8601+offset applied_at, and the result equals SPEC Sec 6', async () => {
      await h.migrate(a, all);
      const v = await versions(a);
      expect(v.map((r) => r.version)).toEqual(all.map((m) => m.version));
      for (const r of v) expect(r.applied_at).toMatch(ISO_WITH_OFFSET);
      expect(await diffSpecSchema(a, h.extraTables ? { extraTables: h.extraTables } : {})).toEqual([]);
    }, timeout);

    it('MIG-03 idempotent: a second (and third) migrate() changes nothing (schema, versions, data)', async () => {
      await h.migrate(a, all); await h.seed(a, all.at(-1)!.version);
      const s0 = await schemaSql(a), d0 = await dump(a);
      await h.migrate(a, all); await h.migrate(a, all);
      expect(await schemaSql(a)).toBe(s0); expect(await dump(a)).toEqual(d0);
    }, timeout);

    // MIG-04: forward from EVERY prior version (k = 0 is an empty DB; at M2 there is only v1, so this is k = 0 -> v1).
    for (let k = 0; k < all.length; k++) {
      const from = k === 0 ? 0 : all[k - 1]!.version;
      it(`MIG-04 forward from v${from} to v${all.at(-1)!.version}: no data loss, survives reopen`, async () => {
        await h.migrate(a, all.slice(0, k)); await h.seed(a, from);
        const before = await dump(a);
        await h.migrate(a, all);
        await h.adapter.close(a); a = await h.adapter.open();
        const after = await dump(a);
        for (const [table, rows] of Object.entries(before)) {
          if (table === 'schema_migrations') continue;
          expect(after[table], `table ${table} dropped`).toBeDefined();
          expect(after[table]!.length, `${table} row count`).toBeGreaterThanOrEqual(rows.length);
          const skip = new Set((h.transforms ?? []).filter((t) => t.table === table && t.version > from).map((t) => t.column));
          for (const row of rows) {
            const key = Object.values(row)[0];
            const hit = after[table]!.find((r) => Object.values(r)[0] === key);
            expect(hit, `${table} row ${String(key)} lost`).toBeDefined();
            for (const [col, val] of Object.entries(row)) if (!skip.has(col) && col in hit!) expect(hit![col], `${table}.${col} changed for ${String(key)}`).toEqual(val);
          }
        }
        expect(await diffSpecSchema(a, h.extraTables ? { extraTables: h.extraTables } : {})).toEqual([]);
      }, timeout);
    }

    it('MIG-05 crash mid-migration: a migration that fails after partial DDL/DML leaves schema, data and version untouched; a fixed re-run completes once', async () => {
      await h.migrate(a, all); await h.seed(a, all.at(-1)!.version);
      const s0 = await schemaSql(a), d0 = await dump(a), v0 = await versions(a);
      const next = all.at(-1)!.version + 1;
      const broken: Migration = { version: next, name: 'qa-broken', up: async (x) => {
        await x.exec('CREATE TABLE qa_mig_partial (id INTEGER PRIMARY KEY)');
        await x.exec('ALTER TABLE settings ADD COLUMN qa_col TEXT');
        await x.exec("INSERT INTO settings (key, value) VALUES ('qa-mig', 'partial')");
        throw new Error('qa: simulated crash mid-migration');
      } };
      await expect(h.migrate(a, [...all, broken])).rejects.toThrow();
      expect(await schemaSql(a)).toBe(s0); expect(await dump(a)).toEqual(d0); expect(await versions(a)).toEqual(v0);
      // the app restarts (reopen) and ships the fixed migration
      await h.adapter.close(a); a = await h.adapter.open();
      const fixed: Migration = { version: next, name: 'qa-fixed', up: async (x) => { await x.exec('CREATE TABLE qa_mig_partial (id INTEGER PRIMARY KEY)'); } };
      await h.migrate(a, [...all, fixed]);
      expect((await versions(a)).filter((r) => r.version === next)).toHaveLength(1);
    }, timeout);

    it('MIG-06 (PM #69) a DB at a NEWER schema version is refused with the dedicated error + an "update DaSignature" message, and storage stays byte-identical', async () => {
      await h.migrate(a, all);
      const future = all.at(-1)!.version + 5;
      await a.exec('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [future, '2030-01-01T00:00:00Z']);
      const s0 = await schemaSql(a), d0 = await dump(a);
      await h.adapter.close(a); const raw0 = await h.rawBytes(); a = await h.adapter.open();
      const err = await h.migrate(a, all).then(() => null, (e: unknown) => e);
      expect(updateRequiredProblems(err, h.newerSchema)).toEqual([]);
      expect(await schemaSql(a)).toBe(s0); expect(await dump(a)).toEqual(d0);
      const again = await h.migrate(a, all).then(() => null, (e: unknown) => e);   // the app retries on next launch: still refused
      expect(updateRequiredProblems(again, h.newerSchema)).toEqual([]);
      await h.adapter.close(a); expect(await rawDiff(raw0, await h.rawBytes()), 'storage bytes after the refused open').toEqual([]); a = await h.adapter.open();
    }, timeout);
  });
}
