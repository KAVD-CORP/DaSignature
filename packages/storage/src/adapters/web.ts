import { toArrayBuffer } from '../bytes.ts';
import { FileNotFoundError, StorageError } from '../errors.ts';
import type { Row, StorageAdapter } from '../types.ts';
import { SqlAdapterBase, type AdapterOptions, type SqlDriver } from './base.ts';
import type { WorkerConfig, WorkerOp, WorkerRequest, WorkerResponse } from './web-protocol.ts';

/**
 * Web/PWA (SPEC Sec 6): SQLite via sqlite-wasm on the OPFS sahpool VFS in a dedicated worker,
 * file blobs in OPFS. Field and blob encryption happens above this layer (DataStore + Vault), so
 * init()'s key is not used here.
 */
export interface WebAdapterOptions extends AdapterOptions, Partial<WorkerConfig> {
  /** Defaults to the bundled web-worker.ts (Vite builds it as a separate module worker). */
  createWorker?: () => Worker;
}

export const WEB_DEFAULTS: WorkerConfig = {
  vfsDir: '.dasig-sqlite',
  filesDir: 'dasig-files',
  dbName: 'dasignature.sqlite3',
};

const ERRORS: Record<string, new (m: string) => Error> = { FileNotFoundError, StorageError };

class WebDriver implements SqlDriver {
  #worker: Worker | undefined;
  #next = 1;
  readonly #pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  constructor(private readonly o: WebAdapterOptions) {}

  #call(op: WorkerOp, args: unknown[] = [], transfer: Transferable[] = []): Promise<unknown> {
    const w = this.#worker;
    if (!w) return Promise.reject(new StorageError('storage worker is not running'));
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      const msg: WorkerRequest = { id, op, args };
      w.postMessage(msg, transfer);
    });
  }

  async open(): Promise<void> {
    const w =
      this.o.createWorker?.() ??
      new Worker(new URL('./web-worker.ts', import.meta.url), {
        type: 'module',
        name: 'dasig-storage',
      });
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const res = ev.data;
      const p = this.#pending.get(res.id);
      if (!p) return;
      this.#pending.delete(res.id);
      if (res.ok) p.resolve(res.result);
      else {
        const E = ERRORS[res.error.name] ?? Error;
        const err = new E(res.error.message);
        if (!(res.error.name in ERRORS)) err.name = res.error.name;
        p.reject(err);
      }
    };
    w.onerror = (ev) => {
      for (const p of this.#pending.values())
        p.reject(new StorageError(`storage worker failed: ${ev.message}`));
      this.#pending.clear();
    };
    this.#worker = w;
    const cfg: WorkerConfig = {
      vfsDir: this.o.vfsDir ?? WEB_DEFAULTS.vfsDir,
      filesDir: this.o.filesDir ?? WEB_DEFAULTS.filesDir,
      dbName: this.o.dbName ?? WEB_DEFAULTS.dbName,
    };
    try {
      await this.#call('open', [cfg]);
    } catch (err) {
      w.terminate();
      this.#worker = undefined;
      throw err;
    }
  }
  async exec(sql: string, params: readonly unknown[]): Promise<void> {
    await this.#call('exec', [sql, [...params]]);
  }
  async query(sql: string, params: readonly unknown[]): Promise<Row[]> {
    return (await this.#call('query', [sql, [...params]])) as Row[];
  }
  async writeFile(ref: string, bytes: Uint8Array): Promise<void> {
    const buf = toArrayBuffer(bytes);
    await this.#call('writeFile', [ref, new Uint8Array(buf)], [buf]);
  }
  async readFile(ref: string): Promise<Uint8Array> {
    return (await this.#call('readFile', [ref])) as Uint8Array;
  }
  async removeFile(ref: string): Promise<void> {
    await this.#call('removeFile', [ref]);
  }
  async usage(): Promise<{ used: number; quota?: number }> {
    return (await this.#call('usage')) as { used: number; quota?: number };
  }
  async close(): Promise<void> {
    try {
      await this.#call('close');
    } finally {
      this.#worker?.terminate();
      this.#worker = undefined;
    }
  }
}

export class WebStorageAdapter extends SqlAdapterBase implements StorageAdapter {
  constructor(opts: WebAdapterOptions = {}) {
    super(new WebDriver(opts), opts);
  }
}

/**
 * Asks the browser not to evict our storage (SPEC Sec 6). Called from the app shell together with
 * the one-time "browser storage can be cleared" note, not from init(), so no permission prompt
 * appears before the user sees why.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}
