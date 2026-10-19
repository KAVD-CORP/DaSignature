// QA storage contract: shared types (SPEC Sec 6). Drop-in for packages/storage/test/ (Vitest).
// The StorageAdapter interface is SPEC Sec 6 plus the two source-compatible extensions the Engineer documented in
// packages/storage/src/types.ts (read 2026-10-19, uncommitted M2 work): transaction() passes a transaction-bound handle
// `tx` to fn (outer-adapter calls wait / reject StorageBusyError while a transaction runs), and close().
// The suite therefore does ALL work inside a transaction through `tx`, falling back to the adapter itself when an
// implementation passes no handle (spec-verbatim `fn: () => Promise<T>`), so it fits both shapes.
export interface StorageAdapter {
  init(opts: { key?: CryptoKey | string }): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
  putFile(bytes: Uint8Array, hint?: string): Promise<string>;
  getFile(ref: string): Promise<Uint8Array>;
  deleteFile(ref: string): Promise<void>;
  usage(): Promise<{ used: number; quota?: number }>;
}

/** One harness per adapter implementation. The suite never touches platform APIs directly. */
export interface AdapterHarness {
  /** Open (or reopen) an adapter over the SAME backing store and call init() with `initOpts`. */
  open(): Promise<StorageAdapter>;
  /** Release an instance (close the DB, terminate the worker). The backing store MUST survive (PERSIST-01). */
  close(adapter: StorageAdapter): Promise<void>;
  /** Delete the backing store entirely (fresh state for the next test). */
  destroy(): Promise<void>;
  /** What open() passes to init(); the idempotency case calls init() again with the same value. */
  initOpts: { key?: CryptoKey | string };
}

export interface ContractOptions {
  /** Bytes for the "large file" case. Default 50 MiB (SPEC Sec 3.1 import limit). Lower ONLY with a PM waiver id in `waivers`. */
  largeFileBytes?: number;
  /** Case ids waived by PM, each mapped to the PM decision that waived it, e.g. { 'ADP-01-C09-50MiB': 'PM #70' }. */
  waivers?: Record<string, string>;
  /** Per-case timeout in ms (native bridges are slow). Default 120 000. */
  timeoutMs?: number;
}

/** Row and file snapshot used by migration and backup contracts. */
export interface Snapshot {
  /** table name -> rows sorted by primary key, every column, as returned by the adapter (decrypted view). */
  tables: Record<string, Record<string, unknown>[]>;
  /** file_ref-independent: sha256 hex of every stored file reachable from the DB (documents/exports/signature images). */
  fileHashes: string[];
}
