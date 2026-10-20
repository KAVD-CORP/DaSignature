import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './test.ts';
import { FIXTURES } from './fixtures.ts';

/** M8 PWA: the generated service worker precaches the whole build, so the app opens offline. */
test('service worker installs and the app reloads offline', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const version = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    return { active: Boolean(reg.active), keys };
  });
  expect(version.active).toBe(true);
  expect(version.keys.some((k) => /^dasig-[0-9a-f]{16}$/.test(k))).toBe(true);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/#/signatures');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await context.setOffline(false);
});

test('share target: a POSTed PDF is stashed by the worker and opens in the editor', async ({
  page,
}) => {
  const pdf = [...readFileSync(join(FIXTURES, 'plain.pdf'))];
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  const status = await page.evaluate(async (bytes) => {
    const form = new FormData();
    form.append(
      'file',
      new File([new Uint8Array(bytes)], 'Shared lease.pdf', { type: 'application/pdf' }),
    );
    const res = await fetch('/share-target', { method: 'POST', body: form });
    return res.url;
  }, pdf);
  expect(status).toContain('/?shared=1');
  await page.goto('/?shared=1');
  await expect(page).toHaveURL(/#\/doc\//);
  await expect(page).not.toHaveURL(/shared=1/);
  await expect(page.getByText('Shared lease').first()).toBeVisible();
});
