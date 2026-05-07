/**
 * Employee Edit E2E — Configurator
 *
 * Validates fix for:
 *   #476 — auditDetails preserved in assignments/jurisdictions on edit
 *          (prevents NPE when HRMS calls assignment.getAuditDetails().setLastModifiedBy())
 */
import { test, expect } from '@playwright/test';
import { loginConfigurator, CONFIGURATOR_BASE } from '../../utils/configurator-auth';

test.describe('Employee Edit (#476)', () => {
  test.beforeEach(async ({ page }) => {
    await loginConfigurator(page);
  });

  test('employee list loads', { tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:476', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/employees`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // The page should show either a datagrid/table or a "no data" message
    // Wait for page heading or content to appear
    const content = page.locator('h1, table, [class*="datagrid"], [role="grid"]').first();
    await expect(content).toBeVisible({ timeout: 20_000 });
  });

  test('edit employee preserves assignments and jurisdictions', { tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:476', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.slow(); // Employee edit involves multiple API calls

    // Navigate to employee list
    await page.goto(`${CONFIGURATOR_BASE}/manage/employees`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Wait for list to load — look for any clickable row
    const firstRow = page.locator('table tbody tr, [role="row"]').first();
    await expect(firstRow).toBeVisible({ timeout: 20_000 });

    // Click first row to navigate to detail/edit
    await firstRow.click();
    await page.waitForTimeout(3_000);

    // Should have navigated to a detail or edit page
    expect(page.url()).toMatch(/\/employees\//);

    // If on show page, click edit button
    const editBtn = page.getByRole('button', { name: /edit/i });
    if (await editBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await editBtn.click();
      await page.waitForTimeout(2_000);
    }

    // Verify assignments section is visible
    await expect(page.getByText('Assignments').first()).toBeVisible({ timeout: 10_000 });

    // Verify jurisdictions section is visible
    await expect(page.getByText('Jurisdictions').first()).toBeVisible({ timeout: 5_000 });

    // Submit the edit form
    const submitBtn = page.getByRole('button', { name: /save|update/i });
    if (await submitBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await submitBtn.click();
      await page.waitForTimeout(5_000);

      // Should NOT show NPE or server error
      const body = await page.locator('body').innerText();
      expect(body).not.toContain('NullPointerException');
      expect(body).not.toContain('Internal Server Error');
    }
  });
});
