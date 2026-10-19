/// <reference lib="webworker" />
/**
 * Web storage worker: SQLite (sqlite-wasm) on the OPFS "opfs-sahpool" VFS, plus file blobs in an
 * OPFS directory through synchronous access handles. Runs in a dedicated worker because both need
 * synchronous OPFS access. No network: sqlite3.wasm is bundled by Vite next to this worker.
 */
import { FileNotFoundError, StorageError } from '../errors.ts';
import { loadSqlite, sqlExec, sqlQuery, type SqliteDb } from './sqlite-wasm.ts';
import type { WorkerConfig, WorkerRequest, WorkerResponse } from './web-protocol.ts';

interface SyncHandle {
  read(buf: Uint8Array, opts?: { at: number }): number;
  write(buf: Uint8Array, opts?: { at: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}
type SyncFileHandle = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncHandle> };

let db: SqliteDb | undefined;
let filesDir: FileSystemDirectoryHandle | undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** OPFS handles of a just-terminated worker are released asynchronously; retry briefly. */
async function retry<T>(fn: () => Promise<T>, attempts = 40): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      await sleep(50);
    }
  }
}

async function open(cfg: WorkerConfig): Promise<void> {
  if (db) return;
  const sqlite3 = await loadSqlite();
  const pool = await retry(() =>
    sqlite3.installOpfsSAHPoolVfs({
      name: `sahpool-${cfg.vfsDir}`,
      directory: cfg.vfsDir,
      initialCapacity: 6,
    }),
  );
  db = new pool.OpfsSAHPoolDb(`/${cfg.dbName}`);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE;');
  const root = await navigator.storage.getDirectory();
  filesDir = await root.getDirectoryHandle(cfg.filesDir, { create: true });
}

function need<T>(v: T | undefined): T {
  if (v === undefined) throw new StorageError('storage worker is not open');
  return v;
}

async function withHandle<T>(ref: string, create: boolean, fn: (h: SyncHandle) => T): Promise<T> {
  let fh: SyncFileHandle;
  try {
    fh = await need(filesDir).getFileHandle(ref, { create });
  } catch (err) {
    if ((err as DOMException).name === 'NotFoundError') throw new FileNotFoundError(ref);
    throw err;
  }
  const h = await retry(() => fh.createSyncAccessHandle(), 10);
  try {
    return fn(h);
  } finally {
    h.close();
  }
}

async function usage(): Promise<{ used: number; quota?: number }> {
  const d = need(db);
  const [p] = sqlQuery(
    d,
    'SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()',
    [],
  );
  let used = Number(p?.n ?? 0);
  for await (const h of (
    need(filesDir) as unknown as { values(): AsyncIterable<FileSystemHandle> }
  ).values()) {
    if (h.kind === 'file') used += (await (h as FileSystemFileHandle).getFile()).size;
  }
  const est = await navigator.storage.estimate().catch(() => ({ quota: undefined }));
  return est.quota === undefined ? { used } : { used, quota: est.quota };
}

async function handle(req: WorkerRequest): Promise<unknown> {
  const a = req.args;
  switch (req.op) {
    case 'open':
      return open(a[0] as WorkerConfig);
    case 'exec': {
      sqlExec(need(db), a[0] as string, a[1] as unknown[]);
      return;
    }
    case 'query':
      return sqlQuery(need(db), a[0] as string, a[1] as unknown[]);
    case 'writeFile': {
      const bytes = a[1] as Uint8Array;
      return withHandle(a[0] as string, true, (h) => {
        h.truncate(0);
        let off = 0;
        while (off < bytes.length) off += h.write(bytes.subarray(off), { at: off });
        h.flush();
      });
    }
    case 'readFile':
      return withHandle(a[0] as string, false, (h) => {
        const out = new Uint8Array(h.getSize());
        let off = 0;
        while (off < out.length) {
          const n = h.read(out.subarray(off), { at: off });
          if (n <= 0) break;
          off += n;
        }
        return out;
      });
    case 'removeFile':
      try {
        await need(filesDir).removeEntry(a[0] as string);
      } catch (err) {
        if ((err as DOMException).name !== 'NotFoundError') throw err;
      }
      return undefined;
    case 'usage':
      return usage();
    case 'close':
      db?.close();
      db = undefined;
      filesDir = undefined;
      return undefined;
  }
}

// Requests are processed strictly in order (the main-thread adapter also serializes them).
let chain: Promise<void> = Promise.resolve();
self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  chain = chain.then(async () => {
    let res: WorkerResponse;
    const transfer: Transferable[] = [];
    try {
      const result = await handle(req);
      if (result instanceof Uint8Array) transfer.push(result.buffer);
      res = { id: req.id, ok: true, result };
    } catch (err) {
      const e = err as Error;
      res = {
        id: req.id,
        ok: false,
        error: { name: e.name || 'Error', message: e.message || String(err) },
      };
    }
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(res, transfer);
  });
};
