/** Mobile wiring lands in M8 (Capacitor SQLite + SQLCipher bridge). */
import type { Services } from './platform.ts';

export function createMobileServices(): Promise<Services> {
  return Promise.reject(new Error('mobile storage bridge is not available in this build'));
}
