/**
 * Storage package placeholder (Milestone 1).
 * The StorageAdapter interface, adapters (SQLite WASM + OPFS, native SQLite)
 * and migrations land in Milestone 2 (SPEC Sec 6, 12).
 */
export const STORAGE_BACKENDS = {
  web: 'sqlite-wasm-opfs',
  mobile: 'capacitor-sqlite',
  desktop: 'tauri-rusqlite',
} as const;

export type StorageBackend = (typeof STORAGE_BACKENDS)[keyof typeof STORAGE_BACKENDS];
