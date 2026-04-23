/**
 * Theme editor UI test — regression guard for PR #4 (flagship theme editor).
 *
 * Asserts that /manage/theme-config/<id>/edit renders the dedicated editor
 * (tabs + grouped color pickers + live preview) rather than the generic
 * form. Also asserts the preview actually watches form state — editing a
 * color in the form should mutate the matching element's style in the
 * preview on the next render.
 *
 * If the `customEditor` escape hatch on SchemaDescriptor regresses, the
 * fallback would be the generic MdmsResourceEdit form (no tabs, no preview)
 * — this spec catches that.
 */
import { test, expect } from '@playwright/test';
import { loginConfigurator, CONFIGURATOR_BASE } from '../../utils/configurator-auth';
import { getDigitToken } from '../../utils/auth';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../../utils/env';

const THEME_RECORD_ID = 'kenya-green';

test.describe('Theme editor UI (PR #4)', () => {
  test.beforeEach(async ({ page }) => {
    await loginConfigurator(page);
  });

  test('edit page renders the flagship editor (tabs + preview)', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto(
      `${CONFIGURATOR_BASE}/manage/theme-config/${THEME_RECORD_ID}`,
      { waitUntil: 'networkidle', timeout: 30_000 },
    );

    // Click the Show view's Edit button to land on the editor.
    const editLink = page.getByRole('link', { name: /edit/i }).first();
    const editButton = page.getByRole('button', { name: /edit/i }).first();
    await Promise.race([
      editLink.click({ timeout: 5_000 }).catch(() => null),
      editButton.click({ timeout: 5_000 }).catch(() => null),
      page.goto(`${CONFIGURATOR_BASE}/manage/theme-config/${THEME_RECORD_ID}/edit`, {
        waitUntil: 'networkidle',
        timeout: 15_000,
      }),
    ]);

    // ────────────────────────────────────────────────────────────────
    // Assertion 1. Tabs render — means customEditor hatch fired.
    // ────────────────────────────────────────────────────────────────
    const tabLabels = ['Primary / Link', 'Text', 'Grey', 'Charts'];
    for (const label of tabLabels) {
      const tab = page.getByRole('tab', { name: label }).first();
      await expect(tab, `tab "${label}" should render`).toBeVisible({ timeout: 15_000 });
    }

    // ────────────────────────────────────────────────────────────────
    // Assertion 2. Preview widget present — something with the
    // theme-preview root class or "Live preview" label.
    // ────────────────────────────────────────────────────────────────
    const preview = page.locator('.theme-preview, [data-token]').first();
    await expect(preview, 'live preview should render').toBeVisible({ timeout: 10_000 });

    // ────────────────────────────────────────────────────────────────
    // Assertion 3. Color inputs bind to data-token'd preview elements.
    // Find the primary.main color input and the preview button that
    // uses it; change the hex, verify the preview's computed color
    // updates.
    // ────────────────────────────────────────────────────────────────

    // Switch to the Primary/Link tab so the input is visible.
    await page.getByRole('tab', { name: 'Primary / Link' }).first().click({ timeout: 10_000 });

    // The ColorInput renders a native <input type=color> + a text box.
    // The text box is what we can drive reliably across browsers.
    const primaryMainRow = page
      .locator('text=/Primary\\s*\\/\\s*main/i')
      .first()
      .locator('..')
      .locator('..');
    const hexInput = primaryMainRow.locator('input[type="text"]').first();
    await expect(hexInput, 'primary.main hex input should be present').toBeVisible({ timeout: 10_000 });

    const originalHex = await hexInput.inputValue();

    // A clearly-distinct test color — hot pink, won't collide with any
    // kenya-green or DIGIT default.
    const TEST_HEX = '#FF1493';
    await hexInput.fill(TEST_HEX);
    await hexInput.blur();

    // Read the computed bg color off any preview element tagged with
    // `data-token~="colors.primary.main"`.
    const previewButton = page.locator('[data-token~="colors.primary.main"]').first();
    await expect(previewButton).toBeVisible();

    // Computed color is in rgb() form — rgb(255, 20, 147) for #FF1493.
    await expect
      .poll(async () =>
        previewButton.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor),
      { timeout: 5_000 })
      .toBe('rgb(255, 20, 147)');

    // Revert so the test is idempotent.
    await hexInput.fill(originalHex);
    await hexInput.blur();
  });

  test('ThemeConfig record is readable on the expected tenant', async ({}) => {
    // API-layer smoke: the record editor is pointed at really has to
    // exist, otherwise the UI test above would fail for a confusing
    // reason (no record to edit). Fail fast with a clearer message.
    const t = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    const resp = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: {
          apiId: 'Rainmaker', ver: '1.0', ts: Date.now(),
          msgId: `${Date.now()}|en_IN`, authToken: t.access_token,
        },
        MdmsCriteria: {
          tenantId: ROOT_TENANT, schemaCode: 'common-masters.ThemeConfig',
          uniqueIdentifiers: [THEME_RECORD_ID],
        },
      }),
    });
    const body = (await resp.json()) as { mdms?: Array<{ data?: { colors?: unknown } }> };
    expect(body.mdms?.length, `${THEME_RECORD_ID} must exist on ${ROOT_TENANT}`).toBe(1);
    expect(body.mdms?.[0].data?.colors, 'record should carry a colors tree').toBeTruthy();
  });
});
