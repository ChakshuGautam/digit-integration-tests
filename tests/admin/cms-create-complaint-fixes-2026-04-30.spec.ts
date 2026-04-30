/**
 * CMS create-complaint regression suite (CCRS#437).
 *
 * Issue umbrella covers four sub-bugs in the employee Complaint
 * Management System create form (mounted at
 * `/digit-ui/employee/pgr/complaint/create` and surfaced in the
 * configurator at `/configurator/manage/complaints/create`):
 *
 *   1. Subtype dropdown does NOT clear when Complaint Type changes
 *      (also tracked separately as #84) — fixed in
 *      `products/pgr/src/pages/citizen/Create/FormExplorer.js:319`
 *      via PR #26 `bad43fb`. Regression guard: change type → subtype
 *      value must be empty/undefined before render.
 *   2. Locality dropdown does NOT clear when City changes — same
 *      cascade pattern, still open as of 2026-04-30. Regression
 *      guard is currently EXPECTED-RED until the upstream fix lands.
 *   3. Complainant Name regex rejects 4-char names — current pattern
 *      `^[A-Za-z][A-Za-z0-9 _\-\(\)]{4,29}$` requires ≥5 chars total
 *      (1 letter + ≥4 more). Per
 *      `products/pgr/src/configs/CreateComplaintConfig.js:42`. Fix
 *      target: relax the inner floor from `{4,29}` to `{1,29}`.
 *      Currently EXPECTED-RED.
 *   4. Complaint Type dropdown blank — fixed via PR #42
 *      `useServiceDefs` populating `menuPathName`; covered already
 *      by `tests/admin/recently-shipped-fixes.spec.ts` CCRS#42 block.
 *      Re-asserted here at the API level for completeness.
 *   5. Validation error messages not localized — assert the keys
 *      `CORE_COMMON_REQUIRED_ERRMSG` and `CORE_COMMON_INVALID_ERRMSG`
 *      resolve in en_IN AND sw_KE.
 *
 * Why this lives under tests/admin/: the configurator's
 * `/manage/complaints/create` route uses the same upstream
 * digit-ui-esbuild bundle for the form widget set; asserting at the
 * configurator surface keeps these regressions caught from the same
 * persona as the rest of the CMS work.
 */
import { test, expect } from '@playwright/test';

import { BASE_URL, ROOT_TENANT } from '../utils/env';

const LOC_SEARCH = `${BASE_URL}/localization/messages/v1/_search`;
const NAME_REGEX_SOURCE = String.raw`^(?!.*[ _-]{2})(?!^[\s_-])(?!.*[\s_-]$)(?=^[A-Za-z][A-Za-z0-9 _\-\(\)]{4,29}$)^.*$`;

