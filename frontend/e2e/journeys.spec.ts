import { expect, test } from '@playwright/test';

/**
 * Usability journeys (phase 9). Each test is one task a reader actually performs, written against
 * the dev stack at BASE_URL. They assert on what the reader sees and can do — not on internals.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://169.58.108.61:5200';

test.describe('finding your way', () => {
  test('dashboard → index card → index detail', async ({ page }) => {
    await page.goto(BASE + '/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Market board');

    // The index panel's cards link to the index detail page.
    await page.getByRole('link', { name: /KSE100/i }).first().click();
    await expect(page).toHaveURL(/\/indices\/KSE100/);

    // The summary endpoint used to take 8s and froze the page on a skeleton; a 10s budget here
    // is deliberately generous but would have failed before the fix.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('KSE100', { timeout: 10_000 });
    await expect(page.getByText(/Last session|as of/i).first()).toBeVisible();
  });

  test('search opens from the keyboard, focuses the field, and closes on Escape', async ({ page }) => {
    await page.goto(BASE + '/');
    const searchButton = page.getByRole('button', { name: 'Search stocks' }).first();
    await searchButton.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Search stocks' });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole('textbox', { name: 'Search stocks' });
    await expect(input).toBeFocused();

    await input.fill('OGDC');
    await expect(dialog.getByRole('option').first()).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Focus must come back to the control that opened the dialog.
    await expect(searchButton).toBeFocused();
  });

  test('a nonsense search says so instead of showing an empty box', async ({ page }) => {
    await page.goto(BASE + '/search?q=ZZZZNOPE');
    await expect(page.getByText(/no .*(match|result)|nothing/i).first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('filtering data', () => {
  test('a screener filter lives in the URL and survives a reload', async ({ page }) => {
    await page.goto(BASE + '/screener');
    const results = page.getByRole('table', { name: 'Screener results' });
    await expect(results.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });

    const chip = page.getByRole('button', { name: /Shariah — KMI All Shares/ });
    await chip.click();
    await expect(page).toHaveURL(/shariah=1/);
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await expect(page.getByRole('table', { name: 'Screener results' }).locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /Shariah — KMI All Shares/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('clearing the filters drops them from the URL', async ({ page }) => {
    await page.goto(BASE + '/screener?shariah=1');
    await expect(page.getByRole('button', { name: /Shariah — KMI All Shares/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /^Clear$/ }).first().click();
    await expect(page).not.toHaveURL(/shariah=1/);
  });
});

test.describe('reading a stock', () => {
  test('quick-jump moves to a section and the section is in view', async ({ page }) => {
    await page.goto(BASE + '/stocks/OGDC');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/OGDC/);

    const jump = page.getByRole('navigation', { name: 'Stock detail sections' });
    await jump.getByRole('button', { name: /dividend history/i }).click();
    await expect(page.locator('#section-dividend-history')).toBeInViewport();
  });

  test('an unreachable API explains itself and offers Retry', async ({ page }) => {
    await page.route('**/api/v1/**', (route) => route.abort());
    await page.goto(BASE + '/stocks/OGDC');

    const alert = page.getByRole('alert');
    await expect(alert).toContainText(/could not reach the data service/i);
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
    // The old copy blamed the symbol; make sure that has not come back.
    await expect(alert).not.toContainText(/not tracked yet/i);
  });
});

test.describe('alerts', () => {
  test('deleting an alert asks first, and cancelling keeps it', async ({ page }) => {
    await page.goto(BASE + '/alerts');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Alerts');

    // Create one so there is something to delete (the page is device-scoped and starts empty).
    await page.getByRole('textbox', { name: 'Symbol' }).fill('OGDC');
    await page.getByRole('spinbutton', { name: 'Value' }).fill('100');
    await page.getByRole('button', { name: 'Create' }).click();

    const row = page.getByText('OGDC', { exact: true }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /delete alert for OGDC/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(/cannot be undone/i);
    await dialog.getByRole('button', { name: /cancel/i }).click();

    await expect(page.getByText('OGDC', { exact: true }).first()).toBeVisible();
  });
});

test.describe('phones', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the bottom bar reaches the screener and nothing scrolls sideways', async ({ page }) => {
    await page.goto(BASE + '/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.getByRole('link', { name: 'Screener' }).last().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });

  test('a 320px phone has no horizontal scroll on the busiest pages', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    for (const path of ['/', '/screener', '/stocks/OGDC', '/dividends']) {
      await page.goto(BASE + path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
  });
});
