import { create } from 'zustand';
import type { DocumentRecord } from '@dasignature/storage';
import type { Services } from '../services/platform.ts';

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  tone?: 'info' | 'error';
}

export interface PasswordRequest {
  retry: boolean;
  resolve: (pw: string | null) => void;
}

export interface Opening {
  name: string;
  large: boolean;
  cancel: () => void;
}

interface AppState {
  status: 'booting' | 'ready' | 'locked' | 'error';
  services: Services | undefined;
  docs: DocumentRecord[];
  /** Ids hidden while their delete can still be undone. */
  pendingDelete: string[];
  toast: Toast | undefined;
  opening: Opening | undefined;
  password: PasswordRequest | undefined;
  alert: string | undefined;
  persistNote: boolean;
  /** Bumped when the app-lock mode changes (Settings re-reads it). */
  lockTick: number;
  bumpLock: () => void;
  set: (patch: Partial<AppState>) => void;
  showToast: (t: Omit<Toast, 'id'>) => void;
  refreshDocs: () => Promise<void>;
}

let toastId = 0;

export const useApp = create<AppState>()((set, get) => ({
  status: 'booting',
  services: undefined,
  docs: [],
  pendingDelete: [],
  toast: undefined,
  opening: undefined,
  password: undefined,
  alert: undefined,
  persistNote: false,
  lockTick: 0,
  bumpLock: () => {
    set({ lockTick: get().lockTick + 1 });
  },
  set: (patch) => {
    set(patch);
  },
  showToast: (t) => {
    set({ toast: { ...t, id: ++toastId } });
  },
  refreshDocs: async () => {
    const s = get().services;
    if (!s) return;
    set({ docs: await s.store.listDocuments() });
  },
}));

/** Ask the user for a PDF password through the shared dialog. */
export function askPassword(retry: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    useApp.getState().set({
      password: {
        retry,
        resolve: (pw) => {
          useApp.getState().set({ password: undefined });
          resolve(pw);
        },
      },
    });
  });
}
