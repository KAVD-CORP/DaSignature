import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MemoryStorageAdapter } from '../src/adapters/memory.ts';
import { isUpdateRequired, SchemaTooNewError } from '../src/errors.ts';
import { UUID_V7, uuidv7 } from '../src/ids.ts';
import { migrate, schemaVersion, SCHEMA_V1, SCHEMA_VERSION } from '../src/schema.ts';
import { memoryStore, seed } from './helpers.ts';

const norm = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),])\s*/g, '$1')
    .replace(/;$/, '')
    .trim()
    .toLowerCase();

/** The CREATE statements from the ```sql block in SPEC Sec 6 (comments stripped). */
function specDdl(): string[] {
  const spec = readFileSync(
    fileURLToPath(new URL('../../../docs/SPEC.md', import.meta.url)),
    'utf8',
  );
  const sec = spec.slice(spec.indexOf('CREATE TABLE schema_migrations'));
  const block = sec.slice(0, sec.indexOf('```'));
  return block
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => /^CREATE /i.test(s))
    .map(norm);
}

describe('ADP-SCHEMA-01 schema and migrations', () => {
  it('migration v1 is the SPEC Sec 6 DDL, statement for statement', () => {
    expect(SCHEMA_V1.map(norm)).toEqual(specDdl());
  });

  it('sqlite_master matches the spec DDL after migrating', async () => {
    const db = new MemoryStorageAdapter();
    await db.init({});
    expect(await schemaVersion(db)).toBe(0);
    await migrate(db);
    const rows = await db.query<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
    );
    expect(rows.map((r) => norm(r.sql))).toEqual(specDdl());
    const mig = await db.query<{ version: number; applied_at: string }>(
      'SELECT * FROM schema_migrations',
    );
    expect(mig).toHaveLength(SCHEMA_VERSION);
    expect(mig[0]?.version).toBe(1);
    expect(mig[0]?.applied_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(await migrate(db)).toBe(1);
    expect(await db.query('SELECT version FROM schema_migrations')).toHaveLength(1);
    await db.close();
  });

  it('refuses a database from a newer app version', async () => {
    const db = new MemoryStorageAdapter();
    await db.init({});
    await migrate(db);
    await db.exec("INSERT INTO schema_migrations VALUES (99, 'x')");
    const err = await migrate(db).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SchemaTooNewError);
    expect(isUpdateRequired(err)).toBe(true);
    expect((err as SchemaTooNewError).messageKey).toBe('storage.updateRequired.database');
    expect(await schemaVersion(db)).toBe(99); // untouched
  });

  it('a failing migration leaves the previous version intact', async () => {
    const db = new MemoryStorageAdapter();
    await db.init({});
    await db.exec('CREATE TABLE documents (x)'); // conflicts with v1
    await expect(migrate(db)).rejects.toThrow();
    expect(await schemaVersion(db)).toBe(0);
  });

  it('ids are uuid v7 and time-ordered', async () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(UUID_V7);
    expect(a < b).toBe(true);
    expect(a.slice(0, 13)).toBe('018bcfe5-6800');
    const { store } = await memoryStore();
    const { doc, exp } = await seed(store);
    expect(doc.id).toMatch(UUID_V7);
    expect(exp.id).toMatch(UUID_V7);
    expect(doc.file_ref).toMatch(new RegExp(UUID_V7.source.slice(0, -1) + '\\.pdf$'));
  });
});
