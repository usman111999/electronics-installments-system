// @ts-check
const { test, expect } = require('@playwright/test');
const { uiLogin } = require('./helpers');

test.describe('Auth guards', () => {
  test('unauthenticated /dashboard redirects to /login', async ({ page }) => {
    // Ensure no leftover token from prior tests
    await page.goto('/login');
    await page.evaluate(() => {
      try { localStorage.removeItem('access_token'); } catch {}
    });

    await page.goto('/dashboard');
    await page.waitForURL(/\/login(\?|$|#|\/)/, { timeout: 10000 });
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('operator visiting /branches gets redirected to /dashboard', async ({ page }) => {
    await uiLogin(page, 'operator1@eis.local', 'Op@123456');
    await page.waitForURL('**/dashboard');

    await page.goto('/branches');
    // Should be redirected to /dashboard (ProtectedRoute logic)
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
