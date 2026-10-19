import { randomBytes, toArrayBuffer } from '../bytes.ts';
import { LockedError, StorageError, WrongPasswordError } from '../errors.ts';
import type { SecureKeyStore } from '../types.ts';
import { deriveKeyBytes, newKdfParams, type KdfParams } from './kdf.ts';
import { importAesKey, Vault } from './vault.ts';

/**
 * Key hierarchy (SPEC Sec 6, PM #17/#18):
 * - One random 256-bit data-encryption key (DEK) encrypts fields and blobs (Vault).
 * - The DEK is stored only wrapped (AES-KW):
 *   - no app lock: by a device-bound key-encryption key. On web that is a non-extractable
 *     AES-KW CryptoKey kept in IndexedDB (the browser never exposes its bytes);
 *   - app lock on: by a key derived from the passcode (Argon2id, PBKDF2 fallback). The device
 *     record is deleted, so the DEK cannot be recovered without the passcode.
 * Native platforms keep the DEK in the OS keystore instead (NativeKeyManager).
 */

/** Small persistent key/value store that can hold CryptoKey objects (IndexedDB on web). */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryKeyValueStore implements KeyValueStore {
  readonly map = new Map<string, unknown>();
  get(key: string): Promise<unknown> {
    return Promise.resolve(this.map.get(key));
  }
  set(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }
}

/** IndexedDB-backed store (one object store, structured clone keeps CryptoKey non-extractable). */
export class IdbKeyValueStore implements KeyValueStore {
  #db: Promise<IDBDatabase> | undefined;
  constructor(private readonly dbName = 'dasig-keys') {}

  #open(): Promise<IDBDatabase> {
    this.#db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        resolve(req.result);
      };
      req.onerror = () => {
        reject(req.error ?? new StorageError('indexedDB open failed'));
      };
    });
    return this.#db;
  }
  async #run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.#open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const req = op(tx.objectStore('kv'));
      tx.oncomplete = () => {
        resolve(req.result as T);
      };
      tx.onerror = () => {
        reject(tx.error ?? new StorageError('indexedDB request failed'));
      };
    });
  }
  get(key: string): Promise<unknown> {
    return this.#run('readonly', (s) => s.get(key));
  }
  async set(key: string, value: unknown): Promise<void> {
    await this.#run('readwrite', (s) => s.put(value, key));
  }
  async delete(key: string): Promise<void> {
    await this.#run('readwrite', (s) => s.delete(key));
  }
  close(): void {
    void this.#db?.then((d) => {
      d.close();
    });
    this.#db = undefined;
  }
}

interface DeviceRecord {
  mode: 'device';
  kek: CryptoKey;
  wrapped: Uint8Array;
}
interface PasscodeRecord {
  mode: 'passcode';
  kdf: KdfParams;
  wrapped: Uint8Array;
}
type KeyRecord = DeviceRecord | PasscodeRecord;
const RECORD = 'dek';

async function newDek(): Promise<CryptoKey> {
  // Extractable only for the moment it takes to wrap it; the Vault gets a non-extractable copy.
  return importAesKey(randomBytes(32), true);
}
async function wrap(dek: CryptoKey, kek: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.wrapKey('raw', dek, kek, 'AES-KW'));
}
async function unwrap(
  wrapped: Uint8Array,
  kek: CryptoKey,
  extractable: boolean,
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    toArrayBuffer(wrapped),
    kek,
    'AES-KW',
    'AES-GCM',
    extractable,
    ['encrypt', 'decrypt'],
  );
}
async function passcodeKek(passcode: string, kdf: KdfParams): Promise<CryptoKey> {
  const bytes = await deriveKeyBytes(passcode, kdf);
  return crypto.subtle.importKey('raw', toArrayBuffer(bytes), 'AES-KW', false, [
    'wrapKey',
    'unwrapKey',
  ]);
}

/**
 * Web key manager. Vaults it returns hold a NON-extractable data key; the key is only ever
 * unwrapped as extractable transiently, to re-wrap it when the passcode changes.
 */
export class WebKeyManager {
  constructor(
    private readonly kv: KeyValueStore,
    /** Override only in tests (fast KDF); production uses PM #18 Argon2id. */
    private readonly kdfParams: () => KdfParams = () => newKdfParams(),
  ) {}

