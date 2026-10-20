/**
 * Platform wiring (SPEC Sec 4: UI never imports Capacitor or Tauri). The shells expose a tiny
 * bridge on window: Tauri's built-in `__TAURI_INTERNALS__.invoke`, and on mobile the Capacitor
 * runtime's plugin proxies. Everything else is the web build.
 */
import {
  AppLock,
  DataStore,
  IdbKeyValueStore,
  NativeKeyManager,
  TauriSecureKeyStore,
  TauriStorageAdapter,
  WebKeyManager,
  WebStorageAdapter,
  requestPersistentStorage,
  toBase64,
  type FileAdapter,
  type ShareAdapter,
  type StorageAdapter,
  type TauriInvoke,
  type VaultSource,
} from '@dasignature/storage';
import { webFiles, webShare } from './files.ts';

export type PlatformKind = 'web' | 'desktop' | 'mobile';

export interface Services {
  kind: PlatformKind;
  store: DataStore;
  /** Present on web: the passcode-capable lock. Native locks are M7 (biometric gate). */
  lock: AppLock | undefined;
  files: FileAdapter;
  /** OS share sheet (Web Share with files where supported). */
  share: ShareAdapter | undefined;
  /** Web only: asks the browser not to evict storage (SPEC Sec 6). */
  persist: (() => Promise<boolean>) | undefined;
}

interface TauriWindow {
  __TAURI_INTERNALS__?: { invoke: TauriInvoke };
}
interface CapacitorWindow {
  Capacitor?: { isNativePlatform?: () => boolean };
}

export function detectPlatform(w: unknown = globalThis): PlatformKind {
  if ((w as TauriWindow).__TAURI_INTERNALS__) return 'desktop';
  if ((w as CapacitorWindow).Capacitor?.isNativePlatform?.()) return 'mobile';
  return 'web';
}

export type ServiceFactory = () => Promise<Services>;

async function open(db: StorageAdapter, keys: VaultSource) {
  await db.init({});
  return DataStore.open(db, keys);
}

export const createServices: ServiceFactory = async () => {
  const kind = detectPlatform();
  if (kind === 'desktop') {
    const invoke = (globalThis as TauriWindow).__TAURI_INTERNALS__?.invoke;
    if (!invoke) throw new Error('Tauri bridge missing');
    const vault = await new NativeKeyManager(new TauriSecureKeyStore(invoke)).unlock();
    const store = await open(new TauriStorageAdapter(invoke), { vault: () => vault });
    return {
      kind,
      store,
      lock: undefined,
      files: desktopFiles(invoke),
      share: webShare(),
      persist: undefined,
    };
  }
  if (kind === 'mobile') {
    const { createMobileServices } = await import('./mobile.ts');
    return createMobileServices();
  }
  return webServices();
};

/** The browser build (also the mobile fallback when the native plugin is missing). */
export async function webServices(): Promise<Services> {
  const lock = new AppLock(new WebKeyManager(new IdbKeyValueStore()));
  await lock.resume();
  const store = await open(new WebStorageAdapter(), lock);
  return {
    kind: 'web',
    store,
    lock,
    files: webFiles(),
    share: webShare(),
    persist: requestPersistentStorage,
  };
}

/** Desktop: the web picker, but exports go through the native Save dialog (shell.rs save_file). */
function desktopFiles(invoke: TauriInvoke): FileAdapter {
  const web = webFiles();
  return {
    pickPdf: () => web.pickPdf(),
    async saveFile(name, bytes) {
      const savedAs = (await invoke('save_file', { name, data: toBase64(bytes) })) as string | null;
      return savedAs === null ? null : { savedAs };
    },
  };
}
