import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './test.ts';
import { manyPages } from './fixtures.ts';

async function importDoc(page: Page, name = 'Backup me.pdf') {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open PDF' }).first().click();
  await (await chooser).setFiles(await manyPages(2, name));
  await expect(page.locator('canvas[data-pdf-canvas]').first()).toBeVisible();
}

async function passcode(page: Page, code: string) {
  await page.getByRole('textbox', { name: 'Passcode' }).fill(code);
  await page.getByRole('button', { name: 'OK' }).click();
}

test('app lock: passcode on, locked after reload, wrong then right passcode, then off', async ({
  page,
}) => {
  await page.goto('/#/settings');
  await page.getByRole('switch', { name: 'App lock' }).click();
  await passcode(page, '123456');
  await passcode(page, '123456');
  await expect(page.getByRole('switch', { name: 'App lock' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'DaSignature is locked' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Passcode' }).fill('000000');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong passcode. Try again.');
  await page.getByRole('textbox', { name: 'Passcode' }).fill('123456');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await page.getByRole('switch', { name: 'App lock' }).click();
  await passcode(page, '123456');
  await expect(page.getByRole('switch', { name: 'App lock' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
});

test('backup, clear all data (typed confirm), restore (replace) brings the document back', async ({
  page,
}) => {
  await importDoc(page);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: /^Backup and restore/ }).click();
  await page.getByLabel('Backup password').fill('correct horse');
  await page.getByLabel('Confirm password').fill('correct horse');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Create backup' }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toMatch(/^DaSignature-backup-\d{4}-\d\d-\d\d\.dasig$/);
  const path = join(test.info().outputDir, 'b.dasig');
  await download.saveAs(path);
  await page.getByRole('button', { name: 'Back to Settings' }).click();

  await page.getByRole('button', { name: 'Clear all data' }).click();
  const dlg = page.getByRole('dialog', { name: 'Clear all data?' });
  const go = dlg.getByRole('button', { name: 'Clear all data' });
  await expect(go).toBeDisabled();
  await dlg.getByRole('textbox').fill('delete');
  await go.click();
  await expect(page.getByText('All data cleared')).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'No documents yet' })).toBeVisible();

  await page.goto('/#/settings');
  await page.getByRole('button', { name: /^Backup and restore/ }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Restore from backup' }).click();
  await (await chooser).setFiles(path);
  await expect(page.locator('[data-restore-preview]')).toContainText('DaSignature 0.1.0');
  await page.getByLabel('Password for this backup').fill('wrong password');
  await page.getByRole('button', { name: 'Replace all data' }).click();
  await page
    .getByRole('dialog', { name: 'Replace all data?' })
    .getByRole('button', { name: 'Replace all data' })
    .click();
  await expect(page.getByRole('alert')).toHaveText('Wrong password, try again');
  await page.getByLabel('Password for this backup').fill('correct horse');
  await page.getByRole('button', { name: 'Replace all data' }).click();
  await page
    .getByRole('dialog', { name: 'Replace all data?' })
    .getByRole('button', { name: 'Replace all data' })
    .click();
  await expect(page.getByText('Backup restored')).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Backup me, Draft' })).toBeVisible();
});

test('language: Arabic switches the catalog and the layout to RTL, persists', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByRole('button', { name: /^Language/ }).click();
  await page.getByRole('radio', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await page.reload();
  await expect(page.getByRole('link', { name: 'المكتبة' }).first()).toBeVisible();
  await page.getByRole('button', { name: /^اللغة/ }).click();
  await page.getByRole('radio', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('A11Y-01: no critical/serious axe violations on library, settings, editor and export sheet', async ({
  page,
}) => {
  const scan = async (label: string) => {
    const r = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const bad = r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(
      bad.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  };
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await scan('library');
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await scan('settings');
  await importDoc(page, 'axe.pdf');
  await page.getByRole('button', { name: 'Add date' }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('group', { name: /^Date, page 1/ })).toBeVisible();
  await scan('editor');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Export signed copy' })).toBeVisible();
  await scan('export');
});
