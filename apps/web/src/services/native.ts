/**
 * The two native bridges, reached through window globals only (SPEC Sec 4: the UI never imports
 * Tauri or Capacitor). Desktop: Tauri's `__TAURI_INTERNALS__.invoke`. Mobile: the Capacitor
 * runtime's proxy for the app's own `DaSignatureNative` plugin (apps/mobile/android, M8).
 */
import type { TauriInvoke } from '@dasignature/storage';

interface TauriWindow {
  __TAURI_INTERNALS__?: { invoke: TauriInvoke };
}

export interface NativeFile {
  name: string;
  /** base64 */
  data: string;
}

/** Methods of the Android `DaSignatureNative` Capacitor plugin (DaSignatureNativePlugin.java). */
export interface MobileNative {
  dbOpen(o: { database: string; passphrase: string }): Promise<void>;
  dbRun(o: { sql: string; values: unknown[] }): Promise<void>;
  dbQuery(o: { sql: string; values: unknown[] }): Promise<{ rows: Record<string, unknown>[] }>;
  dbClose(): Promise<void>;
  fileWrite(o: { path: string; data: string }): Promise<void>;
  fileRead(o: { path: string }): Promise<{ data: string | null }>;
  fileRemove(o: { path: string }): Promise<void>;
  usage(): Promise<{ used: number }>;
  secretGetOrCreate(o: { name: string }): Promise<{ secret: string }>;
  secretDelete(o: { name: string }): Promise<void>;
  takeOpenedFiles(): Promise<{ files: NativeFile[] }>;
  saveFile(o: { name: string; data: string; mime: string }): Promise<{ savedAs: string | null }>;
  shareFile(o: { name: string; data: string; mime: string }): Promise<{ shared: boolean }>;
  addListener(event: 'opened', cb: () => void): Promise<{ remove: () => Promise<void> }>;
}

interface CapacitorWindow {
  Capacitor?: { Plugins?: { DaSignatureNative?: MobileNative } };
}

export function tauriInvoke(): TauriInvoke | undefined {
  return (globalThis as TauriWindow).__TAURI_INTERNALS__?.invoke;
}

export function mobileNative(): MobileNative | undefined {
  return (globalThis as CapacitorWindow).Capacitor?.Plugins?.DaSignatureNative;
}
