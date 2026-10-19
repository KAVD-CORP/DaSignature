import { defineConfig } from 'vitest/config';

// Contract suites against the real desktop backend (needs the storage_ipc cargo example built).
export default defineConfig({
  test: {
    // Verbose so CI and QA evidence logs list every case id (ADP-01-C.., ENC-.., BAK-..).
    reporters: ['verbose'],
    include: ['test/**/*.native.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
