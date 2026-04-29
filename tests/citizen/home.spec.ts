/**
 * Citizen home + landing surfaces — Stories 2.1, 2.2, 2.3.
 *
 * Three surfaces:
 *   - /citizen/all-services — post-login default landing
 *   - /citizen/pgr-home     — branded "Nai Pepea" PGR module home
 *   - Header language pill — toggles localization
 *
 * Also smoke-checks that /citizen/ redirects to /all-services (per the
 * Routes table in docs/personas/citizen-flows.md).
 */
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, generateCitizenPhone } from '../utils/env';

test.describe('Citizen home + landing', () => {
  test('/citizen/ redirects to /citizen/all-services', async ({ page }) => {
    test.setTimeout(60_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);

    await page.goto(`${BASE_URL}/digit-ui/citizen`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    expect(page.url()).toContain('/citizen/all-services');
  });

  test('/all-services renders CCRS title + File a Complaint + My Complaints links', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);

    await page.goto(`${BASE_URL}/digit-ui/citizen/all-services`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    const body = page.locator('body');
    await expect(body).not.toContainText('Something went wrong');
    await expect(body).toContainText('Citizen Complaint Resolution System');
    await expect(body).toContainText('File a Complaint');
    await expect(body).toContainText('My Complaints');

    // Sidebar inventory — Story 2.x note
    for (const item of ['Home', 'Edit Profile', 'Logout', 'HELPLINE']) {
      await expect(body, `sidebar item "${item}" missing`).toContainText(item);
    }
  });

  test('/pgr-home renders the branded "Nai Pepea" hero', async ({ page }) => {
    test.setTimeout(60_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);

    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr-home`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    const body = page.locator('body');
    await expect(body).not.toContainText('Something went wrong');
    await expect(body).toContainText('Nai Pepea');
    await expect(body).toContainText(/Report a grievance/i);
    await expect(body).toContainText('Nairobi City County Government');
    await expect(body).toContainText('PGR');
  });

  test('header language pill renders + opens dropdown on click', async ({ page }) => {
    test.setTimeout(60_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);
    await page.waitForTimeout(2000);

    // Pill shows current language label (English by default on this build)
    const pill = page.locator('header :text("English"), [class*="header"] :text("English")').first();
    await expect(pill).toBeVisible({ timeout: 5_000 });

    // Click pill → dropdown / option list of available locales should appear
    await pill.click();
    await page.waitForTimeout(1000);

    // We don't assert which languages — depends on common-masters.StateInfo
    // seed; just that *some* option list is now present in the DOM.
    const options = await page
      .locator('[role="option"], [role="listbox"] li, [class*="dropdown-item"]')
      .count();
    expect(options, 'language pill click should reveal options').toBeGreaterThan(0);
  });
});
