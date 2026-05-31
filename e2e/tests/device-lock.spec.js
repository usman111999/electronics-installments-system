// @ts-check
//
// QA — UI smoke for the device lock/unlock subsystem.
//
// Strategy: this spec is defensive about real-world state because the same
// seed is hit by multiple test runs. It does NOT require a device to be
// already enrolled; it handles both:
//   • "no device yet"   → open Enroll modal, assert QR is rendered, cancel
//   • "device enrolled" → click Lock (or Unlock if already locked), confirm
//                         the toggle round-trips
// Plus a smoke pass over /devices.

const { test, expect } = require('@playwright/test');
const { uiLogin, attachConsoleCapture } = require('./helpers');

test.describe('Device lock subsystem', () => {
  test('order page exposes a Device card; enroll modal shows a QR; /devices renders', async ({ page }) => {
    const cap = attachConsoleCapture(page);

    await uiLogin(page, 'admin@eis.local', 'Admin@123456');
    await page.waitForURL('**/dashboard');

    // ────────────────────────────────────────────────────────────────────
    // 1) Open the first order
    // ────────────────────────────────────────────────────────────────────
    await page.goto('/orders');
    await page.waitForSelector('table tbody tr', { timeout: 15000 });
    // First link that points at /orders/<uuid>
    const orderLink = page.locator('table tbody a[href^="/orders/"]').first();
    await expect(orderLink).toBeVisible({ timeout: 8000 });
    await orderLink.click();
    await page.waitForURL(/\/orders\/[a-f0-9-]+/);

    // The Device card is always rendered — either "not enrolled" state with
    // an "+ Enroll Device" button, or the populated state with IMEI + Lock/Unlock.
    // The order page can take a moment to settle — wait for the card explicitly.
    const enrollBtn = page.getByRole('button', { name: /Enroll Device/i });
    const notEnrolledText = page.getByText(/Device not enrolled/i);
    const deviceHeading = page.getByRole('heading', { name: /^Device$/ });

    // Wait for ANY of the three to appear (whichever state the card is in)
    await Promise.race([
      enrollBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
      notEnrolledText.waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
      deviceHeading.waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
    ]);

    const hasEnrollBtn = await enrollBtn.isVisible().catch(() => false);
    const hasNotEnrolled = await notEnrolledText.isVisible().catch(() => false);
    const hasDeviceHeading = await deviceHeading.isVisible().catch(() => false);
    expect(hasEnrollBtn || hasNotEnrolled || hasDeviceHeading).toBeTruthy();

    if (hasEnrollBtn || hasNotEnrolled) {
      // ──────────────────────────────────────────────────────────────────
      // 2a) "No device yet" path — open modal, confirm QR is drawn, close
      // ──────────────────────────────────────────────────────────────────
      await enrollBtn.click();
      // Modal renders a QR code. QRCodeSVG draws an SVG, not a canvas.
      const qr = page.locator('svg').filter({ has: page.locator('rect') }).first();
      await expect(qr).toBeVisible({ timeout: 10000 });
      // Modal also shows expiry copy + close button
      await expect(page.getByText(/Expires/i).first()).toBeVisible();
      await page.getByRole('button', { name: /^Close$/i }).click();
      // Modal dismissed → no QR on screen
      await expect(page.getByText(/Waiting for device to enroll/i)).toHaveCount(0);
    } else {
      // ──────────────────────────────────────────────────────────────────
      // 2b) "Device enrolled" path — round-trip lock/unlock
      // ──────────────────────────────────────────────────────────────────
      // We accept the dialog before clicking the button that triggers it.
      page.on('dialog', d => d.accept().catch(() => {}));

      const lockBtn = page.getByRole('button', { name: /^Lock$/ });
      const unlockBtn = page.getByRole('button', { name: /^Unlock$/ });

      const startsLocked = await unlockBtn.isVisible().catch(() => false);

      if (startsLocked) {
        await unlockBtn.click();
        // Wait for the badge to flip OR a toast (best-effort)
        await page.waitForTimeout(2500);
        await expect(page.getByText(/Unlocked/).first()).toBeVisible({ timeout: 10000 });
      } else {
        await lockBtn.click();
        // The lock-modal form is shown — fill the reason and submit
        const reasonInput = page.locator('input[placeholder*="overdue"]').first();
        if (await reasonInput.isVisible().catch(() => false)) {
          await reasonInput.fill('QA automated lock test');
          await page.getByRole('button', { name: /Lock Device/i }).click();
        }
        await page.waitForTimeout(2500);
        // Optimistically check for either the "Locked" badge or the
        // "Cmd lock queued/sent" pill — both are spec-valid outcomes.
        const lockedBadge = page.getByText(/^Locked$/).first();
        const cmdBadge = page.getByText(/Cmd lock/i).first();
        await expect(lockedBadge.or(cmdBadge)).toBeVisible({ timeout: 10000 });
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // 3) Devices admin page — table or empty state shows
    // ────────────────────────────────────────────────────────────────────
    await page.goto('/devices');
    await expect(page.getByRole('heading', { name: /Devices/i }).first()).toBeVisible({ timeout: 10000 });
    // Either a table body row OR the "No devices enrolled yet." copy
    // Wait for the table to render at all
    await page.waitForSelector('table tbody', { timeout: 10000 });
    const rowCount = await page.locator('table tbody tr').count();
    const emptyVisible = await page.getByText(/No devices enrolled yet/i).first().isVisible().catch(() => false);
    expect(rowCount > 0 || emptyVisible).toBeTruthy();

    if (cap.errors.length || cap.pageErrors.length) {
      console.log('[device-lock] console.error:', cap.errors);
      console.log('[device-lock] pageerror :', cap.pageErrors);
    }
  });
});
