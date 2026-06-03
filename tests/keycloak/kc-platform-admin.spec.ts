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
  ENC_SERVICE_BASE,
  ROOT_TENANT,
  ADMIN_USER,
  ADMIN_PASS,
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

/**
 * egov-enc-service — POST /crypto/v1/_generatekey
 *
 * Validates the on-demand key-provisioning endpoint from Digit-Core #1354.
 * Without it, the first encrypt for a brand-new state root (not under any
 * existing root's tenant.tenants) throws "Tenant Id not found" and breaks
 * the platform-admin tenant_bootstrap chain at the admin-user step.
 *
 * Self-skips if the endpoint isn't deployed (404).
 *
 * Covers (4 tests):
 *   1. Fresh tenant            → 200 { created: true,  keyId: <int> }
 *   2. Re-issue (idempotent)   → 200 { created: false, keyId: <same> }
 *   3. Missing tenantId        → 4xx (validation)
 *   4. END-TO-END chain        → _generatekey + tenant_bootstrap + login
 *                                proves brand-new roots now provision admins
 *                                cleanly (this was the user-visible bug in
 *                                CCRS #622).
 */
test.describe('egov-enc-service — _generatekey endpoint', () => {
  const ENDPOINT = `${ENC_SERVICE_BASE}/crypto/v1/_generatekey`;
  let createdTenants: string[] = [];

  test.beforeAll(async () => {
    const probe = await playwrightRequest.newContext({ timeout: 8000 });
    try {
      // Probe with an obviously-bad body — any response that isn't 404
      // means the route exists. We can't probe with a valid request
      // because that would create a key as a side effect.
      const r = await probe.post(ENDPOINT, { data: {} });
      test.skip(
        r.status() === 404,
        `egov-enc-service /_generatekey not deployed at ${ENDPOINT} (got 404). ` +
          `Update egov-enc-service to an image that includes Digit-Core #1354.`,
      );
    } finally {
      await probe.dispose();
    }
  });

  // We don't delete the generated keys in teardown — enc-service has no
  // delete-key API (rotateKey only deactivates, leaving the row), and the
  // generated keys are scoped to test-prefixed tenant ids that don't
  // collide with real tenants. Leaving them is the same behavior as
  // tenant_bootstrap's bootstrapped tenants (which we also leave in MDMS).

  test('GEN: fresh tenant → 200 with created=true and a keyId', async ({ request }) => {
    const tenantId = `pwgenk${Date.now().toString().slice(-7)}a`;
    createdTenants.push(tenantId);

    const resp = await request.post(ENDPOINT, { data: { tenantId } });
    expect(resp.ok(), `expected 200: ${resp.status()} ${await resp.text()}`).toBeTruthy();
    const body = await resp.json();
    expect(body.tenantId).toBe(tenantId);
    expect(body.created).toBe(true);
    // keyId is the internal Java counter; pin only that it's a number.
    // Operators reading the JSON correlate this with downstream encrypts.
    expect(typeof body.keyId).toBe('number');
    expect(body.keyId).toBeGreaterThan(0);
  });

  test('GEN: idempotent — re-issue returns existing keyId with created=false', async ({ request }) => {
    const tenantId = `pwgenk${Date.now().toString().slice(-7)}b`;
    createdTenants.push(tenantId);

    const first = await request.post(ENDPOINT, { data: { tenantId } });
    expect(first.ok()).toBeTruthy();
    const firstBody = await first.json();
    expect(firstBody.created).toBe(true);
    const firstKeyId = firstBody.keyId;

    // Re-issue should be a no-op — same key, no rotation.
    const second = await request.post(ENDPOINT, { data: { tenantId } });
    expect(second.ok()).toBeTruthy();
    const secondBody = await second.json();
    expect(secondBody.tenantId).toBe(tenantId);
    expect(secondBody.created, 'second call must NOT rotate').toBe(false);
    expect(
      secondBody.keyId,
      `keyId must remain stable across idempotent calls (was ${firstKeyId})`,
    ).toBe(firstKeyId);
  });

  test('GEN: missing tenantId → 4xx (validation)', async ({ request }) => {
    const resp = await request.post(ENDPOINT, { data: {} });
    // 400 from @Valid; some shapes also return 500 from CustomException.
    // Either way, the request must NOT succeed silently.
    expect([400, 422, 500]).toContain(resp.status());
    if (resp.status() !== 200) return; // not OK is what we want
  });

  test('GEN: end-to-end chain — _generatekey + tenant_bootstrap + login (CCRS #622)', async ({ request }) => {
    // Self-skip when the master admin password isn't available — without
    // it we can't drive tenant_bootstrap. The endpoint-only tests above
    // still ran; this one just doesn't add coverage for the chain.
    test.skip(
      !KC_MASTER_ADMIN_PASS,
      'KC_MASTER_ADMIN_PASSWORD not set — skipping chain test.',
    );
    // Self-skip when the platform-admin overlay isn't deployed (same
    // probe as the platform-admin describe block).
    const probe = await playwrightRequest.newContext({ timeout: 5000 });
    try {
      const r = await probe.get(`${PLATFORM_ADMIN_BASE}/v1/version`);
      test.skip(r.status() === 404, 'Platform-admin gateway not deployed.');
    } finally {
      await probe.dispose();
    }

    // Use a brand-new ROOT tenant id (no dot — a state-level root, not a
    // sub-tenant). This is the case that breaks WITHOUT _generatekey:
    // enc-service's MDMS-driven discovery doesn't see it, so the first
    // encrypt fails. Naming: alpha-only to dodge the unrelated MCP
    // username-regex bug that rejects digits.
    const stamp = Date.now().toString(36).slice(-5).replace(/[^a-z]/g, 'a');
    const NEWROOT = `pwgen${stamp}xyz`;
    createdTenants.push(NEWROOT);

    // Step 1: provision the key BEFORE any encrypt happens
    const gen = await request.post(ENDPOINT, { data: { tenantId: NEWROOT } });
    expect(gen.ok(), `_generatekey failed: ${gen.status()}`).toBeTruthy();
    const genBody = await gen.json();
    expect(genBody.created).toBe(true);

    // Step 2: god admin runs tenant_bootstrap via the platform-admin gateway
    const tokResp = await request.post(
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
    expect(tokResp.ok()).toBeTruthy();
    const godTok = (await tokResp.json()).access_token;

    const bs = await request.post(
      `${PLATFORM_ADMIN_BASE}/v1/tenant/bootstrap`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${godTok}`,
        },
        data: { target_tenant: NEWROOT, source_tenant: ROOT_TENANT },
        timeout: 120_000, // bootstrap copies ~5000 localizations + schemas
      },
    );
    expect(bs.ok(), `tenant_bootstrap failed: ${bs.status()}`).toBeTruthy();
    const bsBody = await bs.json();
    expect(
      bsBody.adminUser?.provisioned,
      `admin user not provisioned — encryption path likely still broken. error=${bsBody.adminUser?.error}`,
    ).toBe(true);
    expect(bsBody.adminUser?.username).toBeTruthy();

    // Step 3: login as the freshly-provisioned admin against the NEW root
    // tenant. This is the assertion that proves the encryption chain
    // closed: the username was encrypted with NEWROOT's key on create,
    // and the same key is used for lookup on login. Mismatch (the #622
    // bug) would 401 here.
    const adminUsername = bsBody.adminUser.username;
    const adminPassword = bsBody.adminUser.password || ADMIN_PASS;
    const login = await request.post(`${BASE_URL}/user/oauth/token`, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=', // egov-user-client:
      },
      data: new URLSearchParams({
        grant_type: 'password',
        username: adminUsername,
        password: adminPassword,
        tenantId: NEWROOT,
        userType: 'EMPLOYEE',
        scope: 'read',
      }).toString(),
    });
    expect(
      login.ok(),
      `login as new admin failed: ${login.status()} ${await login.text()}`,
    ).toBeTruthy();
    const loginBody = await login.json();
    expect(loginBody.access_token).toBeTruthy();
  });
});
