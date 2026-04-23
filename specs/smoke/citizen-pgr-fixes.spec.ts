/**
 * Regression tests for citizen-side bugs fixed in theflywheel/digit-ui-esbuild.
 * Each test references the egovernments/CCRS issue it covers.
 *
 * - #421 — landing page ServicesSection top padding must equal side padding.
 * - #422 — navigating into Create New Complaint must not leave the user
 *          scrolled to the middle of the page (the old `history.listen`
 *          handler leaked across renders and fired before mount).
 * - #441 — rating submit without any "What was good?" checkbox must not
 *          crash the UI. Requires a complaint in RESOLVED state to exercise
 *          the form, which isn't deterministic in a shared deployment —
 *          currently asserted via bundle-level grep until we wire a full
 *          lifecycle fixture.
 */
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../../tests/utils/citizen-login';
import { BASE_URL, generateCitizenPhone } from '../../tests/utils/env';

test.describe('citizen PGR regression — shipped fixes', () => {
  test('#421 — landing ServicesSection top padding matches side padding', async ({ page }) => {
    // The CSS override lives in /digit-ui/vendor/overrides.css and is
    // loaded by public/index.html after the vendor digit-ui-css bundle.
    // If either the file stops being served or the <link> is reordered
    // ahead of digit-ui-css.css, this test catches it.
    await citizenOtpLogin(page, generateCitizenPhone());

    const services = page.locator('.HomePageWrapper .ServicesSection').first();
    await expect(services).toBeVisible({ timeout: 20_000 });

    const padding = await services.evaluate((el) => {
      const cs = getComputedStyle(el as HTMLElement);
      return {
        top: cs.paddingTop,
        left: cs.paddingLeft,
        right: cs.paddingRight,
      };
    });

    expect(padding.top).toBe('15px');
    expect(padding.left).toBe('15px');
    expect(padding.right).toBe('15px');
  });

  test('#422 — navigating into Create New Complaint lands at top of page', async ({ page }) => {
    await citizenOtpLogin(page, generateCitizenPhone());

    // Scroll the home page down so we can observe the reset on navigation.
    // Different content heights per tenant, so use an offset that'd be
    // visible on any reasonable viewport.
    await page.evaluate(() => window.scrollTo(0, 600));
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(100);

    // Enter the create-complaint wizard. The button text varies by
    // localization; match the citizen services card for Complaint.
    const complaintCard = page
      .locator('[class*="CardBasedOptions"], .digit-card')
      .filter({ hasText: /Complaint|COMPLAINT|PGR/i })
      .first();
    await complaintCard.click({ timeout: 10_000 });

    // Wait for navigation + new-page render. Paint timing varies; poll.
    await page.waitForURL(/pgr|complaint/i, { timeout: 15_000 });
    await page.waitForLoadState('domcontentloaded');

    // Allow one frame for the effect + useEffect scrollTo to run.
    await page.waitForTimeout(500);

    const after = await page.evaluate(() => window.scrollY);
    expect(after).toBe(0);
  });

  test.fixme(
    '#441 — submit rating without "What was good?" boxes does not crash',
    async ({ page }) => {
      // TODO: needs a complaint in RESOLVED state belonging to a citizen
      // we control. Either chain off pgr-lifecycle-ui.spec.ts (which
      // already resolves one) or bootstrap via the PGR API before the
      // browser step. Until then, the code-level guard is verified
      // offline with `grep isArray(.*CS_FEEDBACK_WHAT_WAS_GOOD)` on
      // `build/index.js`.
      void page; // placeholder so the fixme block type-checks
    },
  );
});
