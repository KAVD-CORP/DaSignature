import { FileNotFoundError } from '../errors.ts';
import type { StorageAdapter } from '../types.ts';
import { SqlAdapterBase, type AdapterOptions, type SqlDriver } from './base.ts';
import { loadSqlite, sqlExec, sqlQuery, type Sqlite3, type SqliteDb } from './sqlite-wasm.ts';

/**
 * Where a MemoryStorageAdapter keeps its data between close() and the next init(): the database
 * as a serialized SQLite image plus a file map. Share one backend between adapter instances to
 * model "same device, app restarted" (PERSIST-01 in unit tests).
 */
export class MemoryBackend {
  image: Uint8Array | undefined;
  readonly files = new Map<string, Uint8Array>();
}

class MemoryDriver implements SqlDriver {
  #sqlite: Sqlite3 | undefined;
  #db: SqliteDb | undefined;
  constructor(private readonly backend: MemoryBackend) {}

  async open(): Promise<void> {
    const sqlite3 = (this.#sqlite = await loadSqlite());
    const db = new sqlite3.oo1.DB(':memory:', 'c');
    const image = this.backend.image;
    if (image) {
      const p = sqlite3.wasm.allocFromTypedArray(image);
      const flags =
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
      db.checkRc(
        sqlite3.capi.sqlite3_deserialize(db, 'main', p, image.length, image.length, flags),
      );
    }
    db.exec('PRAGMA foreign_keys = ON');
    this.#db = db;
  }
  #d(): SqliteDb {
    if (!this.#db) throw new Error('not open');
    return this.#db;
  }
  exec(sql: string, params: readonly unknown[]): Promise<void> {
    sqlExec(this.#d(), sql, params);
    return Promise.resolve();
  }
  query(sql: string, params: readonly unknown[]) {
    return Promise.resolve(sqlQuery(this.#d(), sql, params));
  }
  writeFile(ref: string, bytes: Uint8Array): Promise<void> {
    this.backend.files.set(ref, bytes.slice());
    return Promise.resolve();
  }
  readFile(ref: string): Promise<Uint8Array> {
    const f = this.backend.files.get(ref);
    return f ? Promise.resolve(f.slice()) : Promise.reject(new FileNotFoundError(ref));
  }
  removeFile(ref: string): Promise<void> {
    this.backend.files.delete(ref);
    return Promise.resolve();
  }
  usage(): Promise<{ used: number }> {
    let used = this.#sqlite ? this.#sqlite.capi.sqlite3_js_db_export(this.#d()).length : 0;
    for (const f of this.backend.files.values()) used += f.length;
    return Promise.resolve({ used });
  }
  close(): Promise<void> {
    if (this.#sqlite && this.#db) {
      this.backend.image = this.#sqlite.capi.sqlite3_js_db_export(this.#db);
      this.#db.close();
    }
    this.#db = undefined;
    return Promise.resolve();
  }
}

/**
 * In-memory adapter on the real SQLite engine (sqlite-wasm). Used by unit tests, as the reference
 * implementation for the contract suite, and as the test double behind the native bridges.
 * Not used in the shipped apps.
 */
export class MemoryStorageAdapter extends SqlAdapterBase implements StorageAdapter {
  constructor(backend: MemoryBackend = new MemoryBackend(), opts?: AdapterOptions) {
    super(new MemoryDriver(backend), opts);
  }
}
