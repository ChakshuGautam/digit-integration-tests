/**
 * Configurator regression suite — 2026-04-30 fix wave.
 *
 * Bundles seven CCRS issues reported against
 * `https://naipepea.digit.org/configurator/`. Each `describe` block
 * targets one issue and is self-contained; tests within a block are
 * sequential to keep created/edited state coherent.
 *
 * Coverage:
 *   - #459 — Tenant routing on Create: UI tenant selection wins over
 *            session tenant for both employees AND citizen users.
 *   - #460 — HRMS create employee form must NOT render two "Username"
 *            fields. (Edit form renders exactly one, disabled.)
 *   - #461 — Citizen user create accepts Kenya mobile formats
 *            (`0712345678` AND `712345678`); the legacy India regex is
 *            no longer hardcoded.
 *   - #462 — Citizen user create with all mandatory fields succeeds —
 *            user lands at the session tenant, role is CITIZEN.
 *   - #467 — Phase 1 logo upload — the file picker MUST POST to
 *            filestore and persist a `fileStoreId`. Currently
 *            EXPECTED-RED until the upload handler wires through.
 *   - #468 — Phase 2 boundary template download — clicking Download
 *            Template MUST produce an XLSX (`Content-Type` /
 *            extension). Currently EXPECTED-RED while the handler is
 *            still a stub `alert()`.
 *   - #476 — Edit existing employee: changing a non-key field
 *            (Name) and Save returns 200 and persists.
 *
 * Teardown: tests that create users/employees soft-deactivate them
 * via the inline helpers below — same pattern as
 * `tests/admin/employees.spec.ts` (HRMS has no DELETE) and
 * `tests/admin/users.spec.ts` (egov-user has no DELETE).
 */
import { test, expect } from '@playwright/test';

import { loadAuth, type AuthInfo } from '../utils/manage/api';
import { testCode } from '../utils/manage/codes';
import { BASE_URL, ROOT_TENANT, TENANT } from '../utils/env';

const TENANT_CODE = ROOT_TENANT;
const CITY_TENANT = TENANT;

const HRMS_CREATE = '/egov-hrms/employees/_create';
const HRMS_UPDATE = '/egov-hrms/employees/_update';
const HRMS_SEARCH = '/egov-hrms/employees/_search';
const USER_SEARCH = '/user/_search';
const USER_CREATE = '/user/users/_createnovalidate';
const USER_UPDATE = '/user/users/_updatenovalidate';

const createdUsernames = new Set<string>();
const createdEmployeeCodes = new Set<{ code: string; tenantId: string }>();

interface ApiError { code?: string; message?: string }

function requestInfo(auth: AuthInfo, action = '_search'): Record<string, unknown> {
  return {
    apiId: 'Rainmaker',
    ver: '1.0',
    ts: Date.now(),
    action,
    msgId: `${Date.now()}|en_IN`,
    authToken: auth.token,
    userInfo: auth.user || undefined,
  };
}

async function postJson<T extends Record<string, unknown>>(
  auth: AuthInfo,
  pathWithQuery: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${auth.baseUrl}${pathWithQuery}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify(body),
  });
  let parsed: Record<string, unknown> = {};
  try { parsed = (await res.json()) as Record<string, unknown>; } catch { /* empty */ }
  if (!res.ok || (parsed.Errors as ApiError[] | undefined)?.length) {
    const errs = (parsed.Errors as ApiError[]) || [
      { code: `HTTP_${res.status}`, message: res.statusText },
    ];
    const summary = errs.map((e) => `${e.code || '??'}:${e.message || ''}`).join(', ');
    throw new Error(`POST ${pathWithQuery} failed (${res.status}): ${summary}`);
  }
  return parsed as T;
}

async function softDeleteUser(auth: AuthInfo, userName: string, tenantId: string): Promise<void> {
  const res = await postJson<{ user?: Array<Record<string, unknown>> }>(
    auth,
    USER_SEARCH,
    {
      RequestInfo: requestInfo(auth),
      tenantId,
      userName,
      pageSize: 1,
    },
  );
  const list = res.user || [];
  if (!list.length) return;
  const user = list[0];
  if (user.active === false) return;
  user.active = false;
  await postJson(auth, USER_UPDATE, {
    RequestInfo: requestInfo(auth, '_update'),
    user,
  });
}

