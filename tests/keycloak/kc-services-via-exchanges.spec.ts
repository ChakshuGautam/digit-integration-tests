/**
 * Services through token-exchange-svc — RBAC + round-trip contract
 *
 * Validates that core DIGIT services are correctly accessible through the
 * exchanges service (token-exchange-svc) when called with a KC-issued JWT.
 * The overlay validates the JWT, resolves the DIGIT user, swaps in a DIGIT
 * system token, and forwards to Kong → service. A 200 here proves the full
 * chain works for that endpoint; a 401/403/5xx names which link broke.
 *
 * Covers (4 services):
 *   1. MDMS v2     — POST /mdms-v2/v2/_search
 *   2. HRMS        — POST /egov-hrms/employees/_search
 *   3. Workflow    — POST /egov-workflow-v2/egov-wf/businessservice/_search
 *   4. Localization — POST /localization/messages/v1/_search (200 — read)
 *
 * Auth: uses ADMIN/EMPLOYEE via the overlay's password grant (the
 * production auth path), not a synthetic test user — so the lazy-
 * provisioning code path is exercised with a user that has the mobile/
 * email shape Bomet's validation actually accepts.
 *
 * Self-skips when the overlay or KC realm aren't reachable.
 *
 * Run:
 *   BASE_URL=https://bometfeedbackhub.digit.org \
 *     KC_REALM=ke ROOT_TENANT=ke DIGIT_TENANT=ke.bomet \
 *     npx playwright test tests/keycloak/kc-services-via-exchanges.spec.ts
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  BASE_URL,
  TENANT,
  ROOT_TENANT,
  ADMIN_USER,
  ADMIN_PASS,
  KC_BASE,
  KC_REALM,
  KC_CLIENT_ID,
  TOKEN_EXCHANGE_BASE,
  decodeJwtPayload,
} from '../utils/env';

const OVERLAY_TOKEN_URL = `${TOKEN_EXCHANGE_BASE}/realms/${encodeURIComponent(KC_REALM)}/protocol/openid-connect/token`;
const WELL_KNOWN = `${KC_BASE}/realms/${encodeURIComponent(KC_REALM)}/.well-known/openid-configuration`;

// Shared KC JWT used by every test in this file. Minted once in beforeAll
// to keep the run fast — these tests are read-mostly and don't need
// independent auth state per case.
let kcJwt = '';

async function mintAdminJwt(request: any): Promise<string> {
  const resp = await request.post(OVERLAY_TOKEN_URL, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({
      grant_type: 'password',
      client_id: KC_CLIENT_ID,
      username: ADMIN_USER,
      password: ADMIN_PASS,
      scope: 'openid',
      tenantId: ROOT_TENANT,
      userType: 'EMPLOYEE',
    }).toString(),
  });
  expect(
    resp.ok(),
    `overlay password grant for ADMIN failed (${resp.status()}): ${await resp.text()}`,
  ).toBeTruthy();
  const body = await resp.json();
  expect(body.access_token).toBeTruthy();
  return body.access_token;
}

test.describe('Services round-trip through token-exchange-svc', () => {
  test.beforeAll(async () => {
    const probe = await playwrightRequest.newContext({ timeout: 8000 });
    try {
      const oidc = await probe.get(WELL_KNOWN);
      test.skip(
        !oidc.ok(),
        `Keycloak realm ${KC_REALM} not reachable at ${WELL_KNOWN}.`,
      );
      const overlay = await probe.get(`${TOKEN_EXCHANGE_BASE}/healthz`);
      test.skip(
        !overlay.ok(),
        `token-exchange-svc not reachable at ${TOKEN_EXCHANGE_BASE}/healthz.`,
      );
      kcJwt = await mintAdminJwt(probe);
      const claims = decodeJwtPayload(kcJwt);
      // Sanity — without realm_access.roles the downstream RBAC inside
      // the services often 403s in confusing ways. Surface it here.
      expect(
        claims.realm_access?.roles,
        'minted JWT lacks realm_access.roles — service-side RBAC will silently 403',
      ).toBeTruthy();
    } finally {
      await probe.dispose();
    }
  });

  test('MDMS v2 search via /token-exchange/* — 200 with non-401 (lazy provision works)', async ({ request }) => {
    const resp = await request.post(
      `${TOKEN_EXCHANGE_BASE}/mdms-v2/v2/_search`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${kcJwt}`,
        },
        data: {
          RequestInfo: { authToken: kcJwt },
          MdmsCriteria: {
            tenantId: ROOT_TENANT,
            moduleDetails: [
              { moduleName: 'common-masters', masterDetails: [{ name: 'StateInfo' }] },
            ],
          },
        },
      },
    );
    // Not gating on data presence — Bomet's MDMS may or may not have a
    // StateInfo row. What we ARE gating: the overlay's JWT validator
    // accepted the token (not 401) and Kong proxied the call.
    expect(
      resp.status(),
      `expected non-401 from MDMS through exchange: ${await resp.text()}`,
    ).not.toBe(401);
    expect(
      resp.status(),
      `expected non-5xx from MDMS through exchange: ${await resp.text()}`,
    ).toBeLessThan(500);
  });

  test('HRMS employees search via /token-exchange/* — 200 with Employees array', async ({ request }) => {
    const resp = await request.post(
      `${TOKEN_EXCHANGE_BASE}/egov-hrms/employees/_search?tenantId=${encodeURIComponent(TENANT)}&offset=0&limit=5`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${kcJwt}`,
        },
        data: { RequestInfo: { authToken: kcJwt } },
      },
    );
    expect(resp.ok(), `HRMS through exchange failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
    const body = await resp.json();
    // Employees is the load-bearing field — even an empty list is fine
    // (proves the chain works), but the field must exist or HRMS errored.
    expect(Array.isArray(body.Employees), `HRMS response shape unexpected: ${JSON.stringify(body).slice(0, 200)}`).toBe(true);
  });

  test('Workflow businessservice search via /token-exchange/* — 200 with BusinessServices array', async ({ request }) => {
    const resp = await request.post(
      `${TOKEN_EXCHANGE_BASE}/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=${encodeURIComponent(TENANT)}`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${kcJwt}`,
        },
        data: { RequestInfo: { authToken: kcJwt } },
      },
    );
    expect(
      resp.ok(),
      `Workflow through exchange failed: ${resp.status()} ${await resp.text()}`,
    ).toBeTruthy();
    const body = await resp.json();
    expect(
      Array.isArray(body.BusinessServices),
      `workflow shape unexpected: ${JSON.stringify(body).slice(0, 200)}`,
    ).toBe(true);
  });

  test('Localization search via /token-exchange/* — 200 with messages array', async ({ request }) => {
    const resp = await request.post(
      `${TOKEN_EXCHANGE_BASE}/localization/messages/v1/_search?` +
        `locale=en_IN&module=rainmaker-common&tenantId=${encodeURIComponent(ROOT_TENANT)}`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${kcJwt}`,
        },
        data: { RequestInfo: { authToken: kcJwt } },
      },
    );
    expect(
      resp.ok(),
      `Localization through exchange failed: ${resp.status()} ${await resp.text()}`,
    ).toBeTruthy();
    const body = await resp.json();
    expect(
      Array.isArray(body.messages),
      `localization shape unexpected: ${JSON.stringify(body).slice(0, 200)}`,
    ).toBe(true);
  });
});
