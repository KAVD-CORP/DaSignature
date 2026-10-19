import { defineConfig } from 'vitest/config';

/** Node-side tests that drive a real Chromium (PERSIST-01). Needs `playwright install chromium`. */
export default defineConfig({
  test: {
    // Verbose so CI and QA evidence logs list every case id (ADP-01-C.., ENC-.., BAK-..).
    reporters: ['verbose'],
    include: ['test/**/*.e2e.test.ts'],
    testTimeout: 120_000,
  },
});
