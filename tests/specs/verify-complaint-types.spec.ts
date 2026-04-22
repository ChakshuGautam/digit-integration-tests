import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, generateCitizenPhone } from '../utils/env';

test('verify complaint type dropdown shows labels', async ({ page }) => {
  test.setTimeout(90_000);

  const phone = generateCitizenPhone();
  await citizenOtpLogin(page, phone);

  await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/create-complaint`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(10000);

  // Click dropdown with Playwright (not evaluate)
  const dropdown = page.locator('input[class*="select-wrap--elipses"]').first();
  await dropdown.waitFor({ state: 'visible', timeout: 10_000 });
  await dropdown.click();
  await page.waitForTimeout(2000);

  // Now dump the DOM around the opened dropdown
  const domDump = await page.evaluate(() => {
    // The dropdown items typically appear as children of a container near the input
    const input = document.querySelector('input[class*="select-wrap--elipses"]');
    if (!input) return { error: 'no input found' };

    // Walk up to find the dropdown container, then look for option elements
    const wrapper = input.closest('.select-wrap') || input.closest('[class*="select"]') || input.parentElement;
    const wrapperHtml = wrapper?.innerHTML || '';

    // Also look for the dropdown items anywhere in the document
    const allItems = document.querySelectorAll('.digit-dropdown-employee-select-wrap--item, [class*="option-item"], [class*="dropdown-item"]');

    // Try broader: any div that appeared after click with many children
    let itemContainer: Element | null = null;
    const containers = wrapper?.querySelectorAll('div') || [];
    for (const c of containers) {
      if (c.children.length > 5 && c.scrollHeight > 100) {
        itemContainer = c;
        break;
      }
    }

    return {
      wrapperClass: wrapper?.className || '',
      wrapperChildCount: wrapper?.children.length || 0,
      wrapperHtml: wrapperHtml.slice(0, 3000),
      directItems: allItems.length,
      containerFound: !!itemContainer,
      containerClass: itemContainer?.className || '',
      containerChildren: itemContainer?.children.length || 0,
      firstChildHtml: itemContainer?.children[0]?.outerHTML?.slice(0, 300) || '',
      secondChildHtml: itemContainer?.children[1]?.outerHTML?.slice(0, 300) || '',
    };
  });
  console.log('DOM dump:', JSON.stringify(domDump, null, 2));

  // Test the t() function directly
  const tTest = await page.evaluate(() => {
    const Digit = (window as any).Digit;
    // Try to get i18n instance
    const i18n = (window as any).i18next || (window as any).i18n;

    // Check if we can translate
    const testKeys = ['SERVICEDEFS.WATERRELATED', 'SERVICEDEFS.ADMINISTRATION', 'SERVICEDEFS.ANIMALS', 'CS_HEADER_COMPLAINT_TRACKING'];
    const results: Record<string, string> = {};

    if (i18n?.t) {
      for (const k of testKeys) results[k] = i18n.t(k);
    }

    // Also check Redux store
    const store = Digit?.ComponentRegistryService?.Store;

    return {
      i18nExists: !!i18n,
      tExists: !!i18n?.t,
      results,
      i18nLanguage: i18n?.language || 'n/a',
    };
  });
  console.log('t() test:', JSON.stringify(tTest, null, 2));

  await page.screenshot({ path: '/tmp/verify-ct-dropdown-open.png', fullPage: true });
});
