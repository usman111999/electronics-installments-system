// @ts-check
const { test, expect, request: pwRequest } = require('@playwright/test');
const { uiLogin, attachConsoleCapture } = require('./helpers');

const API = 'http://localhost:4000/api';
const CUST_EMAIL = 'cust1@eis.local';
const CUST_PASS = 'Cust@123';

async function adminLoginToken(req) {
  const r = await req.post(`${API}/auth/login`, {
    data: { email: 'admin@eis.local', password: 'Admin@123456' },
  });
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  return j.access_token;
}

async function ensureCustomerLogin(req) {
  // Try to login as the customer — if it works, we're done.
  const probe = await req.post(`${API}/auth/login`, {
    data: { email: CUST_EMAIL, password: CUST_PASS },
  });
  if (probe.ok()) return;

  // Otherwise create via admin
  const token = await adminLoginToken(req);

  // Need a branch_id to create the customer
  const branchesRes = await req.get(`${API}/branches`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const branches = await branchesRes.json();
  expect(Array.isArray(branches)).toBeTruthy();
  expect(branches.length).toBeGreaterThan(0);
  const branch_id = branches[0].id;

  const createRes = await req.post(`${API}/customers`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      customer_name: 'E2E Test Customer',
      phone_1: '03000000000',
      branch_id,
      create_login: true,
      email: CUST_EMAIL,
      password: CUST_PASS,
    },
  });
  if (!createRes.ok()) {
    const body = await createRes.text();
    throw new Error(`Customer create failed: ${createRes.status()} ${body}`);
  }
}

test.describe('Customer portal flow', () => {
  test('customer can login and visit each portal page', async ({ page }) => {
    const cap = attachConsoleCapture(page);

    // Prepare login via API (idempotent)
    const req = await pwRequest.newContext();
    await ensureCustomerLogin(req);
    await req.dispose();

    // Now login through UI
    await uiLogin(page, CUST_EMAIL, CUST_PASS);
    await page.waitForURL('**/portal');

    // Sidebar should only show My Account / My Installments / Products
    const sidebar = page.locator('aside');
    await expect(sidebar.getByRole('link', { name: 'My Account' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'My Installments' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Products' })).toBeVisible();
    // No admin/operator pages
    await expect(sidebar.getByRole('link', { name: 'Branches' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Users' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Customers' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Orders' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Inventory' })).toHaveCount(0);

    // /portal — My Account
    await expect(page.getByText(/Welcome|Your account|My Account/i).first()).toBeVisible({ timeout: 10000 });

    // /portal/installments
    await page.goto('/portal/installments');
    await page.waitForLoadState('networkidle');
    // Page should not crash — body should have something rendered
    await expect(page.locator('aside')).toBeVisible();

    // /portal/products
    await page.goto('/portal/products');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('aside')).toBeVisible();

    if (cap.errors.length || cap.pageErrors.length) {
      console.log('[customer] console.error:', cap.errors);
      console.log('[customer] pageerror :', cap.pageErrors);
    }
    // Customer portal should not have JS runtime errors
    expect(cap.pageErrors, `pageerror seen: ${cap.pageErrors.join(' | ')}`).toEqual([]);
  });
});
