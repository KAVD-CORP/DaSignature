import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/** Runs the contract suite and ENC-02 against the real web adapter (OPFS + worker) in Chromium. */
export default defineConfig({
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  test: {
    // Verbose so CI and QA evidence logs list every case id (ADP-01-C.., ENC-.., BAK-..).
    reporters: ['verbose'],
    include: ['test/**/*.browser.test.ts'],
    testTimeout: 120_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      screenshotFailures: false,
    },
  },
});
