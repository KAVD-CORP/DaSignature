/** README screenshots (M10). Run: SCREENSHOTS=1 pnpm exec playwright test e2e/screenshots.spec.ts */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { expect, test } from './test.ts';
import { drawOnPad } from './helpers.ts';

const OUT = new URL('../../../docs/screenshots/', import.meta.url).pathname;

async function samplePdf(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let n = 1; n <= 2; n++) {
    const p = doc.addPage([612, 792]);
    p.drawText(n === 1 ? 'Residential Lease Agreement' : 'Signatures', {
      x: 72,
      y: 700,
      size: 22,
      font: bold,
    });
    const lines = [
      'This agreement is made between the Landlord and the Tenant named below.',
      'The Tenant agrees to pay rent on the first day of each month.',
      'The premises shall be kept clean and in good condition.',
      'Either party may end this agreement with 60 days written notice.',
    ];
    lines.forEach((l, i) => {
      p.drawText(l, { x: 72, y: 650 - i * 24, size: 12, font });
    });
    p.drawLine({ start: { x: 72, y: 200 }, end: { x: 300, y: 200 }, color: rgb(0.3, 0.3, 0.3) });
    p.drawText('Tenant signature', { x: 72, y: 184, size: 10, font });
  }
  const f = join(tmpdir(), 'Lease agreement.pdf');
  writeFileSync(f, await doc.save());
  return f;
}

test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to regenerate docs/screenshots');

test('README screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open PDF' }).first().click();
  await (await chooser).setFiles(await samplePdf());
  await expect(page.getByRole('img', { name: 'Page 1 of 2' }).locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Create your signature' }).click();
  const dialog = page.getByRole('dialog');
  await drawOnPad(page);
  await page.screenshot({ path: OUT + 'studio.png' });
  await dialog.getByLabel('Name').fill('My signature');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + 'editor.png' });
  await page.goto('/#/');
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + 'library.png' });
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await page.goto('/#/signatures');
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + 'dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/');
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + 'phone.png' });
});