async function softDeleteEmployee(
  auth: AuthInfo,
  code: string,
  tenantId: string,
): Promise<void> {
  const res = await postJson<{ Employees?: Array<Record<string, unknown>> }>(
    auth,
    `${HRMS_SEARCH}?tenantId=${tenantId}&codes=${encodeURIComponent(code)}&limit=1&offset=0`,
    { RequestInfo: requestInfo(auth) },
  );
  const list = res.Employees || [];
  if (list.length === 0) return;
  const emp = list[0];
  if (emp.isActive === false && emp.employeeStatus === 'INACTIVE') return;
  emp.employeeStatus = 'INACTIVE';
  emp.isActive = false;
  emp.deactivationDetails = [
    {
      reasonForDeactivation: 'OTHERS',
      effectiveFrom: Date.now(),
      orderNo: 'PW-TEARDOWN',
      typeOfDeactivation: 'OTHERS',
      tenantId,
      isActive: true,
    },
  ];
  emp.reActivateEmployee = false;
  await postJson(auth, `${HRMS_UPDATE}?tenantId=${tenantId}`, {
    RequestInfo: requestInfo(auth, '_update'),
    Employees: [emp],
  });
}

test.afterAll(async () => {
  if (createdUsernames.size === 0 && createdEmployeeCodes.size === 0) return;
  const auth = loadAuth();
  for (const u of createdUsernames) {
    try { await softDeleteUser(auth, u, TENANT_CODE); } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[2026-04-30] failed to deactivate user ${u}:`, (e as Error).message);
    }
  }
  for (const { code, tenantId } of createdEmployeeCodes) {
    try { await softDeleteEmployee(auth, code, tenantId); } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[2026-04-30] failed to deactivate employee ${code}:`, (e as Error).message);
    }
  }
});

