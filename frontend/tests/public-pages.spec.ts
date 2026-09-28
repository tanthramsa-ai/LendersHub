import { test, expect } from '@playwright/test';

test('workspace selection remembers the workspace and reaches its own login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Workspace', { exact: true }).fill('Acme');
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/acme\/login$/);
  expect(await page.evaluate(() => localStorage.getItem('lh_last_workspace'))).toBe('acme');
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
});

test('tenant email login retains real OTP API requests, errors, and back navigation', async ({ page }) => {
  let credentials: unknown;
  let verification: unknown;
  await page.route('**/api/v1/tenant/auth/login', async route => {
    credentials = route.request().postDataJSON();
    await route.fulfill({ json: { requiresOtp: true, tempToken: 'test-temp-token', maskedPhone: 'XXXXXX3210' } });
  });
  await page.route('**/api/v1/tenant/auth/verify-otp', async route => {
    verification = route.request().postDataJSON();
    await route.fulfill({ status: 401, json: { message: 'Invalid or expired OTP' } });
  });
  await page.goto('/acme/login');
  await page.getByLabel('Mobile Number or Email', { exact: true }).fill('agent@example.com');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('One-Time Password')).toBeVisible();
  expect(credentials).toEqual({ email: 'agent@example.com', password: 'test-password', subdomain: 'acme' });
  await page.getByLabel('One-Time Password').fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.lh-public').getByRole('alert')).toContainText('Invalid or expired OTP');
  expect(verification).toEqual({ tempToken: 'test-temp-token', otp: '123456' });
  await page.getByRole('button', { name: /back/i }).click();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
});

test('phone validation and server rejection stay visible', async ({ page }) => {
  await page.route('**/api/v1/tenant/auth/login', async route => {
    expect(route.request().postDataJSON()).toEqual({ phone: '9876543210', password: 'test-password', subdomain: 'acme' });
    await route.fulfill({ status: 401, json: { message: 'Invalid credentials' } });
  });
  await page.goto('/acme/login');
  await page.getByLabel('Mobile Number or Email', { exact: true }).fill('98765');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await page.getByLabel('Mobile Number or Email', { exact: true }).fill('9876543210');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.lh-public').getByRole('alert')).toContainText('Invalid credentials');
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/acme/forgot-password');
});

for (const width of [360, 820, 1440]) {
  test(`public pages fit the ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/', '/login', '/acme/login', '/super-admin/login']) {
      await page.goto(path);
      await expect(page.locator('h1').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/public-${path === '/' ? 'landing' : path === '/login' ? 'workspace' : path === '/acme/login' ? 'signin' : 'admin'}-${width}.png`, fullPage: true });
    }
  });
}
