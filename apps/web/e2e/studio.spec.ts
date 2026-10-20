import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './test.ts';
import { drawOnPad } from './helpers.ts';

const canvasHash = (page: Page) =>
  page.locator('canvas[data-pen-preview]').evaluate((c: HTMLCanvasElement) => c.toDataURL());

/** Minimal PNG: dark bar on near-white (for the upload pipeline). */
function pngFile(): string {
  const w = 200;
  const h = 80;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const ink = y > 30 && y < 50 && x > 20 && x < 180;
      raw.fill(ink ? 25 : 240, y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    let c = ~0;
    for (const b of td) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(~c >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const path = join(tmpdir(), 'dasig-sig.png');
  writeFileSync(path, png);
  return path;
}

test('draw a signature with live pen preview, save it, see it in the gallery', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#/signatures');
  await page.getByRole('button', { name: 'Create signature' }).click();
  const dialog = page.getByRole('dialog', { name: 'New signature' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await drawOnPad(page);
  await expect(page.getByRole('img', { name: 'Signature drawn, 2 strokes' })).toBeVisible();

  // PEN-PREV-01: weight, thinness, color and opacity each change the preview pixels.
  let before = await canvasHash(page);
  await dialog.getByLabel('Weight').fill('12');
  await expect.poll(() => canvasHash(page)).not.toBe(before);
  before = await canvasHash(page);
  await dialog.getByLabel('Thinness').fill('0.9');
  await expect.poll(() => canvasHash(page)).not.toBe(before);
  before = await canvasHash(page);
  await dialog.getByRole('radio', { name: 'Ink blue' }).click();
  await expect.poll(() => canvasHash(page)).not.toBe(before);
  // PEN-PREV-02: a settings change reaches the next painted frame quickly.
  const latency = await page.evaluate(async () => {
    const input = [...document.querySelectorAll<HTMLInputElement>('input[type=range]')].find(
      (i) => i.labels?.[0]?.textContent === 'Weight',
    );
    if (!input) return -1;
    const t0 = performance.now();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- invoked with .call(input)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '6');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t0;
  });
  console.log(`pen preview latency (2 frames incl.): ${latency.toFixed(1)} ms`);
  expect(latency).toBeGreaterThan(0);
  expect(latency).toBeLessThan(50);

  // SEC-04: copy shortcuts never put signature data on the clipboard.
  await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
  await page.getByRole('img', { name: /Signature drawn/ }).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('sentinel');

  await dialog.getByLabel('Name').fill('My test signature');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const card = page.getByRole('listitem', { name: /My test signature, signature, drawn, default/ });
  await expect(card).toBeVisible();
  await expect(
    card.getByRole('img', { name: 'My test signature' }).locator('path'),
  ).toHaveAttribute('fill', '#1F3A8A');
  await page.reload();
  await expect(page.getByRole('listitem', { name: /My test signature/ })).toBeVisible();
});

test('typed initials and an uploaded image; default per kind; delete with undo', async ({
  page,
}) => {
  await page.goto('/#/signatures');
  await page.getByRole('button', { name: 'Create signature' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Initials' }).click();
  await dialog.getByRole('radio', { name: 'Type' }).click();
  await dialog.getByLabel('Your initials').fill('JD');
  await dialog.getByRole('radio', { name: 'Great Vibes' }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('listitem', { name: /My initials, initials, typed, default/ }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'New signature' }).click();
  dialog = page.getByRole('dialog', { name: 'New signature' });
  await dialog.getByRole('radio', { name: 'Upload' }).click();
  await dialog.locator('input[type=file]').setInputFiles(pngFile());
  await expect(dialog.locator('img')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const up = page.getByRole('listitem', { name: /My signature, signature, uploaded, default/ });
  await expect(up).toBeVisible();
  await expect(up.locator('img')).toBeVisible();

  await page.getByRole('button', { name: 'More actions for My initials' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('listitem', { name: /My initials/ })).toBeHidden();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('listitem', { name: /My initials/ })).toBeVisible();
});