// ---------------------------------------------------------------------
// CCRS#459 — Tenant routing on Create
// ---------------------------------------------------------------------
test.describe('CCRS#459 — UI tenant selection wins over session tenant', () => {
  test.describe.configure({ mode: 'serial' });

  test('employee create: explicit tenantId in payload lands employee at that tenant', async ({},
    testInfo,
  ) => {
    const auth = loadAuth();
    const code = testCode(testInfo, 'TENANT_EMP');
    const uniq = code.split('_').pop() || '00000';
    const mobile = `07${String(uniq).padStart(8, '0')}`.slice(0, 10);
    createdEmployeeCodes.add({ code, tenantId: CITY_TENANT });

    // Mirror the EmployeeCreate.transform contract from PR #31 — root
    // session, but the payload's `tenantId` points at the city.
    await postJson(auth, `${HRMS_CREATE}?tenantId=${CITY_TENANT}`, {
      RequestInfo: requestInfo(auth, '_create'),
      Employees: [{
        tenantId: CITY_TENANT,
        code,
        employeeStatus: 'EMPLOYED',
        employeeType: 'PERMANENT',
        dateOfAppointment: Date.now() - 24 * 3600_000,
        user: {
          userName: code.toLowerCase().replace(/_/g, '.'),
          name: `PW Tenant ${uniq}`,
          mobileNumber: mobile,
          type: 'EMPLOYEE',
          active: true,
          gender: 'MALE',
          dob: 631152000000,
          password: 'eGov@123',
          tenantId: CITY_TENANT,
          roles: [{ code: 'EMPLOYEE', name: 'Employee', tenantId: CITY_TENANT }],
        },
        jurisdictions: [{
          boundary: 'NAIROBI_CITY',
          boundaryType: 'County',
          hierarchy: 'ADMIN',
          hierarchyType: 'ADMIN',
          tenantId: CITY_TENANT,
          isActive: true,
        }],
        assignments: [{
          department: 'DEPT_7',
          designation: 'DESIG_58',
          fromDate: Date.now() - 24 * 3600_000,
          isCurrentAssignment: true,
        }],
      }],
    });

    // Found at the city tenant.
    const cityRes = await postJson<{ Employees?: Array<Record<string, unknown>> }>(
      auth,
      `${HRMS_SEARCH}?tenantId=${CITY_TENANT}&codes=${encodeURIComponent(code)}&limit=1&offset=0`,
      { RequestInfo: requestInfo(auth) },
    );
    expect((cityRes.Employees || []).length, 'employee should exist at city tenant').toBe(1);

    // NOT found at the root tenant — the regression was a silent
    // fallthrough that landed the row at session tenant `ke`.
    const rootRes = await postJson<{ Employees?: Array<Record<string, unknown>> }>(
      auth,
      `${HRMS_SEARCH}?tenantId=${TENANT_CODE}&codes=${encodeURIComponent(code)}&limit=1&offset=0`,
      { RequestInfo: requestInfo(auth) },
    );
    expect(
      (rootRes.Employees || []).length,
      'employee must not leak into root tenant — UI selection must win',
    ).toBe(0);
  });

  test('user create: explicit tenantId in payload lands citizen at that tenant', async ({},
    testInfo,
  ) => {
    const auth = loadAuth();
    const uname = `pw${testCode(testInfo, 'TENANTUSR').toLowerCase().replace(/_/g, '')}`
      .slice(0, 40);
    const uniq = uname.replace(/[^0-9]/g, '').slice(-5).padStart(5, '0');
    const mobile = `07${uniq}33${uniq.slice(0, 1)}`.slice(0, 10);
    createdUsernames.add(uname);

    // Naipepea convention is to keep citizens at state-level `ke` for DPA
    // encryption — but the contract is "honour data.tenantId", whatever
    // value is passed. Here we pass the root tenant explicitly to assert
    // the API stamps it through.
    await postJson(auth, USER_CREATE, {
      RequestInfo: requestInfo(auth, '_create'),
      user: {
        userName: uname,
        name: `PW Tenant User ${uniq}`,
        mobileNumber: mobile,
        type: 'CITIZEN',
        active: true,
        password: 'eGov@123',
        gender: 'MALE',
        tenantId: TENANT_CODE,
        roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: TENANT_CODE }],
      },
    });

    const res = await postJson<{ user?: Array<Record<string, unknown>> }>(
      auth,
      USER_SEARCH,
      {
        RequestInfo: requestInfo(auth),
        tenantId: TENANT_CODE,
        userName: uname,
        pageSize: 1,
      },
    );
    const found = (res.user || [])[0];
    expect(found, 'user must be retrievable at the requested tenant').toBeTruthy();
    expect(found.tenantId).toBe(TENANT_CODE);
  });
});

