import { test } from '@playwright/test';

test('capture MDMS calls from login page', { tag: ['@area:mdms-schema', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
  test.setTimeout(60_000);

  const mdmsCalls: any[] = [];

  page.on('request', req => {
    const url = req.url();
    if (url.includes('mdms') && req.method() === 'POST') {
      let bodyText = '';
      try { bodyText = req.postData() || ''; } catch {}
      mdmsCalls.push({ url, body: bodyText });
    }
  });

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('mdms') && url.includes('_search')) {
      try {
        const body = await resp.json();
        const tcalls = mdmsCalls.find(c => !c.response && c.url === url);
        if (tcalls) tcalls.response = body;
      } catch {}
    }
  });

  await page.goto('https://naipepea.digit.org/digit-ui/citizen/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);

  // Print all MDMS calls that mentioned mobile/Validation
  for (const c of mdmsCalls) {
    const body = c.body || '';
    if (body.includes('mobileNumberValidation') || body.includes('UserValidation') || body.includes('ValidationConfigs')) {
      console.log('=== MDMS CALL ===');
      console.log('URL:', c.url);
      try {
        const parsed = JSON.parse(body);
        console.log('Tenant:', parsed?.MdmsCriteria?.tenantId);
        console.log('Modules:', JSON.stringify(parsed?.MdmsCriteria?.moduleDetails));
      } catch {
        console.log('Body (raw):', body.slice(0, 300));
      }
      if (c.response) {
        const tc = c.response?.MdmsRes?.ValidationConfigs?.mobileNumberValidation;
        console.log('Returned mobileNumberValidation:', JSON.stringify(tc));
      }
    }
  }

  console.log('---');
  console.log('Total MDMS POSTs:', mdmsCalls.length);

  // Also check what stateId the UI sees
  const stateId = await page.evaluate(() => (window as any).globalConfigs?.getConfig?.('STATE_LEVEL_TENANT_ID'));
  console.log('STATE_LEVEL_TENANT_ID in window.globalConfigs:', stateId);
});
