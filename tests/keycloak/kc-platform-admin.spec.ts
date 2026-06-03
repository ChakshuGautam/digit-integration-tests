/**
 * Platform-admin gateway — API contract tests
 *
 * The token-exchange-svc overlay exposes /platform-admin/* routes that
 * proxy to DIGIT-MCP, gated by a Keycloak master-realm JWT. Two personas:
 *
 *   GOD     — KC master realm built-in admin (preferred_username=admin) OR
 *             any user with the PLATFORM_ADMIN realm role. Can call any
 *             /v1/* endpoint and provision scoped admins.
 *   SCOPED  — KC master realm user with role bootstrap:<tenantId>. Can
 *             call tenant_bootstrap / tenant/city / tenant/cleanup ONLY
 *             when the request's target tenant matches the role's tenant.
 *
 * Covers (10 tests):
 *
 *   AUTH GATE (3)
 *     1. No Authorization header                 → 401
 *     2. Tenant-realm JWT (ke/ke.bomet/etc.)     → 403 (tokenRealm exposed)
 *     3. Malformed/invalid JWT                   → 401
 *
 *   GOD PATH (3)
 *     4. Master JWT carries realm_access.roles   (fullScopeAllowed gate)
 *     5. God hits /v1/version                    → 200 + service=digit-mcp
 *     6. God creates a scoped admin              → 201 + bootstrap:<id> role
 *
 *   SCOPED DELEGATION (4)
 *     7. Scoped JWT carries bootstrap:<X> role
 *     8. Scoped admin bootstraps OWN tenant      → 200 + summary present
 *     9. Scoped admin bootstraps OTHER tenant    → 403 "scope mismatch"
 *    10. Scoped admin tries god-only endpoints   → 403 on /v1/version AND
 *                                                       /scoped-admins/_create
 *
 * Teardown: deletes the scoped KC user created in test 6.
 * NOTE: API teardown — KC users are not surfaced in any UI in this stack.
 * The bootstrapped tenant in test 8 is intentionally left in MDMS: the
 * MCP bootstrap is heavy (1000+ records) and there's no fast soft-delete
 * path; tenant IDs are timestamped so they don't collide across runs.
 *
 * Self-skips when KC_MASTER_ADMIN_PASSWORD isn't set or when
 * /platform-admin/v1/version 404s (the overlay route isn't deployed).
 *
 * Run:
 *   BASE_URL=https://bometfeedbackhub.digit.org \
 *     KC_REALM=ke \
 *     KC_MASTER_ADMIN_PASSWORD=$(ssh egov-bomet 'docker exec token-exchange-svc printenv KEYCLOAK_ADMIN_PASSWORD') \
 *     npx playwright test tests/keycloak/kc-platform-admin.spec.ts
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  BASE_URL,
  KC_BASE,
  KC_REALM,
  KC_CLIENT_ID,
  KC_MASTER_REALM,
  KC_MASTER_ADMIN_USER,
  KC_MASTER_ADMIN_PASS,
  PLATFORM_ADMIN_BASE,
  ROOT_TENANT,
  decodeJwtPayload,
  generateCitizenPhone,
  FIXED_OTP,
} from '../utils/env';

const MASTER_REALM_BASE = `${KC_BASE}/realms/${encodeURIComponent(KC_MASTER_REALM)}`;
const MASTER_TOKEN_URL = `${MASTER_REALM_BASE}/protocol/openid-connect/token`;
const TENANT_TOKEN_URL = `${KC_BASE}/realms/${encodeURIComponent(KC_REALM)}/protocol/openid-connect/token`;

// Tenants used by tests 8 and 9. Timestamped so concurrent CI runs don't
// race over the same tenant id. Inside `describe` scope so all tests share
// the same target — the scoped admin in test 6 is bound to `OURS`, and
// test 8 reuses it.
let TENANT_OURS = '';
let TENANT_OTHER = '';

// Credentials produced by test 6, consumed by tests 7-10 and torn down
// in afterAll.
let scopedUsername = '';
let scopedPassword = '';

async function mintMasterJwt(request: any): Promise<string> {
  const resp = await request.post(MASTER_TOKEN_URL, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: KC_MASTER_ADMIN_USER,
      password: KC_MASTER_ADMIN_PASS,
    }).toString(),
  });
  expect(
    resp.ok(),
    `master JWT mint failed (${resp.status()}): ${await resp.text()}`,
  ).toBeTruthy();
  return (await resp.json()).access_token;
}

async function mintScopedJwt(request: any, username: string, password: string): Promise<string> {
  const resp = await request.post(MASTER_TOKEN_URL, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username,
      password,
    }).toString(),
  });
  expect(
    resp.ok(),
    `scoped JWT mint failed for ${username} (${resp.status()}): ${await resp.text()}`,
  ).toBeTruthy();
  return (await resp.json()).access_token;
}

test.describe('Platform-admin gateway — API contract', () => {
  test.beforeAll(async () => {
    const probe = await playwrightRequest.newContext({ timeout: 8000 });
    try {
      // Hard-skip if the master admin password wasn't provided. CI runs
      // against KC-less deployments (or runs without secret access) skip
      // cleanly instead of 401-failing every test.
      test.skip(
        !KC_MASTER_ADMIN_PASS,
        'KC_MASTER_ADMIN_PASSWORD not set — skipping platform-admin spec. ' +
          'Pass the master-realm admin password to enable these tests.',
      );

      // Hard-skip if the platform-admin overlay route isn't deployed. We
      // probe with no auth — any response (including 401) means the route
      // exists; a 404 means the overlay doesn't have the routes yet.
      const r = await probe.get(`${PLATFORM_ADMIN_BASE}/v1/version`);
      test.skip(
        r.status() === 404,
        `Platform-admin gateway not deployed at ${PLATFORM_ADMIN_BASE} ` +
          `(got 404). Update token-exchange-svc to a build that includes ` +
          `the /platform-admin/* routes.`,
      );
    } finally {
      await probe.dispose();
    }

    // Unique tenant ids — bound to spec run so tests 6→8 see the same id.
    const stamp = Date.now().toString().slice(-7);
    TENANT_OURS = `${ROOT_TENANT}.pwours${stamp}`;
    TENANT_OTHER = `${ROOT_TENANT}.pwother${stamp}`;
  });

  test.afterAll(async ({ }, testInfo) => {
    // Delete the scoped KC user. We need a god JWT + the KC admin REST API.
    // NOTE: API teardown — KC users are not surfaced in any UI in this stack.
    if (!scopedUsername || !KC_MASTER_ADMIN_PASS) return;
    const ctx = await playwrightRequest.newContext({ timeout: 15_000 });
    try {
      const godTok = await mintMasterJwt(ctx);
      // Look up the user id (KC admin REST returns an array, we want the
      // exact match)
      const lookup = await ctx.get(
        `${KC_BASE}/admin/realms/${KC_MASTER_REALM}/users?username=${encodeURIComponent(scopedUsername)}&exact=true`,
        { headers: { Authorization: `Bearer ${godTok}` } },
      );
      if (!lookup.ok()) return;
      const users = await lookup.json();
      if (!users[0]?.id) return;
      await ctx.delete(
        `${KC_BASE}/admin/realms/${KC_MASTER_REALM}/users/${users[0].id}`,
        { headers: { Authorization: `Bearer ${godTok}` } },
      );
    } finally {
      await ctx.dispose();
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // AUTH GATE (3)
  // ────────────────────────────────────────────────────────────────────────

  test('AUTH: no Authorization header → 401 with mint instructions', async ({ request }) => {
    const resp = await request.get(`${PLATFORM_ADMIN_BASE}/v1/version`);
    expect(resp.status()).toBe(401);
    const body = await resp.json();
    expect(body.error).toBe('unauthorized');
    // The error message should tell the caller HOW to mint a JWT — that's
    // load-bearing for operators discovering the API.
    expect(body.message).toMatch(/Mint one via POST.*realms\/.*\/protocol\/openid-connect\/token/i);
  });

  test('AUTH: tenant-realm JWT (citizen) → 403 with tokenRealm field exposed', async ({ request }) => {
    // Register a fresh citizen against the tenant realm, mint the JWT via
    // the overlay's password grant, then assert the gateway rejects it.
    // Pre-registration is the same shim the kc-ui.spec uses — citizens
    // need to exist in DIGIT before KC OTP login works.
    const mobile = generateCitizenPhone();
    const reg = await request.post(
      `${BASE_URL}/user/citizen/_create?tenantId=${ROOT_TENANT}`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: {
          RequestInfo: { apiId: 'kc-pa-test', action: '_create' },
          User: {
            name: `PA Test ${mobile.slice(-4)}`,
            username: mobile,
            mobileNumber: mobile,
            otpReference: FIXED_OTP,
            tenantId: ROOT_TENANT,
            type: 'CITIZEN',
          },
        },
      },
    );
    expect(reg.ok(), `pre-register failed: ${reg.status()}`).toBeTruthy();

    const tokResp = await request.post(
      `${BASE_URL}/token-exchange/realms/${encodeURIComponent(KC_REALM)}/protocol/openid-connect/token`,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams({
          grant_type: 'password',
          client_id: KC_CLIENT_ID,
          username: mobile,
          password: FIXED_OTP,
          scope: 'openid',
          tenantId: ROOT_TENANT,
          userType: 'CITIZEN',
        }).toString(),
      },
    );
    expect(tokResp.ok(), `citizen mint failed: ${tokResp.status()}`).toBeTruthy();
    const citizenJwt = (await tokResp.json()).access_token;

    const resp = await request.get(`${PLATFORM_ADMIN_BASE}/v1/version`, {
      headers: { Authorization: `Bearer ${citizenJwt}` },
    });
    expect(resp.status()).toBe(403);
    const body = await resp.json();
    expect(body.error).toBe('forbidden');
    // tokenRealm field is critical — without it, operators chase phantom KC
    // misconfig when the actual issue is "you used the wrong realm".
    expect(body.tokenRealm).toBe(KC_REALM);
    expect(body.message).toMatch(/master.*realm/i);
  });

  test('AUTH: malformed JWT → 401 (gateway rejects, no crash)', async ({ request }) => {
    const resp = await request.get(`${PLATFORM_ADMIN_BASE}/v1/version`, {
      headers: { Authorization: 'Bearer not.a.real.jwt.value' },
    });
    expect(resp.status()).toBe(401);
  });

  // ────────────────────────────────────────────────────────────────────────
  // GOD PATH (3)
  // ────────────────────────────────────────────────────────────────────────

  test('GOD: master JWT carries realm_access.roles (regression for fullScopeAllowed)', async ({ request }) => {
    // Without admin-cli.fullScopeAllowed=true the JWT comes back with no
    // realm_access.roles, and the overlay can't tell god from scoped. Pin
    // this here so a future KC realm-export that resets the client doesn't
    // silently turn every gateway call into 403.
    const tok = await mintMasterJwt(request);
    const claims = decodeJwtPayload(tok);
    expect(
      claims.realm_access?.roles,
      'fullScopeAllowed=false on admin-cli — realm_access.roles missing from JWT',
    ).toBeTruthy();
    expect(claims.realm_access.roles).toEqual(
      expect.arrayContaining(['admin']),
    );
    expect(claims.preferred_username).toBe(KC_MASTER_ADMIN_USER);
  });

  test('GOD: /v1/version returns the MCP server identity', async ({ request }) => {
    const tok = await mintMasterJwt(request);
    const resp = await request.get(`${PLATFORM_ADMIN_BASE}/v1/version`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(resp.ok(), `expected 200 from /v1/version: ${resp.status()}`).toBeTruthy();
    const body = await resp.json();
    expect(body.service).toBe('digit-mcp');
    // The features array tells the SPA which MCP endpoints exist — assert
    // tenant/bootstrap is present so future test reordering catches an
    // MCP downgrade that drops it.
    expect(body.features).toEqual(expect.arrayContaining(['v1/tenant/bootstrap']));
  });

  test('GOD: creates scoped admin, returns credentials + role + tenantId', async ({ request }) => {
    const tok = await mintMasterJwt(request);
    const resp = await request.post(`${PLATFORM_ADMIN_BASE}/scoped-admins/_create`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tok}`,
      },
      data: { tenantId: TENANT_OURS },
    });
    expect(resp.status(), `expected 201 from _create: ${await resp.text()}`).toBe(201);
    const cred = await resp.json();
    expect(cred.username).toBeTruthy();
    expect(cred.password).toBeTruthy();
    expect(cred.role).toBe(`bootstrap:${TENANT_OURS}`);
    expect(cred.tenantId).toBe(TENANT_OURS);
    expect(cred.realm).toBe(KC_MASTER_REALM);
    expect(cred.created).toBe(true);

    // Stash for tests 7-10 + afterAll teardown.
    scopedUsername = cred.username;
    scopedPassword = cred.password;
  });

  // ────────────────────────────────────────────────────────────────────────
  // SCOPED DELEGATION (4)
  // ────────────────────────────────────────────────────────────────────────

  test('SCOPED: JWT carries bootstrap:<tenantId> realm role', async ({ request }) => {
    expect(scopedUsername, 'scoped admin must be created by the previous test').toBeTruthy();
    const tok = await mintScopedJwt(request, scopedUsername, scopedPassword);
    const claims = decodeJwtPayload(tok);
    expect(claims.preferred_username).toBe(scopedUsername);
    expect(claims.realm_access?.roles).toEqual(
      expect.arrayContaining([`bootstrap:${TENANT_OURS}`]),
    );
    // Scoped users should NOT have admin role (would make them god by
    // accident). Pin negative case to catch role-mapping creep.
    expect(claims.realm_access.roles).not.toContain('admin');
    expect(claims.realm_access.roles).not.toContain('PLATFORM_ADMIN');
  });

  test('SCOPED: bootstraps OWN tenant → 200 with MCP summary', async ({ request }) => {
    expect(scopedUsername).toBeTruthy();
    const tok = await mintScopedJwt(request, scopedUsername, scopedPassword);
    const resp = await request.post(
      `${PLATFORM_ADMIN_BASE}/v1/tenant/bootstrap`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tok}`,
        },
        data: {
          target_tenant: TENANT_OURS,
          source_tenant: ROOT_TENANT,
        },
        timeout: 90_000, // MCP bootstrap copies 1000+ records on a fresh tenant
      },
    );
    expect(resp.ok(), `expected 200: ${resp.status()}`).toBeTruthy();
    const body = await resp.json();
    // The MCP response shape — `summary` is the load-bearing field for any
    // operator dashboard rendering bootstrap output. Pin its presence.
    expect(body.summary).toBeTruthy();
    expect(body.summary.localizations_copied).toBeGreaterThanOrEqual(0);
  });

  test('SCOPED: bootstraps OTHER tenant → 403 with scope-mismatch message', async ({ request }) => {
    expect(scopedUsername).toBeTruthy();
    const tok = await mintScopedJwt(request, scopedUsername, scopedPassword);
    const resp = await request.post(
      `${PLATFORM_ADMIN_BASE}/v1/tenant/bootstrap`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tok}`,
        },
        data: {
          target_tenant: TENANT_OTHER, // not OUR tenant
          source_tenant: ROOT_TENANT,
        },
      },
    );
    expect(resp.status(), 'scoped admin must NOT cross tenants').toBe(403);
    const body = await resp.json();
    expect(body.error).toBe('forbidden');
    // The message names both tenants so operators can tell which scope was
    // checked. Pin both substrings.
    expect(body.message).toContain(TENANT_OURS);
    expect(body.message).toContain(TENANT_OTHER);
  });

  test('SCOPED: god-only endpoints return 403 (version + scoped-admins _create)', async ({ request }) => {
    expect(scopedUsername).toBeTruthy();
    const tok = await mintScopedJwt(request, scopedUsername, scopedPassword);

    // Case A: /v1/version is god-only (any non-tenant endpoint requires
    // god mode — scoped users can only call the tenant_bootstrap family).
    const verResp = await request.get(`${PLATFORM_ADMIN_BASE}/v1/version`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(verResp.status(), 'scoped admin must NOT read MCP /v1/version').toBe(403);
    const verBody = await verResp.json();
    expect(verBody.message).toMatch(/god-mode|may only call tenant_bootstrap/i);

    // Case B: scoped admins must NOT be able to self-replicate or escalate
    // by creating more scoped admins (or a god admin for a different
    // tenant). This is the privilege-escalation guard.
    const createResp = await request.post(
      `${PLATFORM_ADMIN_BASE}/scoped-admins/_create`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tok}`,
        },
        data: { tenantId: `${ROOT_TENANT}.evil` },
      },
    );
    expect(createResp.status(), 'scoped admin must NOT create more scoped admins').toBe(403);
    const createBody = await createResp.json();
    expect(createBody.message).toMatch(/god-mode/i);
  });
});