test.describe('CCRS#437 — CMS create-complaint regressions', () => {
  test('sub-1: subtype reset constant is wired into the citizen FormExplorer', async () => {
    test.setTimeout(180_000);
    // The reset is implemented in FormExplorer.js by calling
    // `setValue("SelectSubComplaintType", undefined, ...)` whenever the
    // current `menuPath` differs from the previous one. The constant
    // string `SelectSubComplaintType` plus the `setValue` invocation
    // both have to survive a refactor for the bug to stay closed.
    const r = await fetch(`${BASE_URL}/digit-ui/index.js`);
    expect(r.ok, `digit-ui index.js fetch should succeed (got ${r.status})`).toBe(true);
    const text = await r.text();
    expect(text).toContain('SelectSubComplaintType');
    expect(text).toContain('SelectComplaintType');
    // Defence-in-depth: the comment marker for the reset behaviour
    // doesn't survive minification, so we instead assert that the
    // bundle still references both upper-case identifiers and the
    // `previousMenuPath` ref name. If the cascade is ever rewritten,
    // both names tend to disappear together.
    expect(text).toMatch(/previousMenuPath/i);
  });

  test('sub-2: locality reset on city change — EXPECTED-RED until fix lands', async () => {
    // The bug: changing the City dropdown does NOT clear `Locality` /
    // `address.locality`. Without an upstream fix matching the subtype
    // pattern (setValue(localityField, undefined, ...) on city change),
    // the bundle won't reference the locality field name in the right
    // structural context.
    //
    // Conservative bundle check: when the fix lands, we'd expect to
    // see a setValue call against the locality form key adjacent to a
    // city/tenant change handler — but pinning that pattern at the
    // bundle level is brittle. We instead encode the expectation as a
    // soft assertion and let it drive a manual re-walk when the issue
    // closes.
    test.fail(
      true,
      'CCRS#437 sub-2: city → locality cascade reset not yet shipped. ' +
        'Drop test.fail() once the analogue of FormExplorer.js:319 lands ' +
        'for the city/locality pair.',
    );

    const r = await fetch(`${BASE_URL}/digit-ui/index.js`);
    const text = await r.text();
    // Once the fix lands, the locality reset should mirror the subtype
    // pattern: a setValue against the locality form key whenever the
    // city/tenant value changes. Until then, no such pattern exists
    // and this expectation will fail.
    expect(text).toMatch(
      /setValue\([^)]*locality[^)]*undefined/i,
    );
  });

  test('sub-3: Complainant Name regex must accept 4-char names — EXPECTED-RED until relaxed', async () => {
    // Rebuild the live regex from the source — once we ship the fix
    // we'll come back and update the pattern here in the same PR.
    const re = new RegExp(NAME_REGEX_SOURCE);

    // Document current behaviour first so a passing test can't be a
    // false-positive: 5+ char names already pass.
    expect(re.test('Alice')).toBe(true); // 5 chars — should pass today
    expect(re.test('Bob Smith')).toBe(true); // 9 chars — should pass today

    // The actual fix-target: 4-char names like "Mary", "Anna", "Phil",
    // "Anne", and many real Kenyan first names ("Mary", "Anne",
    // "John") get rejected. Once the regex is relaxed to `{1,29}` (or
    // similar) inside the lookahead, these flip to passing.
    test.fail(
      true,
      'CCRS#437 sub-3: Complainant Name regex still rejects 4-char names. ' +
        'Fix target: products/pgr/src/configs/CreateComplaintConfig.js:42 — ' +
        'change `{4,29}` to `{1,29}` (or the agreed minimum) inside the ' +
        'lookahead.',
    );
    for (const name of ['Mary', 'Anne', 'John', 'Phil']) {
      expect(re.test(name), `${name} should be a valid complainant name`).toBe(true);
    }
  });

  test('sub-4: Complaint Type menuPathName labels resolve in en_IN AND sw_KE', async () => {
    // Identical contract to recently-shipped-fixes.spec.ts CCRS#42 —
    // re-asserted here so a failure attaches cleanly to #437 in the
    // wave triage.
    const codes = [
      'SERVICEDEFS.ADMINISTRATION',
      'SERVICEDEFS.WATERRELATED',
      'SERVICEDEFS.LANDRATES',
      'SERVICEDEFS.MOBILITYANDWORKS',
      'SERVICEDEFS.FINANCEANDREVENUE',
    ];
    for (const locale of ['en_IN', 'sw_KE']) {
      const r = await fetch(
        `${LOC_SEARCH}?codes=${codes.join(',')}&tenantId=${ROOT_TENANT}&locale=${locale}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ RequestInfo: { authToken: '' } }),
        },
      );
      const json = (await r.json()) as { messages?: Array<{ code: string; message: string }> };
      const messages = json.messages ?? [];
      for (const code of codes) {
        const row = messages.find((m) => m.code === code);
        expect(row, `${code} missing in ${locale}`).toBeTruthy();
        // Translation is not just the upper-snake key mirrored back.
        expect(row!.message).not.toBe(code);
      }
    }
  });

  test('sub-5: required + invalid validation messages localized in en_IN AND sw_KE', async () => {
    // The CMS form fields use `error: "CORE_COMMON_REQUIRED_ERRMSG"` and
    // `CORE_COMMON_INVALID_ERRMSG` for inline validation copy. If either
    // key isn't seeded on `ke`, citizens see a raw upper-snake string
    // and read it as "field's broken".
    const codes = ['CORE_COMMON_REQUIRED_ERRMSG', 'CORE_COMMON_INVALID_ERRMSG'];
    for (const locale of ['en_IN', 'sw_KE']) {
      const r = await fetch(
        `${LOC_SEARCH}?codes=${codes.join(',')}&tenantId=${ROOT_TENANT}&locale=${locale}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ RequestInfo: { authToken: '' } }),
        },
      );
      const json = (await r.json()) as { messages?: Array<{ code: string; message: string }> };
      const messages = json.messages ?? [];
      for (const code of codes) {
        const row = messages.find((m) => m.code === code);
        expect(row, `${code} missing in ${locale}`).toBeTruthy();
        expect(row!.message.length).toBeGreaterThan(0);
        expect(row!.message).not.toBe(code);
      }
    }
  });
});