// ---------------------------------------------------------------------
// CCRS#460 — single Username field on Employee Create / Edit
// ---------------------------------------------------------------------
test.describe('CCRS#460 — no duplicate Username field', () => {
  test('Create form renders ZERO Username inputs (auto-derived from code)', async ({ page }) => {
    await page.goto('/configurator/manage/employees/create');
    // Settle long enough for FieldSection blocks to mount.
    await page.waitForLoadState('networkidle').catch(() => {});

    // The current EmployeeCreate.tsx renders Tenant + Name + Code +
    // Mobile + Email + DOB + Gender + DateOfAppointment + Status + Type
    // + Roles + Assignments + Jurisdictions + Password. Username is not
    // a form field — `transform()` blanks it and HRMS enrichUser()
    // overwrites it with the employee code.
    const usernameInputs = page.getByLabel(/^Username$/i);
    expect(
      await usernameInputs.count(),
      'Create form must not render any Username field — derived from Employee Code',
    ).toBe(0);
  });

  test('Edit form renders EXACTLY ONE Username input, disabled', async ({ page }, testInfo) => {
    // Seed a victim employee so we have a real edit URL — root tenant
    // gets auto-cleaned by afterAll.
    const auth = loadAuth();
    const code = testCode(testInfo, 'USERNAME_DUP');
    const uniq = code.split('_').pop() || '00000';
    const mobile = `07${String(uniq).padStart(8, '0')}`.slice(0, 10);
    createdEmployeeCodes.add({ code, tenantId: CITY_TENANT });

    await postJson(auth, `${HRMS_CREATE}?tenantId=${CITY_TENANT}`, {
      RequestInfo: requestInfo(auth, '_create'),
      Employees: [{
        tenantId: CITY_TENANT, code, employeeStatus: 'EMPLOYED', employeeType: 'PERMANENT',
        dateOfAppointment: Date.now() - 24 * 3600_000,
        user: {
          userName: code.toLowerCase().replace(/_/g, '.'),
          name: `PW Username Dup ${uniq}`, mobileNumber: mobile,
          type: 'EMPLOYEE', active: true, gender: 'MALE', dob: 631152000000,
          password: 'eGov@123', tenantId: CITY_TENANT,
          roles: [{ code: 'EMPLOYEE', name: 'Employee', tenantId: CITY_TENANT }],
        },
        jurisdictions: [{
          boundary: 'NAIROBI_CITY', boundaryType: 'County',
          hierarchy: 'ADMIN', hierarchyType: 'ADMIN',
          tenantId: CITY_TENANT, isActive: true,
        }],
        assignments: [{
          department: 'DEPT_7', designation: 'DESIG_58',
          fromDate: Date.now() - 24 * 3600_000, isCurrentAssignment: true,
        }],
      }],
    });

    // List → search → row → Edit (mirrors employees.spec.ts test 4 path).
    await page.goto('/configurator/manage/employees');
    await page.getByPlaceholder(/search/i).first().fill(code);
    await page.waitForLoadState('networkidle').catch(() => {});
    const row = page.getByRole('row').filter({ hasText: code });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await page.getByRole('button', { name: /^Edit$/i }).click();

    // Wait for Username field to mount inside FieldSection.
    const usernameInputs = page.getByLabel(/^Username$/i);
    await expect(usernameInputs.first()).toBeVisible({ timeout: 15_000 });

    expect(
      await usernameInputs.count(),
      'Edit form must render exactly one Username input — no duplicates',
    ).toBe(1);
    await expect(usernameInputs.first()).toBeDisabled();
  });
});

