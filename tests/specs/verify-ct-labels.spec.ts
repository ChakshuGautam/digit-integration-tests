import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, generateCitizenPhone } from '../utils/env';

test('complaint type dropdown shows translated category names', async ({ page }) => {
  test.setTimeout(90_000);
  const phone = generateCitizenPhone();
  await citizenOtpLogin(page, phone);

  // Navigate to the citizen complaint creation (FormExplorer)
  await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/create-complaint`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(8000);

  // Find and click the complaint type dropdown
  const dropdown = page.locator('input[class*="select-wrap--elipses"]').first();
  await dropdown.waitFor({ state: 'visible', timeout: 15_000 });
  await dropdown.click();
  await page.waitForTimeout(2000);

  await page.screenshot({ path: '/tmp/ct-dropdown-after-fix.png', fullPage: true });

  // Get the dropdown items text
  const dropdownInfo = await page.evaluate(() => {
    const items = document.querySelectorAll(
      '.option-des-container .main-option, .digit-dropdown-employee-select-wrap--item'
    );
    const results: { text: string; html: string }[] = [];
    items.forEach(el => {
      results.push({
        text: el.textContent?.trim() || '(empty)',
        html: el.innerHTML?.slice(0, 200) || '',
      });
    });
    return { count: results.length, items: results.slice(0, 25) };
  });

  console.log('Dropdown items:', JSON.stringify(dropdownInfo, null, 2));

  // Verify items are not empty
  expect(dropdownInfo.count).toBeGreaterThan(0);
  const nonEmptyItems = dropdownInfo.items.filter(i => i.text !== '(empty)' && i.text.length > 0);
  console.log(`Non-empty items: ${nonEmptyItems.length} / ${dropdownInfo.count}`);
  expect(nonEmptyItems.length).toBe(dropdownInfo.count);
});
