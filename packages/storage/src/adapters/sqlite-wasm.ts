import type sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { StorageError } from '../errors.ts';
import type { Row } from '../types.ts';

/** Shared SQL plumbing for every adapter (and test double) that runs on @sqlite.org/sqlite-wasm. */
export type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
export type SqliteDb = InstanceType<Sqlite3['oo1']['DB']>;
type Bindable = string | number | bigint | null | Uint8Array;

export function bindParams(params: readonly unknown[]): Bindable[] {
  return params.map((p, i) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'string' || typeof p === 'number' || typeof p === 'bigint') return p;
    if (p instanceof Uint8Array) return p;
    throw new StorageError(`unsupported SQL parameter #${String(i + 1)} (${typeof p})`);
  });
}

export function sqlExec(db: SqliteDb, sql: string, params: readonly unknown[]): void {
  if (params.length === 0) db.exec(sql);
  else db.exec({ sql, bind: bindParams(params) });
}

export function sqlQuery(db: SqliteDb, sql: string, params: readonly unknown[]): Row[] {
  const rows =
    params.length === 0 ? db.selectObjects(sql) : db.selectObjects(sql, bindParams(params));
  // Plain objects (sqlite-wasm returns null-prototype objects).
  return rows.map((r) => ({ ...r }));
}

let node: Promise<Sqlite3> | undefined;
/** sqlite-wasm initialised once per JS realm (Node tests, or a worker). */
export function loadSqlite(): Promise<Sqlite3> {
  node ??= import('@sqlite.org/sqlite-wasm').then((m) =>
    m.default({ print: () => undefined, printErr: () => undefined }),
  );
  return node;
}
