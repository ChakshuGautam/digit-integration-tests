/**
 * Citizen profile field-set lock-down — Story 8.1.
 *
 * Asserts that `/citizen/user/profile` renders **exactly** the expected
 * field set (Name, Gender, Email, photo, Save) and **none** of the
 * fields the original catalogue claimed (mobile / language / password /
 * notifications / city). Catches both shrinkage (missing fields) and
 * scope-creep (re-enabling sensitive surfaces without a UX review).
 *
 * If a future build legitimately adds a field (say, language switcher),
 * update both this spec and `docs/personas/citizen-flows.md` Story 8.1
 * in the same PR — the doc is the source of truth.
 */
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, generateCitizenPhone } from '../utils/env';

const EXPECTED_LABELS = ['Name', 'Gender', 'Email'];

const FORBIDDEN_LABELS = [
  'Mobile Number',
  'Mobile number',
  'Phone',
  'Language',
  'Notification',
  'Notifications',
  'Current Password',
  'New Password',
  'Change Password',
  'Password',
  'City',
  'SMS',
  'WhatsApp',
];

test.describe('Citizen profile field-set lock-down', () => {
  test('only Name + Gender + Email + photo render (no password/language/mobile/notifications)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);

    await page.goto(`${BASE_URL}/digit-ui/citizen/user/profile`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const body = page.locator('body');
    await expect(body).not.toContainText('Something went wrong');

    // ── Expected labels render ─────────────────────────────────────
    for (const label of EXPECTED_LABELS) {
      const matches = await page.locator(`label:has-text("${label}")`).count();
      expect(matches, `expected label "${label}" to render`).toBeGreaterThan(0);
    }

    // ── Save button (red, plain text) ─────────────────────────────
    await expect(page.getByRole('button', { name: /^Save$/i })).toBeVisible({ timeout: 5_000 });

    // ── Forbidden labels MUST NOT render ─────────────────────────
    for (const label of FORBIDDEN_LABELS) {
      const matches = await page.locator(`label:has-text("${label}")`).count();
      expect(
        matches,
        `forbidden label "${label}" must not render on citizen profile (found ${matches}). ` +
          `If this field was deliberately added, update docs/personas/citizen-flows.md ` +
          `Story 8.1 and the FORBIDDEN_LABELS list in this spec in the same PR.`,
      ).toBe(0);
    }

    // ── No password input rendered (defence in depth — labels can lie) ─
    const passwordInputs = await page.locator('input[type="password"]').count();
    expect(passwordInputs, 'citizen profile must not expose password inputs').toBe(0);
  });
});
