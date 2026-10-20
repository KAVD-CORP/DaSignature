import { expect, test } from '@playwright/test';
import { manyPages } from './fixtures.ts';

// QA NET-01 / SPEC Sec 1.1, 5 rule 1, AC4: the app makes zero requests to any non-app origin.
for (const path of ['/', '/showcase.html']) {
  test(`zero outbound requests: only the app origin is ever contacted (${path})`, async ({
    page,
    baseURL,
  }) => {
    const appOrigin = new URL(baseURL ?? '').origin;
    const external: string[] = [];
    const all: string[] = [];

    await page.context().route('**/*', async (route) => {
      const url = route.request().url();
      all.push(url);
      const { protocol, origin } = new URL(url);
      if (protocol === 'data:' || protocol === 'blob:' || origin === appOrigin) {
        await route.continue();
      } else {
        external.push(url);
        await route.abort('blockedbyclient');
      }
    });
    page.on('websocket', (ws) => external.push(ws.url()));
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    if (path === '/') {
      await page.goto('/#/settings');
      for (const name of ['Dark', 'Light', 'System']) {
        await page.getByRole('radio', { name }).click();
      }
    }
    await page.waitForLoadState('networkidle');

    expect(all.length).toBeGreaterThan(0);
    expect(external, `external requests: ${external.join(', ')}`).toEqual([]);
    // CSP violations surface as console errors; there must be none.
    expect(errors).toEqual([]);
  });
}

test('ships a strict CSP and no-referrer policy in the page', async ({ page }) => {
  await page.goto('/');
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).not.toMatch(/https?:/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
});

test('every font is bundled and same-origin', async ({ page, baseURL }) => {
  const fonts: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'font') fonts.push(r.url());
  });
  await page.goto('/');
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  expect(fonts.length).toBeGreaterThan(0);
  for (const f of fonts) expect(f.startsWith(baseURL ?? '')).toBe(true);
  const inter = await page.evaluate(() => document.fonts.check('16px "Inter Variable"'));
  expect(inter).toBe(true);
});

test('zero outbound requests while importing and viewing a PDF', async ({ page, baseURL }) => {
  const appOrigin = new URL(baseURL ?? '').origin;
  const external: string[] = [];
  await page.context().route('**/*', async (route) => {
    const { protocol, origin } = new URL(route.request().url());
    if (protocol === 'data:' || protocol === 'blob:' || origin === appOrigin)
      await route.continue();
    else {
      external.push(route.request().url());
      await route.abort('blockedbyclient');
    }
  });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open PDF' }).first().click();
  await (await chooser).setFiles(await manyPages(3, 'net.pdf'));
  await expect(page.getByRole('img', { name: 'Page 1 of 3' }).locator('canvas')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
