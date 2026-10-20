import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './test.ts';
import { PDFDocument } from 'pdf-lib';
import { manyPages } from './fixtures.ts';
import { drawOnPad } from './helpers.ts';

async function open(page: Page, path: string, password?: string) {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open PDF' }).first().click();
  await (await chooser).setFiles(path);
  if (password) {
    const dlg = page.getByRole('dialog', { name: 'This PDF is protected' });
    await dlg.getByLabel('Password', { exact: true }).fill(password);
    await dlg.getByRole('button', { name: 'Open' }).click();
  }
  await expect(page.locator('canvas[data-pdf-canvas]').first()).toBeVisible();
}

async function makeSignature(page: Page) {
  await page.getByRole('button', { name: 'Add signature' }).first().click();
  const dialog = page.getByRole('dialog');
  await drawOnPad(page);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Cancel' }).click(); // leave tool mode
}

/** Dark-pixel share in a page-fraction rectangle of the first rendered canvas. */
const inkIn = (page: Page, r: { x: number; y: number; w: number; h: number }) =>
  page
    .locator('canvas[data-pdf-canvas]')
    .first()
    .evaluate((c: HTMLCanvasElement, r) => {
      const ctx = c.getContext('2d');
      if (!ctx) return -1;
      const d = ctx.getImageData(r.x * c.width, r.y * c.height, r.w * c.width, r.h * c.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4)
        if ((d[i] ?? 255) < 128 && (d[i + 2] ?? 255) < 160) dark++;
      return dark / (d.length / 4);
    }, r);

test('AC1/AC3: export flattens vector placements into <name>-signed.pdf; original unchanged; re-sign counter', async ({
  page,
}) => {
  await open(page, await manyPages(3, 'Lease.pdf'));
  await makeSignature(page);
  // Keyboard placement: middle of page 1.
  await page.getByRole('button', { name: 'Add signature' }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('group', { name: /^Signature, page 1/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add checkbox' }).first().focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Export signed copy' });
  await expect(sheet.getByRole('textbox', { name: 'File name' })).toHaveValue('Lease-signed');
  await expect(sheet.getByRole('note')).toHaveCount(0);
  await sheet.getByRole('switch', { name: 'Add audit page' }).click();
  await sheet.getByRole('textbox', { name: 'Name for the audit page' }).fill('Ama Mensah');
  const dl = page.waitForEvent('download');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toBe('Lease-signed.pdf');
  const done = page.getByRole('dialog', { name: 'Signed copy saved' });
  await expect(done.locator('[data-sha256]')).toHaveText(/^([0-9a-f]{4} ){15}[0-9a-f]{4}$/);
  const path = join(test.info().outputDir, 'Lease-signed.pdf');
  await download.saveAs(path);
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(pdfDoc.getProducer()).toBe('DaSignature 0.1.0');
  expect(pdfDoc.getPageCount()).toBe(4);
  await done.getByRole('button', { name: 'Done' }).click();

  // Re-export: counter.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Export signed copy' })
      .getByRole('textbox', { name: 'File name' }),
  ).toHaveValue('Lease-signed-2');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('link', { name: 'Back to Library' }).click();
  await expect(page.getByRole('link', { name: 'Lease, Signed' })).toBeVisible();

  // The exported file opens, has the audit page, and the signature is flattened ink on page 1.
  await open(page, path);
  await expect(page.getByRole('img', { name: 'Page 1 of 4' })).toBeAttached();
  await page.waitForTimeout(300);
  expect(await inkIn(page, { x: 0.35, y: 0.45, w: 0.3, h: 0.1 })).toBeGreaterThan(0.01);
  expect(await inkIn(page, { x: 0.02, y: 0.02, w: 0.1, h: 0.05 })).toBe(0);

  // Integrity check: exact match + trail.
  await page.goto('/#/settings');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose PDF' }).click();
  await (await chooser).setFiles(path);
  await expect(page.locator('[data-integrity-match="yes"]')).toBeVisible();
  await expect(page.locator('[data-integrity-result]')).toContainText('Ama Mensah');
});

test('password-protected PDF: case 1 notice, the copy opens without a password', async ({
  page,
}) => {
  await open(page, join(import.meta.dirname, 'fixtures', 'user-password.pdf'), 'user123');
  await makeSignature(page);
  await page.getByRole('button', { name: 'Add signature' }).first().focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+e');
  const sheet = page.getByRole('dialog', { name: 'Export signed copy' });
  await expect(sheet.getByRole('note')).toContainText('This PDF was password-protected');
  const dl = page.waitForEvent('download');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  const download = await dl;
  const path = join(test.info().outputDir, 'pw-signed.pdf');
  await download.saveAs(path);
  await expect(page.getByRole('dialog', { name: 'Signed copy saved' })).toContainText(
    'No password',
  );
  const text = readFileSync(path).toString('latin1');
  expect(text).not.toContain('/Encrypt');
  await open(page, path); // no password prompt
});
