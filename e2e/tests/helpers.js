// @ts-check
const { expect } = require('@playwright/test');

/**
 * Attach console + page error capture to a page. Returns array refs you can inspect.
 */
function attachConsoleCapture(page) {
  const errors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(String(err?.message || err));
  });
  return { errors, pageErrors };
}

/**
 * Programmatic login: drives the /login form so localStorage gets the access_token
 * and AuthContext is populated. Returns when navigation to /dashboard or /portal is done.
 * Auto-retries if the backend returns 429 (rate limit).
 */
async function uiLogin(page, email, password, opts = {}) {
  const maxRetries = opts.maxRetries ?? 6;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await page.goto('/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("Sign in")');

    // Wait for either successful navigation or an error toast
    try {
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 });
      return; // success
    } catch (_e) {
      // Look at the on-screen error
      const errText = await page.locator('form .text-red-700').first().innerText().catch(() => '');
      if (/429|rate|too many/i.test(errText)) {
        // backoff and retry
        await page.waitForTimeout(15000);
        continue;
      }
      // Re-throw — something else is wrong
      throw new Error(`Login did not navigate; on-screen error: "${errText}"`);
    }
  }
  throw new Error(`Login failed after ${maxRetries} retries (rate limited)`);
}

module.exports = { attachConsoleCapture, uiLogin };
