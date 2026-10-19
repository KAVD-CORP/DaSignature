import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Empty Capacitor shell (Milestone 1). The android/ and ios/ projects are the unmodified
 * `cap add` templates; share target, file open and icons land in Milestone 8.
 * Build: `pnpm sync:android` / `pnpm sync:ios`, then Gradle / Xcode.
 */
const config: CapacitorConfig = {
  appId: 'app.dasignature',
  appName: 'DaSignature',
  webDir: '../web/dist',
  // Bundled assets only: never point the WebView at a remote server.
  android: { allowMixedContent: false },
};

export default config;
