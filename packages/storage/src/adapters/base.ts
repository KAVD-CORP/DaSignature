import { StorageBusyError, StorageClosedError, StorageError } from '../errors.ts';
import { uuidv7 } from '../ids.ts';
import type { Row, StorageAdapter } from '../types.ts';

/**
 * The few primitives a platform must provide. Everything else (locking, transactions, nested
 * savepoints, file refs) is shared, so every adapter behaves identically under the contract suite.
 */
export interface SqlDriver {
  /** Opens the database (and file store). Must enable `PRAGMA foreign_keys = ON`. */
  open(key: CryptoKey | string | undefined): Promise<void>;
  exec(sql: string, params: readonly unknown[]): Promise<void>;
  query(sql: string, params: readonly unknown[]): Promise<Row[]>;
  writeFile(ref: string, bytes: Uint8Array): Promise<void>;
  /** Rejects with FileNotFoundError for an unknown ref. */
  readFile(ref: string): Promise<Uint8Array>;
  removeFile(ref: string): Promise<void>;
  usage(): Promise<{ used: number; quota?: number }>;
  close(): Promise<void>;
}

export interface AdapterOptions {
  /** How long a call waits for a running transaction before rejecting (default 15 s). */
  lockTimeoutMs?: number;
}

/** Every ref this app writes: a bare uuid, nothing else (PM #71). */
export const OPAQUE_REF = /^[0-9a-f-]{36}$/;
/** Refs written before PM #71 (`<uuid>.<ext>`): still readable and deletable, renamed by migration 2. */
export const LEGACY_REF = /^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/;

/**
 * THE single place stored file names come from (PM #71): an opaque random id with no extension,
 * so the file store reveals nothing about a file's type. The type is implied by the (encrypted)
 * row that references the file. putFile() takes `hint` for SPEC Sec 6 compatibility and ignores it.
 */
export function makeFileRef(): string {
  return uuidv7();
}

/** Accepts opaque refs and legacy refs (read, delete and migration only). */
export function assertFileRef(ref: string): void {
  if (!OPAQUE_REF.test(ref) && !LEGACY_REF.test(ref))
    throw new StorageError(`invalid file ref: ${ref}`);
}

/** Targets of putFileAt must be opaque refs; nothing can create a name with an extension. */
export function assertOpaqueRef(ref: string): void {
  if (!OPAQUE_REF.test(ref)) throw new StorageError(`not an opaque file ref: ${ref}`);
}

/** Shared implementation. Concrete adapters extend it and declare `implements StorageAdapter`. */
export abstract class SqlAdapterBase {
  #tail: Promise<void> = Promise.resolve();
  #opened = false;
  #closed = false;
  #savepoint = 0;
  readonly #lockTimeoutMs: number;

  protected constructor(
    protected readonly driver: SqlDriver,
    opts: AdapterOptions = {},
  ) {
    this.#lockTimeoutMs = opts.lockTimeoutMs ?? 15_000;
  }

  /** Idempotent: a second call (with or without a key) is a no-op on an open adapter. */
  async init(opts: { key?: CryptoKey | string } = {}): Promise<void> {
    if (this.#closed) throw new StorageClosedError('adapter is closed');
    await this.#locked(async () => {
      if (this.#opened) return;
      await this.driver.open(opts.key);
      this.#opened = true;
    });
  }

