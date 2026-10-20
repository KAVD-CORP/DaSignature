/** @dasignature/storage: StorageAdapter and platform adapters, schema, encryption at rest, .dasig backups. */
export type * from './types.ts';
export * from './errors.ts';
export { uuidv7, UUID_V7 } from './ids.ts';
export {
  MIGRATIONS,
  SCHEMA_VERSION,
  TABLES,
  migrate,
  schemaVersion,
  type Migration,
  type TableName,
} from './schema.ts';
export { ENCRYPTED_COLUMNS, ENCRYPTED_SETTINGS, FILE_COLUMNS } from './fields.ts';
export { SqlAdapterBase, type AdapterOptions, type SqlDriver } from './adapters/base.ts';
export { MemoryBackend, MemoryStorageAdapter } from './adapters/memory.ts';
export {
  WebStorageAdapter,
  WEB_DEFAULTS,
  requestPersistentStorage,
  type WebAdapterOptions,
} from './adapters/web.ts';
export {
  CapacitorStorageAdapter,
  type CapacitorAdapterOptions,
  type CapacitorFilesBridge,
  type CapacitorSqliteBridge,
} from './adapters/capacitor.ts';
export {
  TauriSecureKeyStore,
  TauriStorageAdapter,
  TAURI_COMMANDS,
  encodeValue,
  decodeValue,
  type TauriInvoke,
} from './adapters/tauri.ts';
export { toBase64, fromBase64 } from './bytes.ts';
export { Vault, IV_BYTES, TAG_BYTES } from './crypto/vault.ts';
export { ARGON2ID, PBKDF2_ITERATIONS, newKdfParams, type KdfParams } from './crypto/kdf.ts';
export {
  AppLock,
  AUTO_LOCK_DEFAULT,
  AUTO_LOCK_OPTIONS,
  WebKeyManager,
  NativeKeyManager,
  IdbKeyValueStore,
  MemoryKeyValueStore,
  type KeyValueStore,
  type VaultSource,
  type AutoLockMinutes,
} from './crypto/keys.ts';
export {
  DataStore,
  type DocumentRecord,
  type ExportRecord,
  type NewSignature,
  type PlacementRecord,
  type PlainDump,
  type SignatureRecord,
} from './datastore.ts';
export {
  createBackup,
  openBackup,
  readManifest,
  restoreBackup,
  DASIG_VERSION,
  MANIFEST_FIELDS,
  type DasigManifest,
} from './backup.ts';

/** Storage backend per platform (SPEC Sec 6). */
export const STORAGE_BACKENDS = {
  web: 'sqlite-wasm-opfs',
  mobile: 'capacitor-sqlite',
  desktop: 'tauri-rusqlite',
} as const;
