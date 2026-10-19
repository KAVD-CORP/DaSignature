import { FileNotFoundError, StorageError } from '../errors.ts';
import type { Row, SecureKeyStore, StorageAdapter } from '../types.ts';
import { SqlAdapterBase, type AdapterOptions, type SqlDriver } from './base.ts';

/**
 * iOS/Android (SPEC Sec 6): native SQLite + SQLCipher through the Capacitor SQLite plugin, files in
 * the app sandbox. This package never imports Capacitor: apps/mobile implements these two bridges
 * with @capacitor-community/sqlite and @capacitor/filesystem and injects them (ARCH-01).
 */
export interface CapacitorSqliteBridge {
  /** Opens (creating if needed) an encrypted database with this SQLCipher passphrase. */
  open(opts: { database: string; passphrase: string }): Promise<void>;
  /** Runs one statement with bound values (no plugin-side implicit transaction). */
  run(statement: string, values: unknown[]): Promise<void>;
  query(statement: string, values: unknown[]): Promise<Row[]>;
  close(): Promise<void>;
}

export interface CapacitorFilesBridge {
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** Resolves null when the file does not exist. */
  read(path: string): Promise<Uint8Array | null>;
  remove(path: string): Promise<void>;
  usage(): Promise<{ used: number; quota?: number }>;
}

export interface CapacitorAdapterOptions extends AdapterOptions {
  sqlite: CapacitorSqliteBridge;
  files: CapacitorFilesBridge;
  /** Supplies the SQLCipher key when init() is called without one (Keychain / Keystore). */
  keyStore?: SecureKeyStore;
  database?: string;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

class CapacitorDriver implements SqlDriver {
  constructor(private readonly o: CapacitorAdapterOptions) {}
  async open(key: CryptoKey | string | undefined): Promise<void> {
    if (key !== undefined && typeof key !== 'string')
      throw new StorageError('native storage needs a string key');
    const passphrase =
      key ??
      (this.o.keyStore ? hex(await this.o.keyStore.getOrCreateSecret('dasig.db')) : undefined);
    if (!passphrase)
      throw new StorageError('no database key (pass one to init() or provide keyStore)');
    await this.o.sqlite.open({ database: this.o.database ?? 'dasignature', passphrase });
    await this.o.sqlite.run('PRAGMA foreign_keys = ON', []);
  }
  exec(sql: string, params: readonly unknown[]) {
    return this.o.sqlite.run(sql, [...params]);
  }
  query(sql: string, params: readonly unknown[]) {
    return this.o.sqlite.query(sql, [...params]);
  }
  writeFile(ref: string, bytes: Uint8Array) {
    return this.o.files.write(`files/${ref}`, bytes);
  }
  async readFile(ref: string): Promise<Uint8Array> {
    const b = await this.o.files.read(`files/${ref}`);
    if (!b) throw new FileNotFoundError(ref);
    return b;
  }
  removeFile(ref: string) {
    return this.o.files.remove(`files/${ref}`);
  }
  usage() {
    return this.o.files.usage();
  }
  close() {
    return this.o.sqlite.close();
  }
}

export class CapacitorStorageAdapter extends SqlAdapterBase implements StorageAdapter {
  constructor(opts: CapacitorAdapterOptions) {
    super(new CapacitorDriver(opts), opts);
  }
}
