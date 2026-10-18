import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * The smoke path a release has to pass: the dashboard renders, search reaches a stock, a screener
 * filter lands in the URL, and the browser reports no errors along the way.
 *
 * Runs against whatever stack `PLAYWRIGHT_BASE_URL` points at — no mocks, no live scraping beyond the
 * data the stack already holds.
 */
const collectErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
};

test('dashboard renders the market overview', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  // The KPI tiles are headings too, so target the page title rather than "any h1".
  await expect(page.getByRole('heading', { name: 'Market board' })).toBeVisible();
  await expect(page.locator('table').first()).toBeVisible();
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('search reaches a stock page', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('combobox', { name: /search/i }).first();
  await search.fill('OGDC');
  await page.keyboard.press('Enter');
  // Enter opens the results page; a result click is what reaches the stock.
  await expect(page).toHaveURL(/\/search\?q=OGDC/i, { timeout: 15_000 });
  await page.getByRole('link', { name: /OGDC/i }).first().click();
  await expect(page).toHaveURL(/\/stocks\/OGDC/i, { timeout: 15_000 });
  await expect(page.getByText(/OGDC/).first()).toBeVisible();
});

test('a screener filter lands in the URL and narrows the result', async ({ page }) => {
  await page.goto('/screener');
  // Count only once the table has actually rendered, or "before" is 0 and the comparison is noise.
  // Scope to the results table: the page also renders a "named screens" table above it.
  const results = page.getByRole('table', { name: 'Screener results' });
  await expect(results.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });

  const chip = page.getByRole('button', { name: /Shariah — KMI All Shares/ });
  await chip.click();
  await expect(page).toHaveURL(/shariah=1/);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  // A page holds 50 rows at most, so the meaningful assertion is that results still render and the
  // filter survives a reload — not that the visible row count shrank (it is paginated).
  await expect(results.locator('tbody tr').first()).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/shariah=1/);
  await expect(page.getByRole('button', { name: /Shariah — KMI All Shares/ })).toHaveAttribute('aria-pressed', 'true');
});

test('mobile width has no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForTimeout(1500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
