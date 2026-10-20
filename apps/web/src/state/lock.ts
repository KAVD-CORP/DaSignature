/** App lock runtime (PM #19): lock screen state and the auto-lock timer. */
import { AUTO_LOCK_DEFAULT, type AutoLockMinutes } from '@dasignature/storage';
import { useApp } from './app.ts';

export const AUTOLOCK_KEY = 'autolock';

export function parseAutoLock(v: string | undefined): AutoLockMinutes {
  if (v === 'never') return null;
  const n = Number(v);
  return v !== undefined && [0, 1, 5, 15, 30].includes(n)
    ? (n as AutoLockMinutes)
    : AUTO_LOCK_DEFAULT;
}

let hiddenAt: number | undefined;
let minutes: AutoLockMinutes = AUTO_LOCK_DEFAULT;

export function setAutoLock(m: AutoLockMinutes): void {
  minutes = m;
}

export function lockNow(): void {
  const { services } = useApp.getState();
  if (!services?.lock?.isUnlocked()) return;
  services.lock.lock();
  useApp.getState().set({ status: 'locked' });
}

/** Locks when the app has been in the background longer than the auto-lock time. */
export function installAutoLock(): () => void {
  const onVis = () => {
    const lock = useApp.getState().services?.lock;
    if (!lock) return;
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      if (minutes === 0) lockNow();
    } else if (hiddenAt !== undefined && minutes !== null) {
      if (Date.now() - hiddenAt >= minutes * 60_000) lockNow();
      hiddenAt = undefined;
    }
  };
  document.addEventListener('visibilitychange', onVis);
  return () => {
    document.removeEventListener('visibilitychange', onVis);
  };
}
