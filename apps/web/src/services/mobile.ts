/**
 * Mobile wiring (M8, SPEC Sec 6): SQLite + SQLCipher, sandbox files and an Android-Keystore-wrapped
 * secret, all through the app's own `DaSignatureNative` Capacitor plugin. Bytes cross the bridge
 * as base64 and SQL values in the Tauri wire format ({$blob}). Without the plugin (iOS until its
 * native plugin lands, see docs/decisions.md) the webview uses the web storage engine.
 */
import {
  CapacitorStorageAdapter,
  DataStore,
  NativeKeyManager,
  StorageError,
  decodeValue,
  encodeValue,
  fromBase64,
  toBase64,
  type CapacitorFilesBridge,
  type CapacitorSqliteBridge,
  type FileAdapter,
  type Row,
  type SecureKeyStore,
  type ShareAdapter,
} from '@dasignature/storage';
import { pickFiles } from './files.ts';
import { mobileNative, type MobileNative } from './native.ts';
import type { Services } from './platform.ts';

export function sqliteBridge(n: MobileNative): CapacitorSqliteBridge {
  return {
    open: (o) => n.dbOpen(o),
    run: (sql, values) => n.dbRun({ sql, values: values.map(encodeValue) }),
    async query(sql, values) {
      const { rows } = await n.dbQuery({ sql, values: values.map(encodeValue) });
      return rows.map((r): Row =>
        Object.fromEntries(Object.entries(r).map(([k, v]) => [k, decodeValue(v)])),
      );
    },
    close: () => n.dbClose(),
  };
}

export function filesBridge(n: MobileNative): CapacitorFilesBridge {
  return {
    write: (path, bytes) => n.fileWrite({ path, data: toBase64(bytes) }),
    async read(path) {
      const { data } = await n.fileRead({ path });
      return data === null ? null : fromBase64(data);
    },
    remove: (path) => n.fileRemove({ path }),
    usage: () => n.usage(),
  };
}

export function keyStore(n: MobileNative): SecureKeyStore {
  return {
    async getOrCreateSecret(name) {
      const bytes = fromBase64((await n.secretGetOrCreate({ name })).secret);
      if (bytes.length !== 32)
        throw new StorageError('secure key store returned a malformed secret');
      return bytes;
    },
    deleteSecret: (name) => n.secretDelete({ name }),
  };
}

function files(n: MobileNative): FileAdapter {
  return {
    async pickPdf() {
      const [file] = await pickFiles();
      if (!file) return null;
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    },
    async saveFile(name, bytes, mime) {
      const { savedAs } = await n.saveFile({ name, data: toBase64(bytes), mime });
      return savedAs === null ? null : { savedAs };
    },
  };
}

function share(n: MobileNative): ShareAdapter {
  return {
    canShare: () => Promise.resolve(true),
    async shareFile(name, bytes, mime) {
      const { shared } = await n.shareFile({ name, data: toBase64(bytes), mime });
      return shared ? 'shared' : 'cancelled';
    },
  };
}

export async function createMobileServices(): Promise<Services> {
  const n = mobileNative();
  if (!n) {
    const { webServices } = await import('./platform.ts');
    return { ...(await webServices()), kind: 'mobile' };
  }
  const keys = keyStore(n);
  const vault = await new NativeKeyManager(keys).unlock();
  const db = new CapacitorStorageAdapter({
    sqlite: sqliteBridge(n),
    files: filesBridge(n),
    keyStore: keys,
  });
  await db.init({});
  const store = await DataStore.open(db, { vault: () => vault });
  return {
    kind: 'mobile',
    store,
    lock: undefined,
    files: files(n),
    share: share(n),
    persist: undefined,
  };
}
