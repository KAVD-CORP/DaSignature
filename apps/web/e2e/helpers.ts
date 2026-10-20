import type { Page } from '@playwright/test';

export async function drawOnPad(page: Page) {
  const pad = page.getByRole('img', { name: /Signature pad/ });
  const box = await pad.boundingBox();
  if (!box) throw new Error('no pad');
  await page.mouse.move(box.x + 40, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 0; i <= 30; i++)
    await page.mouse.move(box.x + 40 + i * 12, box.y + box.height * 0.6 + Math.sin(i / 3) * 30, {
      steps: 2,
    });
  await page.mouse.up();
  await page.mouse.move(box.x + 60, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + box.height * 0.65, { steps: 15 });
  await page.mouse.up();
}
