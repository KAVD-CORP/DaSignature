/**
 * Shared Playwright `test`: starts every spec on the Library instead of the first-run
 * introduction (onboarding.spec.ts covers that with the plain @playwright/test).
 */
import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, provide) => {
    await page.addInitScript(() => {
      (globalThis as { __DASIG_E2E_SKIP_INTRO__?: boolean }).__DASIG_E2E_SKIP_INTRO__ = true;
    });
    await provide(page);
  },
});