// ---------------------------------------------------------------------
// CCRS#461 — Kenya mobile accepted on user create
// ---------------------------------------------------------------------
test.describe('CCRS#461 — Kenya mobile format accepted on user create', () => {
  // Both the full 10-digit (`0712345678`) and the 9-digit
  // (`712345678`) variants are valid per the Kenya MDMS pattern
  // `^0?[17][0-9]{8}$`. Either form should be accepted by the
  // configurator's `useMobileValidator` hook (which reads from
  // `ValidationConfigs.mobileNumberValidation`).
  for (const variant of [
    { label: '10-digit with leading 0', value: '0712345678' },
    { label: '9-digit, no leading 0', value: '712345678' },
  ]) {
    test(`UI: ${variant.label} (${variant.value}) — no inline error`, async ({ page }) => {
      await page.goto('/configurator/manage/users/create');
      await page.waitForLoadState('networkidle').catch(() => {});

      // Fill the field and blur to trigger touched-state validation.
      const mobile = page.getByLabel(/^Mobile Number$/i);
      await mobile.fill(variant.value);
      await page.getByLabel(/^Username$/i).click(); // blur

      // No inline error rendered for the mobile field. The validator's
      // error message comes from `mobileRules.errorMessage` (Kenya-aware
      // copy from MDMS) — match the keywords without pinning to one
      // exact string.
      const inlineError = page.getByText(
        /(invalid|enter\s+(a\s+)?valid|mobile\s+number\s+format|10[\s-]*digit)/i,
      );
      // Within ~1.5s nothing should pop up — validation is sync.
      await page.waitForTimeout(500);
      expect(
        await inlineError.count(),
        `Mobile "${variant.value}" should NOT trip the validator`,
      ).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------
// CCRS#462 — citizen user create with mandatory details lands
// ---------------------------------------------------------------------
test.describe('CCRS#462 — citizen create with all mandatory fields succeeds', () => {
  test('UI: fill required fields, submit, user is retrievable via /user/_search', async ({
    page,
  }, testInfo) => {
    const uname = `pw${testCode(testInfo, 'USR462').toLowerCase().replace(/_/g, '')}`
      .slice(0, 40);
    const uniq = uname.replace(/[^0-9]/g, '').slice(-5).padStart(5, '0');
    const mobile = `07${uniq}44${uniq.slice(0, 1)}`.slice(0, 10);
    createdUsernames.add(uname);

    await page.goto('/configurator/manage/users/create');
    await page.waitForLoadState('networkidle').catch(() => {});

    await page.getByLabel(/^Username$/i).fill(uname);
    await page.getByLabel(/^Name$/i).fill(`PW 462 ${uniq}`);
    await page.getByLabel(/^Mobile Number$/i).fill(mobile);
    await page.getByLabel(/^Email$/i).fill(`${uname}@example.com`);

    await Promise.all([
      page.waitForURL(/\/configurator\/manage\/users/, { timeout: 45_000 }),
      page.getByRole('button', { name: /^Create$/ }).click(),
    ]);

    // API sanity — record landed and shape is correct.
    const auth = loadAuth();
    const res = await postJson<{ user?: Array<Record<string, unknown>> }>(
      auth,
      USER_SEARCH,
      {
        RequestInfo: requestInfo(auth),
        tenantId: TENANT_CODE,
        userName: uname,
        pageSize: 1,
      },
    );
    const list = res.user || [];
    expect(list.length, 'newly-created citizen must be searchable').toBe(1);
    const user = list[0] as Record<string, unknown>;
    expect(user.userName).toBe(uname);
    expect(user.name).toMatch(/PW 462/);
    expect(user.mobileNumber).toBe(mobile);
    expect(user.active).toBe(true);
    expect(user.type).toBe('CITIZEN');

    const roles = (user.roles as Array<{ code?: string }> | undefined) || [];
    expect(
      roles.some((r) => r.code === 'CITIZEN'),
      'citizen role must be stamped onto the new user',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------
// CCRS#467 — Phase 1 logo upload
// ---------------------------------------------------------------------
test.describe('CCRS#467 — Phase 1 logo upload (EXPECTED-RED until fix lands)', () => {
  test('UI: clicking Upload Logo POSTs the file to /filestore/v1/files', async ({ page }) => {
    test.fail(
      true,
      'CCRS#467: Upload Logo button does not currently round-trip through ' +
        'filestore — the `Uploaded ✓` badge never appears in Step 1.2. ' +
        'Drop test.fail() once the upload handler wires through.',
    );

    await page.goto('/configurator/phase/1');
    await page.waitForLoadState('networkidle').catch(() => {});

    // Capture the filestore upload request when the picker fires.
    const uploadRequest = page
      .waitForRequest(
        (req) => req.url().includes('/filestore/v1/files') && req.method() === 'POST',
        { timeout: 15_000 },
      )
      .catch(() => null);

    // Fixture: a tiny valid 1x1 PNG. Below the 5 MB module cap, well
    // above zero — what an operator's actual logo upload looks like in
    // miniature.
    const tinyPng = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
        '0000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082',
      'hex',
    );

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 15_000 });
    await fileInput.setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: tinyPng,
    });

    const req = await uploadRequest;
    expect(
      req,
      'Upload Logo MUST POST to /filestore/v1/files — currently nothing fires',
    ).not.toBeNull();

    // After upload, the "Uploaded ✓" badge with a `(filestore id: ...)`
    // span should mount per Phase1Page.tsx:630.
    await expect(page.getByText(/Uploaded\s*✓/i)).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------
// CCRS#468 — Phase 2 boundary template download
// ---------------------------------------------------------------------
test.describe('CCRS#468 — boundary template download (EXPECTED-RED until stub replaced)', () => {
  test('UI: clicking Download Template produces an XLSX file', async ({ page }) => {
    test.fail(
      true,
      'CCRS#468: handleDownloadTemplate in Phase2Page.tsx:278 is currently ' +
        'a stub `alert("Template download would start here.")`. Drop ' +
        'test.fail() once the alert is replaced with a real XLSX builder.',
    );

    await page.goto('/configurator/phase/2');
    await page.waitForLoadState('networkidle').catch(() => {});

    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await page.getByRole('button', { name: /Download\s*Template/i }).first().click();
    const download = await downloadPromise;

    // The stub form would never resolve a download; once the real handler
    // lands, the path resolves to a temp .xlsx.
    expect(await download.path()).toBeTruthy();
    expect(download.suggestedFilename()).toMatch(/\.xlsx?$/i);
  });
});

// ---------------------------------------------------------------------
// CCRS#476 — edit existing employee details
// ---------------------------------------------------------------------
test.describe('CCRS#476 — Edit existing employee details', () => {
  test('UI: change Name on an existing employee, Save, and HRMS reflects it', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const auth = loadAuth();
    const code = testCode(testInfo, 'EDIT_476');
    const uniq = code.split('_').pop() || '11111';
    const mobile = `07${String(uniq).padStart(8, '0')}`.slice(0, 10);
    createdEmployeeCodes.add({ code, tenantId: CITY_TENANT });

    // Seed via API so we don't depend on UI Create path success.
    await postJson(auth, `${HRMS_CREATE}?tenantId=${CITY_TENANT}`, {
      RequestInfo: requestInfo(auth, '_create'),
      Employees: [{
        tenantId: CITY_TENANT, code, employeeStatus: 'EMPLOYED', employeeType: 'PERMANENT',
        dateOfAppointment: Date.now() - 24 * 3600_000,
        user: {
          userName: code.toLowerCase().replace(/_/g, '.'),
          name: `PW Pre-Edit 476 ${uniq}`, mobileNumber: mobile,
          type: 'EMPLOYEE', active: true, gender: 'MALE', dob: 631152000000,
          password: 'eGov@123', tenantId: CITY_TENANT,
          roles: [{ code: 'EMPLOYEE', name: 'Employee', tenantId: CITY_TENANT }],
        },
        jurisdictions: [{
          boundary: 'NAIROBI_CITY', boundaryType: 'County',
          hierarchy: 'ADMIN', hierarchyType: 'ADMIN',
          tenantId: CITY_TENANT, isActive: true,
        }],
        assignments: [{
          department: 'DEPT_7', designation: 'DESIG_58',
          fromDate: Date.now() - 24 * 3600_000, isCurrentAssignment: true,
        }],
      }],
    });

    // Open Edit via list → search → row.
    await page.goto('/configurator/manage/employees');
    await page.getByPlaceholder(/search/i).first().fill(code);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.getByRole('row').filter({ hasText: code }).click();
    await page.getByRole('button', { name: /^Edit$/i }).click();

    // Mutate Name and Save.
    const nameInput = page.getByLabel(/^Name$/i);
    await expect(nameInput).toBeVisible({ timeout: 15_000 });
    await nameInput.fill(`PW Edited 476 ${uniq}`);

    // No JsonMappingException / generic error toast surfaces (#439
    // sister regression — same code path).
    await page.getByRole('button', { name: /^Save$/i }).click();
    const errToast = page.getByRole('status').filter({
      hasText: /(JsonMappingException|failed|error|something went wrong)/i,
    });
    await expect(errToast).toHaveCount(0, { timeout: 5_000 });

    // Within 5 s the mutation is visible server-side.
    await expect.poll(async () => {
      const res = await postJson<{ Employees?: Array<Record<string, unknown>> }>(
        auth,
        `${HRMS_SEARCH}?tenantId=${CITY_TENANT}&codes=${encodeURIComponent(code)}&limit=1&offset=0`,
        { RequestInfo: requestInfo(auth) },
      );
      const emp = (res.Employees || [])[0];
      const user = emp?.user as Record<string, unknown> | undefined;
      return typeof user?.name === 'string' ? user.name : '';
    }, { timeout: 10_000 }).toMatch(/PW Edited 476/);
  });
});
