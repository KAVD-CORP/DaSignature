import { fromBase64, toBase64 } from '../bytes.ts';
import { FileNotFoundError, StorageError } from '../errors.ts';
import type { Row, SecureKeyStore, StorageAdapter } from '../types.ts';
import { SqlAdapterBase, type AdapterOptions, type SqlDriver } from './base.ts';

/**
 * Desktop (SPEC Sec 6): rusqlite + SQLCipher in the Tauri core (apps/desktop/src-tauri/src/storage.rs),
 * files in the app data dir. The key lives in the OS credential store and never reaches JS unless
 * init() is given one. apps/desktop injects `invoke` from @tauri-apps/api/core (ARCH-01).
 *
 * Wire format (JSON over IPC): BLOB values in params and rows are `{ "$blob": "<base64>" }`;
 * file bytes are base64 strings.
 */
export type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export const TAURI_COMMANDS = [
  'storage_open',
  'storage_exec',
  'storage_query',
  'storage_put_file',
  'storage_get_file',
  'storage_delete_file',
  'storage_usage',
  'storage_close',
  'secure_key_get_or_create',
  'secure_key_delete',
] as const;

export function encodeValue(v: unknown): unknown {
  if (v instanceof Uint8Array) return { $blob: toBase64(v) };
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return Number(v);
  return v ?? null;
}
export function decodeValue(v: unknown): unknown {
  if (v !== null && typeof v === 'object' && '$blob' in v) return fromBase64(String(v.$blob));
  return v;
}

class TauriDriver implements SqlDriver {
  constructor(private readonly invoke: TauriInvoke) {}
  async open(key: CryptoKey | string | undefined): Promise<void> {
    if (key !== undefined && typeof key !== 'string')
      throw new StorageError('native storage needs a string key');
    await this.invoke('storage_open', { key: key ?? null });
  }
  async exec(sql: string, params: readonly unknown[]): Promise<void> {
    await this.invoke('storage_exec', { sql, params: params.map(encodeValue) });
  }
  async query(sql: string, params: readonly unknown[]): Promise<Row[]> {
    const rows = (await this.invoke('storage_query', {
      sql,
      params: params.map(encodeValue),
    })) as Row[];
    return rows.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, decodeValue(v)])),
    );
  }
  async writeFile(ref: string, bytes: Uint8Array): Promise<void> {
    await this.invoke('storage_put_file', { fileRef: ref, data: toBase64(bytes) });
  }
  async readFile(ref: string): Promise<Uint8Array> {
    const data = (await this.invoke('storage_get_file', { fileRef: ref })) as string | null;
    if (data === null) throw new FileNotFoundError(ref);
    return fromBase64(data);
  }
  async removeFile(ref: string): Promise<void> {
    await this.invoke('storage_delete_file', { fileRef: ref });
  }
  async usage(): Promise<{ used: number; quota?: number }> {
    return (await this.invoke('storage_usage')) as { used: number; quota?: number };
  }
  async close(): Promise<void> {
    await this.invoke('storage_close');
  }
}

export class TauriStorageAdapter extends SqlAdapterBase implements StorageAdapter {
  constructor(invoke: TauriInvoke, opts?: AdapterOptions) {
    super(new TauriDriver(invoke), opts);
  }
}

/**
 * Desktop SecureKeyStore (M3): named 32-byte secrets in the OS credential store via the Tauri core
 * (apps/desktop/src-tauri/src/secrets.rs). Used for the column data key (`dasig.dek`) through
 * NativeKeyManager; the SQLCipher database key is a separate entry that never reaches JS.
 */
export class TauriSecureKeyStore implements SecureKeyStore {
  constructor(private readonly invoke: TauriInvoke) {}
  async getOrCreateSecret(name: string): Promise<Uint8Array> {
    const b64 = await this.invoke('secure_key_get_or_create', { name });
    if (typeof b64 !== 'string') throw new StorageError('secure key store returned no secret');
    const bytes = fromBase64(b64);
    if (bytes.length !== 32) throw new StorageError('secure key store returned a malformed secret');
    return bytes;
  }
  async deleteSecret(name: string): Promise<void> {
    await this.invoke('secure_key_delete', { name });
  }
}
