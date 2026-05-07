/**
 * User Create E2E — Configurator
 *
 * Validates fixes for:
 *   #461 — Mobile validation uses Kenya-compatible regex (not Indian)
 *   #462 — Mobile field is required (not optional)
 */
import { test, expect } from '@playwright/test';
import { loginConfigurator, CONFIGURATOR_BASE } from '../../utils/configurator-auth';

test.describe('User Create — mobile validation (#461/#462)', () => {
  test.beforeEach(async ({ page }) => {
    await loginConfigurator(page);
  });

  test('mobile field shows Kenya-format help text', { tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:461', '@ccrs:462', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/users/create`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Wait for the form to mount — Mobile Number label must be visible
    await expect(page.getByLabel('Mobile Number')).toBeVisible({ timeout: 15_000 });

    // The help text should reference Kenyan mobile format (from useMobileValidator)
    // Current text: "9 digits starting with 7 or 1 (e.g. 712345678)..."
    await expect(page.getByText('7 or 1')).toBeVisible({ timeout: 10_000 });
  });

  test('mobile field is required — form stays on create page', { tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:461', '@ccrs:462', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/users/create`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Wait for form to render — use input[name] locator since label has asterisk
    const nameInput = page.locator('input[name="name"]');
    await expect(nameInput).toBeVisible({ timeout: 15_000 });

    // Fill Name but leave mobile empty
    await nameInput.fill('Test Required');

    // Submit the form
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(2_000);

    // Form should NOT have navigated away — still on the create page
    // (validation prevents submission for empty required field)
    expect(page.url()).toContain('/users/create');
  });

  test('submit with invalid mobile shows format error', { tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:461', '@ccrs:462', '@kind:edge-case', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/users/create`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Wait for form
    const mobileInput = page.locator('input[name="mobileNumber"]');
    await expect(mobileInput).toBeVisible({ timeout: 15_000 });

    // Fill all fields with an invalid short mobile
    await page.locator('input[name="name"]').fill('Test User');
    await mobileInput.fill('1234');

    // Submit the form
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1_000);

    // Should show validation error (alert role on the error p element)
    const errorAlert = page.getByRole('alert');
    await expect(errorAlert.first()).toBeVisible({ timeout: 5_000 });
    // The error should mention the mobile format
    await expect(errorAlert.first()).toContainText(/mobile|digit|7 or 1/i);
  });

  test('valid Kenya mobile does not show validation error', { tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:461', '@ccrs:462', '@kind:edge-case', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/users/create`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Wait for form
    const mobileInput = page.locator('input[name="mobileNumber"]');
    await expect(mobileInput).toBeVisible({ timeout: 15_000 });

    // Fill with a valid Kenyan mobile (9 digits starting with 7)
    await mobileInput.fill('712345678');
    // Blur to trigger validation
    await page.locator('input[name="name"]').click();
    await page.waitForTimeout(500);

    // No error alerts should be visible for the mobile field
    const mobileErrors = page.getByRole('alert').filter({ hasText: /mobile|digit|7 or 1/i });
    await expect(mobileErrors).toHaveCount(0);
  });
});
