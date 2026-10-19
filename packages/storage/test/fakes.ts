/**
 * Test doubles for the native sides (no Capacitor or Tauri runtime in CI unit tests). They run the
 * real SQLite engine (sqlite-wasm) and model the wire boundary: the Tauri fake JSON-serializes
 * every request and response like Tauri IPC does, and both keep state across close/reopen.
 */
import { FileNotFoundError } from '../src/errors.ts';
import { MemoryBackend } from '../src/adapters/memory.ts';
import {
  loadSqlite,
  sqlExec,
  sqlQuery,
  type Sqlite3,
  type SqliteDb,
} from '../src/adapters/sqlite-wasm.ts';
import type { CapacitorFilesBridge, CapacitorSqliteBridge } from '../src/adapters/capacitor.ts';
import { decodeValue, encodeValue, type TauriInvoke } from '../src/adapters/tauri.ts';
import { fromBase64, toBase64 } from '../src/bytes.ts';
import type { Row } from '../src/types.ts';

/** A "native" database that persists its image in `backend` on close and checks the passphrase. */
class FakeNativeDb {
  #sqlite: Sqlite3 | undefined;
  #db: SqliteDb | undefined;
  passphrase: string | undefined;
  constructor(readonly backend: MemoryBackend) {}
  async open(passphrase: string): Promise<void> {
    if (this.passphrase !== undefined && this.passphrase !== passphrase)
      throw new Error('file is not a database'); // SQLCipher's wrong-key error
    this.passphrase = passphrase;
    const s = (this.#sqlite = await loadSqlite());
    const db = new s.oo1.DB(':memory:', 'c');
    if (this.backend.image) {
      const img = this.backend.image;
      const p = s.wasm.allocFromTypedArray(img);
      db.checkRc(
        s.capi.sqlite3_deserialize(
          db,
          'main',
          p,
          img.length,
          img.length,
          s.capi.SQLITE_DESERIALIZE_FREEONCLOSE | s.capi.SQLITE_DESERIALIZE_RESIZEABLE,
        ),
      );
    }
    this.#db = db;
  }
  get db(): SqliteDb {
    if (!this.#db) throw new Error('database not open');
    return this.#db;
  }
  size(): number {
    return this.#sqlite ? this.#sqlite.capi.sqlite3_js_db_export(this.db).length : 0;
  }
  close(): void {
    if (this.#sqlite && this.#db) {
      this.backend.image = this.#sqlite.capi.sqlite3_js_db_export(this.#db);
      this.#db.close();
    }
    this.#db = undefined;
  }
}

export class FakeCapacitor {
  readonly backend = new MemoryBackend();
  readonly #db = new FakeNativeDb(this.backend);
  readonly sqlite: CapacitorSqliteBridge = {
    open: (o) => this.#db.open(o.passphrase),
    run: (sql, values) => {
      sqlExec(this.#db.db, sql, values);
      return Promise.resolve();
    },
    query: (sql, values) => Promise.resolve(sqlQuery(this.#db.db, sql, values)),
    close: () => {
      this.#db.close();
      return Promise.resolve();
    },
  };
  readonly files: CapacitorFilesBridge = {
    write: (p, b) => Promise.resolve(void this.backend.files.set(p, b.slice())),
    read: (p) => Promise.resolve(this.backend.files.get(p)?.slice() ?? null),
    remove: (p) => Promise.resolve(void this.backend.files.delete(p)),
    usage: () => {
      let used = this.#db.size();
      for (const f of this.backend.files.values()) used += f.length;
      return Promise.resolve({ used, quota: 1 << 30 });
    },
  };
}

/** Mirrors apps/desktop/src-tauri/src/storage.rs, including the JSON wire format. */
export function fakeTauriInvoke(): {
  invoke: TauriInvoke;
  backend: MemoryBackend;
  calls: string[];
} {
  const backend = new MemoryBackend();
  const db = new FakeNativeDb(backend);
  const calls: string[] = [];
  const keyringKey = 'keyring-generated-key';
  const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const params = (a: Record<string, unknown>) =>
    ((a.params as unknown[] | undefined) ?? []).map(decodeValue);
  const rowOut = (r: Row) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, encodeValue(v)]));

  const invoke: TauriInvoke = async (cmd, rawArgs = {}) => {
    calls.push(cmd);
    const args = wire(rawArgs);
    const ref = typeof args.fileRef === 'string' ? args.fileRef : '';
    switch (cmd) {
      case 'storage_open':
        await db.open((args.key as string | null) ?? keyringKey);
        sqlExec(db.db, 'PRAGMA foreign_keys = ON', []);
        return wire(null);
      case 'storage_exec':
        sqlExec(db.db, String(args.sql), params(args));
        return wire(null);
      case 'storage_query':
        return wire(sqlQuery(db.db, String(args.sql), params(args)).map(rowOut));
      case 'storage_put_file':
        backend.files.set(ref, fromBase64(String(args.data)));
        return wire(null);
      case 'storage_get_file': {
        const f = backend.files.get(ref);
        return wire(f ? toBase64(f) : null);
      }
      case 'storage_delete_file':
        backend.files.delete(ref);
        return wire(null);
      case 'storage_usage': {
        let used = db.size();
        for (const f of backend.files.values()) used += f.length;
        return wire({ used });
      }
      case 'storage_close':
        db.close();
        return wire(null);
      default:
        throw new FileNotFoundError(`unknown command ${cmd}`);
    }
  };
  return { invoke, backend, calls };
}
