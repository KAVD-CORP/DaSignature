/** In-memory services for unit tests (jsdom has no OPFS). */
import { DataStore, MemoryStorageAdapter, Vault } from '@dasignature/storage';
import type { Services } from './services/platform.ts';
import { webFiles } from './services/files.ts';

export async function memoryServices(): Promise<Services> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const db = new MemoryStorageAdapter();
  await db.init({});
  const store = await DataStore.open(db, new Vault(key));
  return {
    kind: 'web',
    store,
    lock: undefined,
    files: webFiles(),
    share: undefined,
    persist: undefined,
  };
}
