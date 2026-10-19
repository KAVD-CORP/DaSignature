/**
 * Platform interfaces (SPEC Sec 4, Sec 6). UI and core code depend only on these; the
 * platform-specific implementations live in ./adapters and get their native bridge injected,
 * so nothing here imports Capacitor or Tauri (ARCH-01).
 */

/** One result row: column name -> SQLite value. */
export type Row = Record<string, unknown>;

/** SQL parameter values the adapters accept (SQLite storage classes). */
export type SqlParam = string | number | bigint | boolean | null | Uint8Array;

/**
 * StorageAdapter, exactly as SPEC Sec 6 defines it. Two documented extensions that keep it
 * source-compatible with the spec signature:
 * - `transaction` passes a transaction-bound handle to `fn`. Inside `fn`, do all work through
 *   that handle; its own `transaction()` is a nested SAVEPOINT that joins the outer transaction.
 *   Calls on the outer adapter while a transaction runs wait for it to finish (no interleaved
 *   writes); if such a call waits longer than `lockTimeoutMs` it rejects with StorageBusyError
 *   (this is what happens if `fn` mistakenly calls the outer adapter: it fails, it never hangs).
 * - `close()` releases the database and file handles (needed for close + reopen, PERSIST-01).
 */
export interface StorageAdapter {
  init(opts: { key?: CryptoKey | string }): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<T>;
  putFile(bytes: Uint8Array, hint?: string): Promise<string>;
  getFile(ref: string): Promise<Uint8Array>;
  deleteFile(ref: string): Promise<void>;
  usage(): Promise<{ used: number; quota?: number }>;
  close(): Promise<void>;
}

/**
 * Secure storage for small secrets (OS keychain / keystore / credential store, or the browser's
 * non-extractable key storage). Used for the database key and the data-encryption key.
 */
export interface SecureKeyStore {
  /** Returns the 32-byte secret stored under `name`, creating a random one on first use. */
  getOrCreateSecret(name: string): Promise<Uint8Array>;
  deleteSecret(name: string): Promise<void>;
}

/* ---- ADP-02: interface definitions (implemented in M3, M6, M7; contract suites then) ---- */

/** Picking and opening files from the device (M3). */
export interface FileAdapter {
  pickPdf(): Promise<{ name: string; bytes: Uint8Array } | null>;
  saveFile(name: string, bytes: Uint8Array, mime: string): Promise<{ savedAs: string } | null>;
}

/** Handing a file to the OS share sheet (M6). */
export interface ShareAdapter {
  canShare(): Promise<boolean>;
  shareFile(name: string, bytes: Uint8Array, mime: string): Promise<'shared' | 'cancelled'>;
}

/** Biometric unlock (M7). */
export interface BiometricAdapter {
  isAvailable(): Promise<boolean>;
  authenticate(reason: string): Promise<boolean>;
}
