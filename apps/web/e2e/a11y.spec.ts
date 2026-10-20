import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { expect, test } from './test.ts';
import { manyPages } from './fixtures.ts';
import { drawOnPad } from './helpers.ts';

// QA final B1: axe-core 4.14 (label-content-name-mismatch, WCAG 2.5.3, is on by default there)
// injected directly, because @axe-core/playwright 4.14 needs Node 22 (decisions E-107).
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

interface Violation {
  id: string;
  impact: string | null;
  nodes: string[];
}

async function seriousViolations(page: Page): Promise<Violation[]> {
  // evaluate() is exempt from the page CSP, which (correctly) blocks inline script tags.
  await page.evaluate(`${axeSource};0`);
  const all = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: () => Promise<{
            violations: { id: string; impact: string | null; nodes: { html: string }[] }[];
          }>;
        };
      }
    ).axe;
    const r = await axe.run();
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.html.slice(0, 200)),
    }));
  });
  return all.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

test('Library, Signatures, Settings and Editor with content have no serious/critical axe 4.14 violations', async ({
  page,
}) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open PDF' }).first().click();
  await (await chooser).setFiles(await manyPages(4, 'Contract.pdf'));
  await expect(page.locator('canvas[data-pdf-canvas]').first()).toBeVisible();

  await page.getByRole('button', { name: 'Add signature' }).first().click();
  const dialog = page.getByRole('dialog');
  await drawOnPad(page);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await seriousViolations(page), 'editor').toEqual([]);

  // Optional QA item: shrinking to a phone closes the docked Pages pane (it would cover Export).
  await expect(page.getByRole('complementary', { name: 'Pages' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('complementary', { name: 'Pages' })).toBeHidden();
  await expect(page.getByRole('button', { name: /^Page 1 \/ 4, Show pages$/ })).toBeVisible();
  expect(await seriousViolations(page), 'editor 390').toEqual([]);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole('complementary', { name: 'Pages' })).toBeVisible();

  await page.getByRole('link', { name: 'Back to Library' }).click();
  const card = page.getByRole('link', { name: /^Contract/ });
  await expect(card).toBeVisible();
  expect(await seriousViolations(page), 'library').toEqual([]);
  // The accessible name is the visible text, in order (WCAG 2.5.3).
  await expect(card).toHaveAccessibleName(/^Contract\s*4 pages · Edited .+Draft$/);

  await page.goto('/#/signatures');
  await expect(page.getByRole('heading', { level: 1, name: 'Signatures' })).toBeVisible();
  expect(await seriousViolations(page), 'signatures').toEqual([]);

  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  expect(await seriousViolations(page), 'settings').toEqual([]);
});
