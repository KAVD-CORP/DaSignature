import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Verbose so CI and QA evidence logs list every case id (ADP-01-C.., ENC-.., BAK-..).
    reporters: ['verbose'],
    include: ['test/**/*.test.ts'],
    exclude: [
      'test/**/*.browser.test.ts',
      'test/**/*.e2e.test.ts',
      'test/**/*.native.test.ts',
      'node_modules/**',
    ],
    testTimeout: 30_000,
  },
});
