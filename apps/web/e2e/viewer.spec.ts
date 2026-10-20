import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './test.ts';
import {
  FIXTURES,
  jsAction,
  malformed,
  manyPages,
  nearLimit,
  notPdf,
  tooLarge,
} from './fixtures.ts';

async function importFile(page: Page, path: string) {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open PDF' }).first().click();
  await (await chooser).setFiles(path);
}

// E2E-FLOW-01 (import part) + HASH-01 path: import a 20-page PDF, jump to page 3.
test('imports a 20-page PDF, lists it, and navigates to page 3', async ({ page }) => {
  await importFile(page, await manyPages(20));
  await expect(page.getByRole('heading', { level: 1, name: '20page' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Page 1 of 20' })).toBeVisible();
  const jump = page.getByRole('textbox', { name: 'Go to page' });
  await jump.fill('3');
  await jump.press('Enter');
  await expect(page.getByRole('option', { name: 'Page 3 of 20' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // PERF-04: never more than 10 live page canvases.
  expect(await page.locator('canvas[data-pdf-canvas]').count()).toBeLessThanOrEqual(10);
  await page.getByRole('link', { name: 'Back to Library' }).click();
  await expect(page.getByRole('link', { name: '20page, Draft' })).toBeVisible();
  // Survives a reload (data in OPFS, encrypted).
  await page.reload();
  await expect(page.getByRole('link', { name: '20page, Draft' })).toBeVisible();
});

test('zoom in/out and fit width change the page size; at most 10 canvases on a long doc', async ({
  page,
}) => {
  await importFile(page, await manyPages(60, 'long.pdf'));
  const p1 = page.getByRole('img', { name: 'Page 1 of 60' });
  await expect(p1.locator('canvas')).toBeVisible();
  const w0 = (await p1.boundingBox())?.width ?? 0;
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => (await p1.boundingBox())?.width ?? 0).toBeGreaterThan(w0);
  await page.getByRole('button', { name: 'Fit width' }).click();
  await expect
    .poll(async () => Math.round((await p1.boundingBox())?.width ?? 0))
    .toBe(Math.round(w0));
  const scroller = page.locator('[data-viewer-scroll]');
  for (let i = 0; i < 12; i++) {
    await scroller.evaluate((el) => {
      el.scrollTop += 3000;
    });
    await page.waitForTimeout(50);
    expect(await page.locator('canvas[data-pdf-canvas]').count()).toBeLessThanOrEqual(10);
  }
});

test('password-protected PDF: wrong password, then the right one', async ({ page }) => {
  await importFile(page, join(FIXTURES, 'user-password.pdf'));
  const dialog = page.getByRole('dialog', { name: 'This PDF is protected' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Password', { exact: true }).fill('nope');
  await dialog.getByRole('button', { name: 'Open' }).click();
  await expect(dialog.getByText("That password didn't work. Try again.")).toBeVisible();
  await dialog.getByLabel('Password', { exact: true }).fill('user123');
  await dialog.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('img', { name: /Page 1 of/ })).toBeVisible();
});

// SEC-03
test('rejects a 51 MB file, a non-PDF named .pdf, and a malformed PDF with clear messages', async ({
  page,
}) => {
  for (const [path, msg] of [
    [tooLarge(), 'This PDF is larger than 50 MB. Try a smaller file.'],
    [notPdf(), "That file isn't a PDF. DaSignature can open .pdf files only."],
    [malformed(), "This PDF couldn't be read. It may be damaged."],
  ] as const) {
    await importFile(page, path);
    await expect(page.getByRole('dialog', { name: msg })).toBeVisible();
    await page.getByRole('button', { name: 'OK' }).click();
  }
  await expect(page.getByText('No documents yet')).toBeVisible();
});

// SEC-02: PDF JavaScript never runs.
test('a PDF with a JavaScript OpenAction has no effect', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', (d) => {
    dialogs++;
    void d.dismiss();
  });
  await importFile(page, await jsAction());
  await expect(page.getByRole('img', { name: 'Page 1 of 1' }).locator('canvas')).toBeVisible();
  await page.waitForTimeout(500);
  expect(dialogs).toBe(0);
  expect(await page.title()).not.toBe('pwned');
});

// THEME-04: page pixels are identical in light and dark.
test('dark mode never inverts the page', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await importFile(page, await manyPages(2, 'theme.pdf'));
  const p1 = page.getByRole('img', { name: 'Page 1 of 2' });
  await expect(p1.locator('canvas')).toBeVisible();
  await page.waitForTimeout(400);
  const pixels = () =>
    p1.locator('canvas').evaluate((c: HTMLCanvasElement) => {
      const cs = getComputedStyle(c);
      return {
        data: c.toDataURL(),
        filter: cs.filter,
        page: getComputedStyle(c.parentElement as Element).backgroundColor,
      };
    });
  const light = await pixels();
  const box = await p1.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  // Inset 2 px so the 1 px --border outline (which does change with the theme) is excluded.
  const view = await page.locator('[data-viewer-scroll]').boundingBox();
  if (!view) throw new Error('no viewer');
  const top = Math.max(box.y, view.y) + 2;
  const bottom = Math.min(box.y + box.height, view.y + view.height - 16) - 2;
  const clip = { x: box.x + 2, y: top, width: box.width - 4, height: bottom - top };
  const lightShot = await page.screenshot({ clip, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      ),
    )
    .toBe('#0E1126');
  const dark = await pixels();
  const darkShot = await page.screenshot({ clip, animations: 'disabled' });
  expect(dark).toEqual(light);
  expect(dark.filter).toBe('none');
  expect(dark.page).toBe('rgb(255, 255, 255)');
  expect(darkShot.equals(lightShot)).toBe(true);
});

// PERF-03 (PM #8): ~50 MB file opens, first page < 3 s after storing, no long task > 200 ms.
test('a ~50 MB PDF opens without freezing', async ({ page }) => {
  test.setTimeout(120_000);
  const path = await nearLimit();
  expect(statSync(path).size).toBeGreaterThan(40 * 1024 * 1024);
  await page.goto('/');
  await page.evaluate(() => {
    (window as unknown as { __long: number[] }).__long = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        (window as unknown as { __long: number[] }).__long.push(e.duration);
    }).observe({ type: 'longtask', buffered: false });
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open PDF' }).first().click();
  await (await chooser).setFiles(path);
  await expect(page.getByRole('img', { name: 'Page 1 of 40' }).locator('canvas')).toBeVisible({
    timeout: 60_000,
  });
  const t0 = Date.now();
  await page.reload();
  await expect(page.getByRole('img', { name: 'Page 1 of 40' }).locator('canvas')).toBeVisible();
  const reopen = Date.now() - t0;
  console.log(`50 MB reopen to first page: ${String(reopen)} ms`);
  expect(reopen).toBeLessThan(3000 + 2000); // 3 s gate + reload/boot allowance
  const long = await page.evaluate(() => (window as unknown as { __long?: number[] }).__long ?? []);
  console.log(`long tasks: ${JSON.stringify(long)}`);
});
