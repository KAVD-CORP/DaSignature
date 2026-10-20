import { LEGACY_REF } from './adapters/base.ts';
import { FileNotFoundError, SchemaTooNewError } from './errors.ts';
import { FILE_COLUMNS } from './fields.ts';
import type { StorageAdapter } from './types.ts';

/**
 * Forward-only migrations. Version 1 is the SPEC Sec 6 schema, statement for statement
 * (ADP-SCHEMA-01 compares sqlite_master against the spec text). Never edit a released
 * migration; add a new version instead. Each migration runs in one transaction together with
 * its schema_migrations row, so a failed migration leaves the database at the previous version.
 */
export interface Migration {
  version: number;
  name: string;
  /**
   * Optional, runs BEFORE the transaction, on the adapter. File work that can't be transactional
   * (copying files). Must be idempotent: after a crash it runs again.
   */
  prepare?(db: StorageAdapter): Promise<void>;
  /** Runs inside the migration's transaction; use only the handle it is given. */
  up(tx: StorageAdapter): Promise<void>;
  /**
   * Optional, runs AFTER the commit, and again on every later migrate() call until it has nothing
   * left to do (crash recovery). Must be idempotent. Used to delete superseded files.
   */
  finalize?(db: StorageAdapter): Promise<void>;
}

export const SCHEMA_V1: readonly string[] = [
  'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
  "CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, file_ref TEXT NOT NULL, sha256 TEXT NOT NULL, page_count INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  'CREATE TABLE signatures (id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, name TEXT NOT NULL, strokes_json TEXT, svg_path TEXT, image_ref TEXT, typed_text TEXT, font_id TEXT, color TEXT, opacity REAL, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)',
  'CREATE TABLE placements (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, page_index INTEGER NOT NULL, type TEXT NOT NULL, signature_id TEXT REFERENCES signatures(id) ON DELETE SET NULL, x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL, rotation REAL NOT NULL DEFAULT 0, opacity REAL NOT NULL DEFAULT 1, data_json TEXT, z_index INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE exports (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, file_ref TEXT NOT NULL, sha256 TEXT NOT NULL, signer_name TEXT, created_at TEXT NOT NULL)',
  'CREATE TABLE pen_presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, settings_json TEXT NOT NULL)',
  'CREATE TABLE templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, placements_json TEXT NOT NULL)',
  'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE INDEX idx_placements_doc ON placements(document_id, page_index)',
];

const REF_COLUMNS: readonly (readonly [string, string])[] = Object.entries(FILE_COLUMNS).flatMap(
  ([t, cols]) => cols.map((c) => [t, c] as const),
);
/** Settings key listing legacy files still to delete after migration 2 committed. */
export const PENDING_FILE_DELETES = 'storage.pendingFileDeletes';

async function legacyRefs(db: StorageAdapter): Promise<string[]> {
  const refs = new Set<string>();
  for (const [t, c] of REF_COLUMNS) {
    for (const r of await db.query<{ ref: unknown }>(`SELECT ${c} AS ref FROM ${t}`)) {
      if (typeof r.ref === 'string' && LEGACY_REF.test(r.ref)) refs.add(r.ref);
    }
  }
  return [...refs].sort();
}
/** `<uuid>.<ext>` -> `<uuid>`: deterministic, so every step can be re-run after a crash. */
const opaqueOf = (legacy: string) => legacy.slice(0, 36);

/**
 * Migration 2 (PM #71): stored files get opaque names without an extension. Crash-safe:
 * 1. prepare (idempotent): copy every legacy `<id>.<ext>` file to `<id>`, overwriting any partial
 *    copy from an earlier attempt. The legacy files stay, so nothing can be lost.
 * 2. up (one transaction): point every row at `<id>` and record the legacy names in settings.
 * 3. finalize (after commit, re-run on every start until done): delete the legacy files, then the
 *    record. A crash anywhere leaves either the old state (step 1 re-runs) or a committed state
 *    whose leftovers step 3 removes, so there are no orphans and no lost files.
 */
export const MIGRATION_OPAQUE_FILE_REFS: Migration = {
  version: 2,
  name: 'opaque file refs (PM #71)',
  prepare: async (db) => {
    for (const ref of await legacyRefs(db)) {
      let bytes: Uint8Array;
      try {
        bytes = await db.getFile(ref);
      } catch (err) {
        if (err instanceof FileNotFoundError) continue; // already dangling before the migration
        throw err;
      }
      await db.putFileAt(opaqueOf(ref), bytes);
    }
  },
  up: async (tx) => {
    const refs = await legacyRefs(tx);
    for (const [t, c] of REF_COLUMNS) {
      await tx.exec(
        `UPDATE ${t} SET ${c} = substr(${c}, 1, 36) WHERE ${c} GLOB '????????-????-????-????-????????????.*'`,
      );
    }
    if (refs.length)
      await tx.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
        PENDING_FILE_DELETES,
        JSON.stringify(refs),
      ]);
  },
  finalize: async (db) => {
    const [row] = await db.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
      PENDING_FILE_DELETES,
    ]);
    if (!row) return;
    for (const ref of JSON.parse(row.value) as string[]) {
      if (!LEGACY_REF.test(ref)) continue;
      try {
        await db.deleteFile(ref);
      } catch (err) {
        if (!(err instanceof FileNotFoundError)) throw err;
      }
    }
    await db.exec('DELETE FROM settings WHERE key = ?', [PENDING_FILE_DELETES]);
  },
};

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial schema (SPEC Sec 6)',
    up: async (tx) => {
      for (const sql of SCHEMA_V1) await tx.exec(sql);
    },
  },
  MIGRATION_OPAQUE_FILE_REFS,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** The user tables in foreign-key order (parents first). */
export const TABLES = [
  'documents',
  'signatures',
  'placements',
  'exports',
  'pen_presets',
  'templates',
  'settings',
] as const;
export type TableName = (typeof TABLES)[number];

export async function schemaVersion(db: StorageAdapter): Promise<number> {
  const exists = await db.query<{ n: number }>(
    "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  );
  if ((exists[0]?.n ?? 0) === 0) return 0;
  const rows = await db.query<{ v: number | null }>(
    'SELECT max(version) AS v FROM schema_migrations',
  );
  return rows[0]?.v ?? 0;
}

/**
 * Applies every pending migration in order and returns the resulting version. `list` is a test
 * seam (QA MIG-04/05 inject prefixes and a broken migration); production always uses MIGRATIONS.
 * Refuses a database whose recorded version is newer than the newest migration it knows.
 */
export async function migrate(
  db: StorageAdapter,
  now: () => string = () => new Date().toISOString(),
  list: readonly Migration[] = MIGRATIONS,
): Promise<number> {
  const latest = list.reduce((v, m) => Math.max(v, m.version), 0);
  const current = await schemaVersion(db);
  if (current > latest) {
    throw new SchemaTooNewError(
      `database schema version ${String(current)} is newer than this app (version ${String(latest)}); downgrades are not supported`,
    );
  }
  const sorted = [...list].sort((x, y) => x.version - y.version);
  for (const m of sorted) {
    if (m.version <= current) continue;
    await m.prepare?.(db);
    await db.transaction(async (tx) => {
      await m.up(tx);
      await tx.exec('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
        m.version,
        now(),
      ]);
    });
    await m.finalize?.(db);
  }
  // Crash recovery: finish any committed migration whose post-commit cleanup was interrupted.
  for (const m of sorted) if (m.version <= current) await m.finalize?.(db);
  return Math.max(current, latest);
}
