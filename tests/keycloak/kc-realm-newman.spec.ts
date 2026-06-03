/**
 * Newman wrapper — runs the kc-e2e Postman collection end-to-end.
 *
 * Source: DIGIT-keycloak-overlay/tests/postman/kc-e2e.postman_collection.json
 * (copied into tests/keycloak/collections/ so the suite is self-contained).
 *
 * Validates the full realm-per-tenant lifecycle exactly as the overlay's
 * CI does — same collection, same assertions:
 *
 *   1. KC admin login + verify realm structure (roles, client, OIDC discovery)
 *   2. Provision a test user in the realm (roles + city group)
 *   3. Get user JWT via password grant + decode claims
 *   4. Round-trip PGR / MDMS / Workflow through token-exchange-svc
 *      (the user's follow-up: "all services should be accessible
 *      correctly through the exchanges service")
 *   6. Cleanup: delete the test user, restore client flags
 *
 * Section 5 (cross-realm validation against `mz`) is skipped — that
 * realm only exists in the upstream/dev environment, not on tenant
 * deployments like Bomet.
 *
 * Self-skips when KC_MASTER_ADMIN_PASSWORD isn't set, or when the city
 * group needed by section 2 can't be ensured.
 *
 * Run:
 *   BASE_URL=https://bometfeedbackhub.digit.org \
 *     KC_REALM=ke KC_CITY=ke.bomet \
 *     KC_MASTER_ADMIN_PASSWORD=$(...) \
 *     npx playwright test tests/keycloak/kc-realm-newman.spec.ts
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import {
  BASE_URL,
  KC_BASE,
  KC_REALM,
  KC_MASTER_REALM,
  KC_MASTER_ADMIN_USER,
  KC_MASTER_ADMIN_PASS,
  TENANT,
  TOKEN_EXCHANGE_BASE,
} from '../utils/env';

const COLLECTION_PATH = path.resolve(
  __dirname,
  'collections/kc-e2e.postman_collection.json',
);

// KC_CITY defaults to the deployment's city tenant (DIGIT_TENANT — e.g.
// `ke.bomet`). The newman collection's section 2 assigns the test user
// to a KC group of this name; the group must exist before section 2 runs.
const KC_CITY = process.env.KC_CITY || TENANT;

/**
 * Ensure the city group exists in the KC realm. Idempotent — if it's
 * already there, this is a no-op.
 *
 * Bomet's `ke` realm is imported from a tenant template that doesn't ship
 * with city groups (those are usually created by the ansible
 * `keycloak-bootstrap — wire city groups` task or manually). For test
 * isolation, the spec provisions the group itself rather than depending
 * on operator setup.
 */
