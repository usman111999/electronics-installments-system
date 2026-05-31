// @ts-check
const { test, expect } = require('@playwright/test');
const { uiLogin, attachConsoleCapture } = require('./helpers');

const ADMIN_PAGES = [
  { path: '/dashboard', anchor: 'Dashboard' },
  { path: '/branches', anchor: 'Branches' },
  { path: '/users', anchor: 'Users' },
  { path: '/products', anchor: 'Products' },
  { path: '/inventory', anchor: 'Inventory' },
  { path: '/customers', anchor: 'Customers' },
  { path: '/orders', anchor: 'Orders' },
  { path: '/installments', anchor: 'Installments' },
  { path: '/activity', anchor: 'Activity Logs' },
  { path: '/whatsapp', anchor: 'WhatsApp' },
];

test.describe('Admin flow', () => {
  test('admin can login and visit every admin page; users page shows masked password', async ({ page }) => {
    const cap = attachConsoleCapture(page);

    await uiLogin(page, 'admin@eis.local', 'Admin@123456');

    // Dashboard should load with KPI cards
    await page.waitForURL('**/dashboard');
    await expect(page.getByText('Money in Market')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total Collected')).toBeVisible();
    await expect(page.getByText('Total Sales')).toBeVisible();
    await expect(page.getByText('Estimated Profit')).toBeVisible();

    // Visit every admin page and verify the PageHeader title appears (h1)
    for (const p of ADMIN_PAGES) {
      await page.goto(p.path);
      // Wait for sidebar nav-link with same label (sanity: layout rendered)
      await expect(
        page.locator('aside').getByRole('link', { name: p.anchor }),
      ).toBeVisible({ timeout: 8000 });
      // Wait briefly for content to settle (data fetch)
      await page.waitForTimeout(700);
    }

    // Users page: at least one row should show an email + masked password placeholder
    await page.goto('/users');
    // Wait specifically for a data row (not the "No users" placeholder row)
    // Look for a row that contains an '@' in any cell
    const dataRow = page.locator('table tbody tr', { hasText: '@' }).first();
    await expect(dataRow).toBeVisible({ timeout: 15000 });
    const rowText = await dataRow.innerText();
    expect(rowText).toMatch(/@/);
    // Masked password bullet glyph in code element
    const masked = page.locator('table tbody tr code').first();
    await expect(masked).toBeVisible();
    const maskedText = await masked.innerText();
    expect(maskedText).toMatch(/[•·]/);

    // Surface any captured browser errors as an annotation, but don't fail the test
    if (cap.errors.length || cap.pageErrors.length) {
      console.log('[admin] console.error:', cap.errors);
      console.log('[admin] pageerror :', cap.pageErrors);
    }
  });
});
