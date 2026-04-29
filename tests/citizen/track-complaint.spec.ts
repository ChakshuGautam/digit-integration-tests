/**
 * Citizen track-complaint flow — Stories 4.1, 5.1, 5.2.
 *
 * Files a complaint via API as the test citizen, then walks the citizen
 * UI for the My Complaints list + Complaint Detail + Timeline sections.
 * API-creates so we don't depend on naipepea inventory state for the
 * test citizen — the same phone hits the UI later for browse-only.
 *
 * Asserts the route divergence flagged in the catalogue Routes table:
 * the detail URL is `/citizen/pgr/complaints/:id` (PLURAL), NOT
 * `/complaint/details/:id` as `Routes.js` exports.
 */
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import {
  BASE_URL,
  TENANT,
  ROOT_TENANT,
  FIXED_OTP,
  DEFAULT_PASSWORD,
  SERVICE_CODE,
  LOCALITY_CODE,
  generateCitizenPhone,
} from '../utils/env';

const CITIZEN_PHONE = generateCitizenPhone();
const CITIZEN_NAME = `PW Track ${Date.now()}`;

interface CitizenAuth {
  token: string;
  userInfo: Record<string, unknown>;
}

async function registerCitizenAPI(phone: string): Promise<CitizenAuth> {
  await fetch(`${BASE_URL}/user-otp/v1/_send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      otp: { mobileNumber: phone, tenantId: ROOT_TENANT, type: 'login', userType: 'CITIZEN' },
    }),
  });

  const oauth = async () =>
    fetch(`${BASE_URL}/user/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: phone,
        password: FIXED_OTP,
        tenantId: ROOT_TENANT,
        scope: 'read',
        userType: 'CITIZEN',
      }).toString(),
    });

  let resp = await oauth();
  if (!resp.ok) {
    await fetch(`${BASE_URL}/user/citizen/_create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker' },
        user: {
          name: CITIZEN_NAME,
          userName: phone,
          mobileNumber: phone,
          password: DEFAULT_PASSWORD,
          tenantId: ROOT_TENANT,
          type: 'CITIZEN',
          roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: ROOT_TENANT }],
          otpReference: FIXED_OTP,
        },
      }),
    });
    resp = await oauth();
  }

  const data = (await resp.json()) as { access_token: string; UserRequest: Record<string, unknown> };
  return { token: data.access_token, userInfo: data.UserRequest };
}

async function createComplaintAPI(auth: CitizenAuth): Promise<string> {
  const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: auth.token, userInfo: auth.userInfo },
      service: {
        tenantId: TENANT,
        serviceCode: SERVICE_CODE,
        description: `PW track-complaint test — auto-filed`,
        source: 'web',
        address: {
          city: TENANT,
          locality: { code: LOCALITY_CODE },
          geoLocation: { latitude: 0, longitude: 0 },
        },
        citizen: { name: CITIZEN_NAME, mobileNumber: CITIZEN_PHONE },
      },
      workflow: { action: 'APPLY', verificationDocuments: [] },
    }),
  });
  expect(resp.ok, 'API _create should succeed').toBe(true);
  const data = (await resp.json()) as { ServiceWrappers: Array<{ service: { serviceRequestId: string } }> };
  return data.ServiceWrappers[0].service.serviceRequestId;
}

test.describe.serial('Citizen track-complaint', () => {
  let serviceRequestId: string;

  test.beforeAll(async () => {
    const auth = await registerCitizenAPI(CITIZEN_PHONE);
    serviceRequestId = await createComplaintAPI(auth);
    console.log(`Seeded complaint ${serviceRequestId} for ${CITIZEN_PHONE}`);
  });

  test('My Complaints list shows the seeded complaint with OPEN badge', async ({ page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page, CITIZEN_PHONE);
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/complaints`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const body = page.locator('body');
    await expect(body).toContainText('My Complaints');
    await expect(body).toContainText(serviceRequestId);
    await expect(body).toContainText(/OPEN/);
    await expect(body).toContainText(/Pending for assignment/i);
    await expect(body).not.toContainText('Something went wrong');
  });

  test('Detail page renders Summary / Details / Map / Timeline sections', async ({ page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page, CITIZEN_PHONE);
    await page.goto(
      `${BASE_URL}/digit-ui/citizen/pgr/complaints/${serviceRequestId}`,
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    );
    await page.waitForTimeout(5000);

    const body = page.locator('body');
    await expect(body).toContainText('Complaint Summary');
    await expect(body).toContainText('Complaint Details');
    await expect(body).toContainText('Complaint Timeline');
    await expect(body).toContainText(serviceRequestId);
    await expect(body).toContainText('Application Status');

    // Map widget — "Open in Maps" button
    await expect(page.locator('text=/Open in Maps/i').first()).toBeVisible({ timeout: 10_000 });

    // No crash fallback
    await expect(body).not.toContainText('Something went wrong');
  });

  test('Detail URL uses /complaints/:id (PLURAL) — Routes.js export diverges', async ({ page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page, CITIZEN_PHONE);
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/complaints`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const card = page.locator(`text=${serviceRequestId}`).first();
    await card.waitFor({ state: 'visible', timeout: 10_000 });
    await card.click();
    await page.waitForTimeout(3000);

    const url = page.url();
    expect(url, 'detail URL should be /citizen/pgr/complaints/<id>, plural').toMatch(
      /\/citizen\/pgr\/complaints\/NCCG-PGR-\d{4}-\d{2}-\d{2}-\d+/,
    );
    expect(url, 'detail URL should NOT be the Routes.js-exported singular form').not.toContain(
      '/complaint/details/',
    );
  });
});
