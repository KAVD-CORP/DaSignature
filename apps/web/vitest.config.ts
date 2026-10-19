import { defineConfig } from 'vitest/config';

// Unit tests only (Playwright e2e lives in e2e/). JSX is compiled per tsconfig (react-jsx).
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
