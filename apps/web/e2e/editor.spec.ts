import type { Page } from '@playwright/test';
import { expect, test } from './test.ts';
import { manyPages } from './fixtures.ts';
import { drawOnPad } from './helpers.ts';

async function openDoc(page: Page, pages = 4) {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open PDF' }).first().click();
  await (await chooser).setFiles(await manyPages(pages, `ed${String(pages)}.pdf`));
  await expect(
    page.getByRole('img', { name: `Page 1 of ${String(pages)}` }).locator('canvas'),
  ).toBeVisible();
}

const stored = (page: Page) =>
  page.locator('[data-placement]').evaluateAll((els) =>
    els.map((e) => {
      const s = (e as HTMLElement).style;
      return {
        left: parseFloat(s.left),
        top: parseFloat(s.top),
        width: parseFloat(s.width),
        transform: s.transform,
      };
    }),
  );

test('AC1: create a signature from the editor, place it on page 3, nudge, resize, rotate, undo/redo, autosave', async ({
  page,
}) => {
  await openDoc(page, 4);
  await page.getByRole('button', { name: 'Add signature' }).first().click();
  // No signature yet: the Studio opens first.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await drawOnPad(page);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Tap the page' })).toBeVisible();

  const jump = page.getByRole('textbox', { name: 'Go to page' });
  await jump.fill('3');
  await jump.press('Enter');
  const layer = page.locator('[data-placement-layer="2"]');
  await expect(layer).toBeVisible();
  const lb = await layer.boundingBox();
  if (!lb) throw new Error('no layer');
  await page.mouse.click(lb.x + lb.width / 2, lb.y + lb.height / 3);
  const placed = page.getByRole('group', { name: /^Signature, page 3, \d+ by \d+ percent$/ });
  await expect(placed).toBeVisible();
  await expect(placed).toHaveAttribute('aria-roledescription', 'placed signature');
  await expect(page.locator('.ds-selection-handle[data-ui-state="handle"]')).toHaveCount(5);
  await expect(layer).toHaveAttribute('data-qa-backdrop', '#FFFFFF');

  // Arrow nudge: 1 px, Shift 10 px (screen px at current zoom).
  await placed.focus();
  const [a] = await stored(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const [b] = await stored(page);
  expect((b?.left ?? 0) - (a?.left ?? 0)).toBeCloseTo(1, 1);
  expect((b?.top ?? 0) - (a?.top ?? 0)).toBeCloseTo(10, 1);

  // Resize from the bottom-right handle (aspect locked).
  const pb = await placed.boundingBox();
  if (!pb) throw new Error('no box');
  await page.mouse.move(pb.x + pb.width, pb.y + pb.height);
  await page.mouse.down();
  await page.mouse.move(pb.x + pb.width + 60, pb.y + pb.height + 10, { steps: 6 });
  await page.mouse.up();
  const [c] = await stored(page);
  expect(c?.width ?? 0).toBeGreaterThan((b?.width ?? 0) + 40);

  // Rotate via the properties slider (keyboard).
  const rot = page.getByRole('slider', { name: 'Rotation' });
  await rot.focus();
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await stored(page))[0]?.transform).toBe('rotate(15deg)');

  // Undo/redo.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await stored(page))[0]?.transform ?? '').not.toBe('rotate(15deg)');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect.poll(async () => (await stored(page))[0]?.transform).toBe('rotate(15deg)');

  // Autosave → survives a reload.
  await expect(page.locator('[data-saved]')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('group', { name: /^Signature, page 3/ })).toBeAttached();
  expect((await stored(page))[0]?.transform).toBe('rotate(15deg)');
});

test('fields: date, checkbox, full name (asks once), text; delete with undo; keyboard placement', async ({
  page,
}) => {
  await openDoc(page, 2);
  const layer = page.locator('[data-placement-layer="0"]');
  const lb = await layer.boundingBox();
  if (!lb) throw new Error('no layer');

  await page.getByRole('button', { name: 'Add date' }).first().click();
  await page.mouse.click(lb.x + 120, lb.y + 120);
  const date = page.getByRole('group', { name: /^Date, page 1/ });
  await expect(date).toContainText(/\d{4}/);
  await page.getByRole('combobox', { name: 'Date format' }).selectOption('YYYY-MM-DD');
  await expect(date).toContainText(/^\d{4}-\d{2}-\d{2}$/);

  await page.getByRole('button', { name: 'Add checkbox' }).first().click();
  await page.mouse.click(lb.x + 120, lb.y + 200);
  await expect(page.getByRole('group', { name: /^Checkbox, page 1/ }).locator('path')).toHaveCount(
    1,
  );

  await page.getByRole('button', { name: 'Add full name' }).first().click();
  await page.mouse.click(lb.x + 120, lb.y + 260);
  const nameDlg = page.getByRole('dialog', { name: 'Your full name' });
  await nameDlg.getByRole('textbox').fill('Ama Mensah');
  await nameDlg.getByRole('button', { name: 'Use this name' }).click();
  await expect(page.getByRole('group', { name: /^Full name, page 1/ })).toHaveText('Ama Mensah');

  // Non-pointer path: tool + Enter places in the middle of the current page; then type.
  await page.getByRole('button', { name: 'Add text' }).first().focus();
  await page.keyboard.press('Enter'); // keyboard activation places it in the middle of the page
  const text = page.getByRole('group', { name: /^Text, page 1/ });
  await expect(text).toBeAttached();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Lease 12B');
  await expect(text).toHaveText('Lease 12B');

  // Delete + undo toast.
  await text.focus();
  await page.keyboard.press('Delete');
  await expect(text).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).last().click();
  await expect(page.getByRole('group', { name: /^Text, page 1/ })).toHaveText('Lease 12B');
  expect(await page.locator('[data-placement]').count()).toBe(4);
});
