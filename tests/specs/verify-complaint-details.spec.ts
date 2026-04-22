import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL } from '../utils/env';

test('complaint details page loads without crashing', async ({ page }) => {
  test.setTimeout(90_000);

  // Track JS errors
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  await citizenOtpLogin(page, '711111111');

  // Navigate to a complaint that uses a stale/test service code
  await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/complaints/PG-PGR-2026-04-21-001853`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(12000);

  // Page should render complaint details, not be stuck on spinner
  const heading = page.locator('text=Complaint Summary');
  await expect(heading).toBeVisible({ timeout: 5_000 });

  const complaintNo = page.locator('text=PG-PGR-2026-04-21-001853');
  await expect(complaintNo).toBeVisible({ timeout: 5_000 });

  // No JS errors about reading properties of undefined
  const crashErrors = pageErrors.filter(e => e.includes('Cannot read properties of undefined'));
  expect(crashErrors).toHaveLength(0);
});
