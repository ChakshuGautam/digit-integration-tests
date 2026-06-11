/**
 * Theme round-trip — the missing write-path coverage between
 * theme-editor.spec.ts (editor renders, preview reacts, never saves) and
 * theme-applied.spec.ts (vars land on :root, read-only).
 *
 * Flow under test:
 *   configurator Theme editor → edit "Brand" → Save → MDMS _update →
 *   (Kafka persister) → digit-ui boot fetch → applyTheme → painted pixels.
 *
 * Edits the `Brand` field specifically because the v2 semantic key
 * `colors.brand` wins over the nested v1 `colors.primary.main` in
 * applyTheme's precedence — so this works on records of either shape
 * (kenya-green is pure v1: editing Brand *adds* the key; subhadev's
 * ethiopia record already carries one: editing Brand replaces it).
 *
 * The final assertion is the LOGIN BUTTON's computed background — the
 * exact pixel that regressed before theflywheel/digit-ui-esbuild#124
 * (v2-scope bridge + v3 backfill). A deployment without that fix will
 * pass the CSS-var assert and fail the pixel assert, which is the point.
 *
 * MDMS state: the record is snapshotted via API in beforeAll and restored
 * via /mdms-v2/v2/_update in afterAll (teardown runs even on failure), so
 * the tenant never stays hot-pink for more than the test's runtime.
 *
 * Run against subhadev:
 *   BASE_URL=https://subhadev.digitlab.in TENANT_CODE=ethiopia \
 *   ROOT_TENANT=ethiopia THEME_RECORD_ID=themeconfig \
 *   npx playwright test tests/admin/theme-roundtrip.spec.ts
 */
import { test, expect, Browser } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';

const THEME_RECORD_ID = process.env.THEME_RECORD_ID || 'kenya-green';
const SENTINEL_HEX = '#FF1493'; // hot pink — collides with no real theme
const SENTINEL_RGB = 'rgb(255, 20, 147)';

interface MdmsRecord {
  id: string;
  tenantId: string;
  schemaCode: string;
  uniqueIdentifier: string;
  data: { colors?: Record<string, unknown>; [k: string]: unknown };
  auditDetails: Record<string, unknown>;
  isActive: boolean;
}

let original: MdmsRecord | null = null;

async function authHeader(): Promise<string> {
  const t = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
  return t.access_token;
}

async function fetchRecord(token: string): Promise<MdmsRecord | null> {
  const resp = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'integration-tests', ver: '1.0', ts: Date.now(), msgId: `${Date.now()}|en_IN`, authToken: token },
      MdmsCriteria: { tenantId: ROOT_TENANT, schemaCode: 'common-masters.ThemeConfig', uniqueIdentifiers: [THEME_RECORD_ID] },
    }),
  });
  const body = (await resp.json()) as { mdms?: MdmsRecord[] };
  return body.mdms?.find((r) => r.isActive) ?? null;
}

async function updateRecord(token: string, record: MdmsRecord): Promise<void> {
  const resp = await fetch(`${BASE_URL}/mdms-v2/v2/_update/${record.schemaCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'integration-tests', ver: '1.0', ts: Date.now(), msgId: `${Date.now()}|en_IN`, authToken: token },
      Mdms: {
        tenantId: record.tenantId,
        schemaCode: record.schemaCode,
        uniqueIdentifier: record.uniqueIdentifier,
        id: record.id,
        data: record.data,
        auditDetails: record.auditDetails,
        isActive: true,
      },
    }),
  });
  expect(resp.ok, `restore _update should return 2xx, got ${resp.status}`).toBe(true);
}

/** Open a FRESH context (no MDMS/localStorage cache) and read theme state
 *  off the digit-ui login page. */
async function readDigitUiTheme(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE_URL}/digit-ui/employee/user/login`, { waitUntil: 'networkidle', timeout: 45_000 });
    await page.waitForTimeout(5_000); // applyTheme runs after the MDMS boot fetch
    return await page.evaluate(() => {
      const byText = (sel: string, re: RegExp) =>
        [...document.querySelectorAll(sel)].find(
          (e) => re.test((e.textContent || '').trim()) && (e as HTMLElement).offsetParent !== null,
        );
      const btn = byText('button', /^login$/i) as HTMLElement | undefined;
      return {
        primaryMain: getComputedStyle(document.documentElement).getPropertyValue('--color-primary-main').trim(),
        buttonBg: btn ? getComputedStyle(btn).backgroundColor : null,
      };
    });
  } finally {
    await ctx.close();
  }
}

