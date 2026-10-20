import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { colorTokens } from '@dasignature/ui';

const names = Object.keys(colorTokens) as (keyof typeof colorTokens)[];

async function readTokens(page: Page): Promise<Record<string, string>> {
  return page.evaluate((list) => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      list.map((n) => [n, cs.getPropertyValue(`--${n}`).trim().toUpperCase()]),
    );
  }, names);
}

// QA THEME-01/02: exact SPEC 8.2 values in both schemes; system theme is the default and live.
for (const scheme of ['light', 'dark'] as const) {
  test(`computed tokens match SPEC 8.2 under system ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    const got = await readTokens(page);
    for (const n of names) expect(got[n], `--${n}`).toBe(colorTokens[n][scheme]);
  });
}

test('follows a live system theme change without reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  expect((await readTokens(page))['bg']).toBe(colorTokens.bg.light);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect((await readTokens(page))['bg']).toBe(colorTokens.bg.dark);
});

test('explicit Light/Dark override the system preference', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: 'Light' }).click();
  expect((await readTokens(page))['bg']).toBe(colorTokens.bg.light);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('radio', { name: 'Dark' }).click();
  expect((await readTokens(page))['bg']).toBe(colorTokens.bg.dark);
});

test('reduced motion turns transitions off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const fast = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--motion-fast').trim(),
  );
  expect(fast).toBe('0ms');
});

// QA A11Y-01, PM #15: no critical or serious axe violations, both themes.
for (const path of ['/', '/#/settings', '/showcase.html'])
  for (const scheme of ['light', 'dark'] as const) {
    test(`axe: no critical/serious violations (${path}, ${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path);
      await page.getByRole('heading', { level: 1 }).first().waitFor();
      const results = await new AxeBuilder({ page }).analyze();
      const bad = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(bad.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  }