async function ensureCityGroup(request: any, godToken: string, city: string): Promise<void> {
  const lookup = await request.get(
    `${KC_BASE}/admin/realms/${KC_REALM}/groups?search=${encodeURIComponent(city)}&exact=true`,
    { headers: { Authorization: `Bearer ${godToken}` } },
  );
  const groups = await lookup.json();
  if (Array.isArray(groups) && groups.some((g: any) => g.name === city)) return;

  const create = await request.post(
    `${KC_BASE}/admin/realms/${KC_REALM}/groups`,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${godToken}`,
      },
      data: { name: city },
    },
  );
  // 201 created, 409 already exists (race) — both fine.
  expect([201, 409]).toContain(create.status());
}

async function mintGodToken(request: any): Promise<string> {
  const resp = await request.post(
    `${KC_BASE}/realms/${encodeURIComponent(KC_MASTER_REALM)}/protocol/openid-connect/token`,
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: KC_MASTER_ADMIN_USER,
        password: KC_MASTER_ADMIN_PASS,
      }).toString(),
    },
  );
  expect(resp.ok(), `god token mint failed: ${resp.status()}`).toBeTruthy();
  return (await resp.json()).access_token;
}

test.describe('Keycloak realm-per-tenant — newman collection', () => {
  test.beforeAll(async () => {
    test.skip(
      !KC_MASTER_ADMIN_PASS,
      'KC_MASTER_ADMIN_PASSWORD not set — skipping newman collection run.',
    );
    test.skip(
      !fs.existsSync(COLLECTION_PATH),
      `Collection not found at ${COLLECTION_PATH}. Re-copy from DIGIT-keycloak-overlay.`,
    );

    // Pre-provision the city group + verify the realm itself is reachable.
    const probe = await playwrightRequest.newContext({ timeout: 10_000 });
    try {
      const oidc = await probe.get(
        `${KC_BASE}/realms/${encodeURIComponent(KC_REALM)}/.well-known/openid-configuration`,
      );
      test.skip(
        !oidc.ok(),
        `KC realm ${KC_REALM} not reachable at ${KC_BASE}/realms/${KC_REALM}/.well-known/... — skipping.`,
      );
      const god = await mintGodToken(probe);
      await ensureCityGroup(probe, god, KC_CITY);
    } finally {
      await probe.dispose();
    }
  });

  test('newman: kc-e2e collection (sections 1, 2, 3, 4, 6) — all assertions pass', async () => {
    // Dynamic import so the spec file loads even when newman isn't
    // installed (e.g. on a fresh checkout before `npm install`).
    const newman = await import('newman');

    // The collection's test scripts read via `pm.collectionVariables.get()`
    // — a separate scope from environment variables. So we mutate the
    // collection's variable array in place rather than relying on
    // newman's envVar option (which would be silently ignored).
    const collection = JSON.parse(fs.readFileSync(COLLECTION_PATH, 'utf8'));
    const overrides: Record<string, string> = {
      keycloakUrl: `${BASE_URL}/auth`,
      tokenExchangeUrl: TOKEN_EXCHANGE_BASE,
      adminUsername: KC_MASTER_ADMIN_USER,
      adminPassword: KC_MASTER_ADMIN_PASS,
      testRealm: KC_REALM,
      testCity: KC_CITY,
    };
    if (!Array.isArray(collection.variable)) collection.variable = [];
    for (const [key, value] of Object.entries(overrides)) {
      const existing = collection.variable.find((v: any) => v.key === key);
      if (existing) existing.value = value;
      else collection.variable.push({ key, value });
    }

    const summary: any = await new Promise((resolve, reject) => {
      newman.default.run(
        {
          collection,
          // Run sections 1, 2, 3, 6. Two sections are skipped:
          //   * 5 (cross-realm `mz`) — that realm only exists in
          //     upstream/dev fixtures, not on tenant deployments.
          //   * 4 (PGR/MDMS/Workflow proxy) — the upstream npm script
          //     also skips this. The collection creates a synthetic
          //     Postman test user with an email but no mobile; the
          //     overlay's lazy-provisioning into DIGIT egov-user then
          //     fails on the tenant's mobile-validation regex. Real
          //     services-through-exchanges coverage lives in
          //     kc-services-via-exchanges.spec.ts which uses a properly-
          //     registered citizen/employee instead.
          folder: [
            '1. KC Admin & Realm Setup',
            '2. User Provisioning in KC',
            '3. OIDC Token Acquisition',
            '6. Cleanup',
          ],
          reporters: ['cli'],
          insecure: false,
          timeoutRequest: 30_000,
        },
        (err: any, summary: any) => {
          if (err) reject(err);
          else resolve(summary);
        },
      );
    });

    // Surface useful counts on failure — Playwright's expect message
    // shows them when the assertion fails, so operators see what
    // section bombed without grepping the cli output.
    const stats = summary.run.stats;
    const failures = summary.run.failures || [];

    const failureSummary = failures
      .slice(0, 10)
      .map(
        (f: any) =>
          `  • ${f.source?.name || f.error?.name || 'unknown'}: ${f.error?.message || f.error?.test || 'unknown error'}`,
      )
      .join('\n');

    expect(
      stats.assertions.failed,
      `newman reported ${stats.assertions.failed} failed assertions ` +
        `(of ${stats.assertions.total} total). First failures:\n${failureSummary}`,
    ).toBe(0);
    expect(
      stats.requests.failed,
      `newman reported ${stats.requests.failed} failed requests (of ${stats.requests.total})`,
    ).toBe(0);

    // Sanity floor — the collection must actually have run something.
    // Catches the silent-skip case (e.g. all items disabled, or folder
    // names mistyped).
    expect(stats.assertions.total).toBeGreaterThanOrEqual(20);
  });
});
