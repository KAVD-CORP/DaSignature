/**
 * Registers the build-generated service worker (pwa.ts) for offline use. Web only: the Tauri and
 * Capacitor shells already serve the bundle from the app package.
 */
import { detectPlatform } from './platform.ts';

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || detectPlatform() !== 'web') return;
  if (!('serviceWorker' in navigator) || !isSecureContext) return;
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err: unknown) => {
      console.warn('service worker registration failed', err);
    });
  });
}