  query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.#locked(async () => (await this.#ready().query(sql, params)) as T[]);
  }

  exec(sql: string, params: unknown[] = []): Promise<void> {
    return this.#locked(() => this.#ready().exec(sql, params));
  }

  putFile(bytes: Uint8Array): Promise<string> {
    return this.#locked(async () => {
      const ref = makeFileRef();
      await this.#ready().writeFile(ref, bytes);
      return ref;
    });
  }

  /** Writes (or overwrites) the file at a given opaque ref. For migrations; see StorageAdapter. */
  async putFileAt(ref: string, bytes: Uint8Array): Promise<void> {
    assertOpaqueRef(ref);
    return this.#locked(() => this.#ready().writeFile(ref, bytes));
  }

  async getFile(ref: string): Promise<Uint8Array> {
    assertFileRef(ref);
    return this.#locked(() => this.#ready().readFile(ref));
  }

  async deleteFile(ref: string): Promise<void> {
    assertFileRef(ref);
    return this.#locked(() => this.#ready().removeFile(ref));
  }

  usage(): Promise<{ used: number; quota?: number }> {
    return this.#locked(() => this.#ready().usage());
  }

  async close(): Promise<void> {
    await this.#locked(async () => {
      if (this.#opened && !this.#closed) await this.driver.close();
      this.#closed = true;
      this.#opened = false;
    });
  }

  /**
   * Serialized with every other call on this adapter. COMMIT on resolve, ROLLBACK on throw.
   * `fn` receives a transaction-bound handle; see StorageAdapter in ../types.ts.
   */
  transaction<T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<T> {
    return this.#locked(async () => {
      const d = this.#ready();
      await d.exec('BEGIN IMMEDIATE', []);
      const tx = this.#txHandle();
      try {
        const result = await fn(tx.handle);
        await d.exec('COMMIT', []);
        return result;
      } catch (err) {
        await d.exec('ROLLBACK', []);
        throw err;
      } finally {
        tx.end();
      }
    });
  }

  #ready(): SqlDriver {
    if (this.#closed) throw new StorageClosedError('adapter is closed');
    if (!this.#opened) throw new StorageError('call init() first');
    return this.driver;
  }

  /** A FIFO lock; a waiter that times out gives up its turn instead of blocking the queue. */
  #locked<T>(work: () => Promise<T>): Promise<T> {
    const prev = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((r) => (release = r));
    let timedOut = false;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        timedOut = true;
        reject(
          new StorageBusyError(
            `storage busy for ${String(this.#lockTimeoutMs)} ms (inside transaction(fn), use the tx handle instead of the adapter)`,
          ),
        );
      }, this.#lockTimeoutMs);
      void prev.then(async () => {
        clearTimeout(timer);
        if (timedOut) {
          release();
          return;
        }
        try {
          resolve(await work());
        } catch (err) {
          reject(err instanceof Error ? err : new StorageError(String(err)));
        } finally {
          release();
        }
      });
    });
  }

  /** The handle passed to transaction(fn): direct driver access, valid until the transaction ends. */
  #txHandle(): { handle: StorageAdapter; end: () => void } {
    let live = true;
    const d = this.driver;
    const check = (): SqlDriver => {
      if (!live)
        throw new StorageClosedError('transaction handle used after the transaction ended');
      return d;
    };
    const handle: StorageAdapter = {
      init: () => Promise.reject(new StorageError('init() is not available inside a transaction')),
      close: () =>
        Promise.reject(new StorageError('close() is not available inside a transaction')),
      query: async <R>(sql: string, params: unknown[] = []) =>
        (await check().query(sql, params)) as R[],
      exec: (sql, params = []) => check().exec(sql, params),
      putFile: async (bytes) => {
        const ref = makeFileRef();
        await check().writeFile(ref, bytes);
        return ref;
      },
      putFileAt: async (ref, bytes) => {
        assertOpaqueRef(ref);
        await check().writeFile(ref, bytes);
      },
      getFile: async (ref) => {
        assertFileRef(ref);
        return check().readFile(ref);
      },
      deleteFile: async (ref) => {
        assertFileRef(ref);
        return check().removeFile(ref);
      },
      usage: () => check().usage(),
      transaction: async <R>(inner: (t: StorageAdapter) => Promise<R>) => {
        const sp = `sp_${String(++this.#savepoint)}`;
        await check().exec(`SAVEPOINT ${sp}`, []);
        try {
          const r = await inner(handle);
          await check().exec(`RELEASE ${sp}`, []);
          return r;
        } catch (err) {
          await check().exec(`ROLLBACK TO ${sp}`, []);
          await check().exec(`RELEASE ${sp}`, []);
          throw err;
        }
      },
    };
    return { handle, end: () => (live = false) };
  }
}