  async #record(): Promise<KeyRecord | undefined> {
    return (await this.kv.get(RECORD)) as KeyRecord | undefined;
  }

  async mode(): Promise<'new' | 'device' | 'passcode'> {
    return (await this.#record())?.mode ?? 'new';
  }

  /** No app lock: returns the vault, creating the DEK and device key on first run. */
  async unlock(): Promise<Vault> {
    return new Vault(await this.#dek(undefined, false));
  }

  async unlockWithPasscode(passcode: string): Promise<Vault> {
    return new Vault(await this.#dek(passcode, false));
  }

  /** Turns the app lock on, or changes it (then `current` is the old passcode). */
  async setPasscode(passcode: string, current?: string): Promise<void> {
    if (passcode.length < 4) throw new RangeError('passcode too short');
    const dek = await this.#dek(current, true);
    const kdf = this.kdfParams();
    const record: PasscodeRecord = {
      mode: 'passcode',
      kdf,
      wrapped: await wrap(dek, await passcodeKek(passcode, kdf)),
    };
    await this.kv.set(RECORD, record);
  }

  /** Turns the app lock off: the DEK goes back under a device-bound key. */
  async clearPasscode(passcode: string): Promise<void> {
    await this.#storeDevice(await this.#dek(passcode, true));
  }

  async #dek(passcode: string | undefined, extractable: boolean): Promise<CryptoKey> {
    const rec = await this.#record();
    if (!rec) {
      const dek = await newDek();
      await this.#storeDevice(dek);
      if (extractable) return dek;
      const created = (await this.#record()) as DeviceRecord;
      return unwrap(created.wrapped, created.kek, false);
    }
    if (rec.mode === 'device') return unwrap(rec.wrapped, rec.kek, extractable);
    if (passcode === undefined) throw new LockedError('app lock is on; unlock with the passcode');
    try {
      return await unwrap(rec.wrapped, await passcodeKek(passcode, rec.kdf), extractable);
    } catch {
      throw new WrongPasswordError('wrong passcode');
    }
  }

  async #storeDevice(dek: CryptoKey): Promise<void> {
    const kek = await crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, false, [
      'wrapKey',
      'unwrapKey',
    ]);
    const record: DeviceRecord = { mode: 'device', kek, wrapped: await wrap(dek, kek) };
    await this.kv.set(RECORD, record);
  }
}

/**
 * Native (Capacitor, Tauri): the DEK and the SQLCipher key are random 256-bit secrets in the OS
 * keystore (Keychain, Android Keystore, Windows Credential Manager, macOS Keychain, Secret Service).
 */
export class NativeKeyManager {
  constructor(private readonly keys: SecureKeyStore) {}
  async unlock(): Promise<Vault> {
    return new Vault(await importAesKey(await this.keys.getOrCreateSecret('dasig.dek'), false));
  }
}

/** PM #19 auto-lock choices in minutes (0 = immediately, null = never) and the default. */
export const AUTO_LOCK_OPTIONS = [0, 1, 5, 15, 30, null] as const;
export type AutoLockMinutes = (typeof AUTO_LOCK_OPTIONS)[number];
export const AUTO_LOCK_DEFAULT: AutoLockMinutes = 5;

/** Anything a DataStore can get its vault from. */
export interface VaultSource {
  /** The unlocked vault; throws LockedError while locked. */
  vault(): Vault;
}

/**
 * Storage-level app lock (SPEC Sec 6, PM #18/#19). Holds the data key in memory only while
 * unlocked; lock() drops it so every read and write fails with LockedError until unlock.
 * The M7 UI (passcode sheet, biometrics, auto-lock timer) drives this.
 */
export class AppLock implements VaultSource {
  #vault: Vault | undefined;
  constructor(private readonly keys: WebKeyManager) {}

  /** At app start: unlocks silently when no passcode is set; stays locked otherwise. */
  async resume(): Promise<boolean> {
    if ((await this.keys.mode()) === 'passcode') return false;
    this.#vault = await this.keys.unlock();
    return true;
  }
  async unlock(passcode: string): Promise<void> {
    this.#vault = await this.keys.unlockWithPasscode(passcode);
  }
  lock(): void {
    this.#vault = undefined;
  }
  isUnlocked(): boolean {
    return this.#vault !== undefined;
  }
  async setPasscode(passcode: string, current?: string): Promise<void> {
    await this.keys.setPasscode(passcode, current);
  }
  async clearPasscode(passcode: string): Promise<void> {
    await this.keys.clearPasscode(passcode);
  }
  vault(): Vault {
    if (!this.#vault) throw new LockedError('DaSignature is locked');
    return this.#vault;
  }
}
