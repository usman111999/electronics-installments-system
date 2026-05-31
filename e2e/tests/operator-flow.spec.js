// @ts-check
const { test, expect } = require('@playwright/test');
const { uiLogin, attachConsoleCapture } = require('./helpers');

test.describe('Operator flow', () => {
  test('operator login, customer search/print, record payment on inst #2', async ({ page }) => {
    const cap = attachConsoleCapture(page);

    await uiLogin(page, 'operator1@eis.local', 'Op@123456');

    // Dashboard
    await page.waitForURL('**/dashboard');
    await expect(page.getByText('Money in Market')).toBeVisible({ timeout: 10000 });

    // Sidebar should NOT show Branches / Users
    const sidebar = page.locator('aside');
    await expect(sidebar.getByRole('link', { name: 'Branches' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Users' })).toHaveCount(0);

    // Customers: search for "Numan"
    await page.goto('/customers');
    await page.waitForSelector('table');
    await page.fill('input[placeholder*="Search"]', 'Numan');
    await page.waitForTimeout(800); // debounce 250ms + api
    await expect(page.locator('table tbody')).toContainText('Numan', { timeout: 8000 });

    // Open customer detail by clicking View link
    await page.locator('table tbody tr', { hasText: 'Numan' }).first().locator('a:has-text("View")').click();
    await page.waitForURL(/\/customers\/[a-f0-9-]+/);
    // Header should mention account # 891861
    await expect(page.getByText(/Account #891861/)).toBeVisible({ timeout: 8000 });

    // Click Print Account Form
    await page.click('button:has-text("Print Account Form")');
    // The print layout should also show account #
    await expect(page.getByText(/Account No\./i).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('891861').first()).toBeVisible();

    // Go to Orders
    await page.goto('/orders');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Click the View link on the first order row (Numan's order)
    const firstViewLink = page.locator('table tbody tr a', { hasText: /view|open|details/i }).first();
    if ((await firstViewLink.count()) === 0) {
      // Fall back: any link in tbody pointing to /orders/
      const anyOrderLink = page.locator('table tbody a[href^="/orders/"]').first();
      await anyOrderLink.click();
    } else {
      await firstViewLink.click();
    }
    await page.waitForURL(/\/orders\/[a-f0-9-]+/);

    // Find the first row that still has a Pay button (robust against test re-runs
    // — paying inst #2 once means the next run needs to pay #3, etc.).
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const firstPayRow = page.locator('table tbody tr', { has: page.locator('button:has-text("Pay")') }).first();
    await expect(firstPayRow).toBeVisible({ timeout: 8000 });
    const instNo = (await firstPayRow.locator('td').first().innerText()).trim();

    const payBtn = firstPayRow.locator('button:has-text("Pay")');
    await payBtn.click();

    // Modal opens — submit using prefilled remaining amount
    await page.click('button:has-text("Record")');

    // Wait for modal to close + order to reload
    await page.waitForTimeout(1500);

    // After payment, that row should now show status "paid"
    const paidRow = page.locator('table tbody tr', {
      has: page.locator('td:first-child', { hasText: new RegExp(`^\\s*${instNo}\\s*$`) }),
    }).first();
    await expect(paidRow).toContainText('paid', { timeout: 8000 });

    if (cap.errors.length || cap.pageErrors.length) {
      console.log('[operator] console.error:', cap.errors);
      console.log('[operator] pageerror :', cap.pageErrors);
    }
  });
});