test.beforeAll(async () => {
  const token = await authHeader();
  original = await fetchRecord(token);
  expect(original, `ThemeConfig '${THEME_RECORD_ID}' must exist on ${ROOT_TENANT}`).toBeTruthy();
});

test.afterAll(async () => {
  if (!original) return;
  const token = await authHeader();
  await updateRecord(token, original);
  // Confirm the restore actually persisted (persister is async).
  await expect
    .poll(
      async () => {
        const rec = await fetchRecord(token);
        return JSON.stringify(rec?.data?.colors?.['brand'] ?? null);
      },
      { timeout: 60_000, intervals: [5_000] },
    )
    .toBe(JSON.stringify(original.data?.colors?.['brand'] ?? null));
});

test('editing Brand in the configurator repaints digit-ui (incl. login button pixel)', {
  annotation: {
    type: 'description',
    description: `Full write round-trip: open /manage/theme-config/<id>/edit, set Brand to ${SENTINEL_HEX}, Save, then poll the digit-ui login page in fresh browser contexts until --color-primary-main flips to the sentinel (persister + boot-fetch are async; generous 120s budget). Finally assert the login button's computed background equals ${SENTINEL_RGB} — the painted pixel that regressed before digit-ui-esbuild#124. afterAll restores the original MDMS record via _update and polls until it sticks.`,
  },
  tag: ['@area:configurator-manage', '@area:theme', '@kind:regression', '@layer:ui', '@persona:admin'],
}, async ({ page, browser }) => {
  test.setTimeout(300_000);

  // ── 1. Edit Brand in the configurator ─────────────────────────────────
  await page.goto(`/configurator/manage/theme-config/${THEME_RECORD_ID}/edit`, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });

  // The deployed semantic editor groups fields under these tabs.
  await expect(page.getByRole('tab', { name: 'Brand & Surface' })).toBeVisible({ timeout: 30_000 });

  // "Brand" hex input — label is exact ("Brand-on" is a sibling, so anchor
  // the match). ColorInput renders a native color swatch + a text input;
  // the text input is the form-bound one.
  const brandLabel = page.locator('label').filter({ hasText: /^Brand$/ }).first();
  await expect(brandLabel).toBeVisible({ timeout: 15_000 });
  let hexInput = brandLabel.locator('..').locator('input[type="text"]').first();
  if (!(await hexInput.isVisible().catch(() => false))) {
    hexInput = brandLabel.locator('xpath=ancestor::div[2]').locator('input[type="text"]').first();
  }
  await expect(hexInput).toBeVisible({ timeout: 10_000 });

  await hexInput.fill(SENTINEL_HEX);
  await hexInput.blur();

  // ── 2. Save ────────────────────────────────────────────────────────────
  const saveButton = page.getByRole('button', { name: /^(save|update|save changes)$/i }).first();
  await expect(saveButton, 'editor must expose a Save button').toBeVisible({ timeout: 10_000 });
  await saveButton.click();

  // Success signal: toast if the app shows one, otherwise navigation back
  // to the list. Don't fail here — persistence is asserted via digit-ui.
  await Promise.race([
    page.getByText(/saved|updated|success/i).first().waitFor({ timeout: 15_000 }),
    page.waitForURL(/\/manage\/theme-config(?!.*\/edit)/, { timeout: 15_000 }),
  ]).catch(() => console.log('[roundtrip] no explicit save confirmation — relying on digit-ui poll'));

  // ── 3. Poll digit-ui until the sentinel lands ─────────────────────────
  // MDMS _update → Kafka → persister → digit-ui boot fetch. Each probe uses
  // a fresh browser context so no MDMS/localStorage cache can mask it.
  await expect
    .poll(async () => (await readDigitUiTheme(browser)).primaryMain.toLowerCase(), {
      timeout: 120_000,
      intervals: [10_000],
      message: 'digit-ui --color-primary-main should flip to the sentinel after save',
    })
    .toBe(SENTINEL_HEX.toLowerCase());

  // ── 4. The pixel that used to regress: login button background ────────
  const finalState = await readDigitUiTheme(browser);
  console.log('[roundtrip] final digit-ui state:', finalState);
  expect(finalState.buttonBg, 'login button must paint the themed color (digit-ui-esbuild#124)').toBe(SENTINEL_RGB);
});
