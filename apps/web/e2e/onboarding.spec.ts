import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** M9 first-run introduction (design 01): 3 cards, optional signer name, shown once. */
test('introduction: cards, signer name, then the Library; shown once', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Your files never leave your device' }),
  ).toBeFocused();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual(
    [],
  );
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in seconds' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('heading', { name: 'Open source' })).toBeVisible();
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { name: "What's your name?" })).toBeVisible();
  await page.getByLabel('Your name').fill('  Ada Lovelace  ');
  await page.getByLabel('Your name').press('Enter');
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  await page.goto('/#/settings');
  await expect(page.getByText('Ada Lovelace')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
});

test('introduction: Skip jumps to the name step, and Skip for now finishes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
});
