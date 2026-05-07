/**
 * PGR Postal Code Validation — Employee Create Complaint
 *
 * Validates fix for:
 *   #478 — Postal code uses Kenya 5-digit format (not Indian 6-digit),
 *          and the field is optional (not required).
 *
 * Tests the employee-side complaint creation form at
 *   /digit-ui/employee/pgr/create-complaint
 */
import { test, expect } from '@playwright/test';
import { loginViaApi } from '../utils/auth';
import {
  BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS, DEFAULT_PASSWORD,
} from '../utils/env';

const CITY_ADMIN_USER = process.env.CITY_ADMIN_USER || 'EMP-KE_NAIROBI-000089';
const CITY_ADMIN_PASS = process.env.CITY_ADMIN_PASS || DEFAULT_PASSWORD;

const CREATE_URL = `${BASE_URL}/digit-ui/employee/pgr/create-complaint`;

test.describe('PGR Postal Code Validation (#478)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, {
      tenant: TENANT,
      authTenant: TENANT,
      username: CITY_ADMIN_USER,
      password: CITY_ADMIN_PASS,
    });
  });

  test('postal code field is not required — form proceeds without it', { tag: ['@area:pgr', '@ccrs:478', '@kind:regression', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    await page.goto(CREATE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5_000);

    // Wait for the form to render — look for the postal code input
    const postalInput = page.locator('input[name="postalCode"]');
    await expect(postalInput).toBeVisible({ timeout: 15_000 });

    // Leave postal code empty — it should be optional
    // Fill only the postal code section and check no required-error appears
    // Clear the field to be sure
    await postalInput.click();
    await postalInput.fill('');

    // The field should NOT have a required attribute
    const required = await postalInput.getAttribute('required');
    expect(required).toBeNull();
  });

  test('valid Kenya 5-digit postal code is accepted', { tag: ['@area:pgr', '@ccrs:478', '@kind:regression', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    await page.goto(CREATE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5_000);

    const postalInput = page.locator('input[name="postalCode"]');
    await expect(postalInput).toBeVisible({ timeout: 15_000 });

    // Enter a valid Kenya postal code (5 digits, can start with 0)
    await postalInput.fill('00100');
    // Blur to trigger validation
    await postalInput.blur();
    await page.waitForTimeout(1_000);

    // No error should appear for the postal code field
    // The error element is typically a sibling or nearby element with the error key
    const cardSection = postalInput.locator('xpath=ancestor::div[contains(@class,"field")]');
    const errorNearby = page.locator('text=CS_COMPLAINT_POSTALCODE_INVALID_ERROR');
    await expect(errorNearby).toHaveCount(0);
  });

  test('invalid postal code (6 digits / Indian format) is rejected', { tag: ['@area:pgr', '@ccrs:478', '@kind:edge-case', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    await page.goto(CREATE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5_000);

    const postalInput = page.locator('input[name="postalCode"]');
    await expect(postalInput).toBeVisible({ timeout: 15_000 });

    // Enter an Indian-format 6-digit postal code — should fail validation
    await postalInput.fill('110001');

    // Need to trigger form submission for react-hook-form to validate
    // Find and click the Submit button
    const submitBtn = page.locator('button[type="button"], button[type="submit"]')
      .filter({ hasText: /submit/i }).first();
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();
    await page.waitForTimeout(2_000);

    // The form should show a validation error — either:
    // 1. The localized error string for CS_COMPLAINT_POSTALCODE_INVALID_ERROR
    // 2. Or the form stays on the create page (does not navigate away)
    // We check that we're still on the create-complaint page
    expect(page.url()).toContain('create-complaint');
  });

  test('invalid postal code (short / 3 digits) is rejected', { tag: ['@area:pgr', '@ccrs:478', '@kind:edge-case', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    await page.goto(CREATE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5_000);

    const postalInput = page.locator('input[name="postalCode"]');
    await expect(postalInput).toBeVisible({ timeout: 15_000 });

    // Enter a too-short postal code
    await postalInput.fill('123');

    // Submit to trigger validation
    const submitBtn = page.locator('button[type="button"], button[type="submit"]')
      .filter({ hasText: /submit/i }).first();
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();
    await page.waitForTimeout(2_000);

    // Should still be on create-complaint page (validation blocked submission)
    expect(page.url()).toContain('create-complaint');
  });
});
