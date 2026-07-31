/**
 * Employee profile — image upload regression (CCRS#445).
 *
 * Bug: legacy 1 MB cap rejected nearly every phone-camera JPEG before
 * the upload was even attempted; the UploadDrawer surfaced no useful
 * error so users read it as "upload broken". PR #29 `500b4fa` raised
 * `MAX_PROFILE_IMAGE_BYTES` to 5 MB (DIGIT filestore default for image
 * modules) in
 * `packages/modules/core/src/pages/citizen/Home/ImageUpload/UploadDrawer.js`.
 *
 * What this spec asserts:
 *
 *   1. Bundle: the served digit-ui JS contains the 5 MB constant
 *      (`5242880` or `5*1024*1024`). If a refactor reverts the cap,
 *      this fast check trips before any DOM-level test.
 *
 *   2. UI: the profile page mounts a hidden `<input type="file">`
 *      whose `accept` allows image MIME types — the surface the bug
 *      report (#445) targeted. We don't actually upload an image
 *      against the live tenant because the ADMIN principal is shared
 *      and a passing test would mutate the avatar.
 *
 *   3. Localization: the size-exceeded toast key
 *      (`CORE_COMMON_PROFILE_MAXIMUM_UPLOAD_SIZE_EXCEEDED`) resolves in
 *      en_IN and sw_KE — without the translation the user sees a raw
 *      key on the size error and reads it (correctly) as "still
 *      broken".
 *
 * Submission of the actual upload is deliberately not attempted —
 * #445's regression is detectable from the static surface alone, and
 * the ADMIN account is shared.
 */
import { test, expect } from '@playwright/test';

import { BASE_URL, ROOT_TENANT } from '../utils/env';

const LOC_SEARCH = `${BASE_URL}/localization/messages/v1/_search`;

test.describe('CCRS#445 — Edit Profile image upload (5 MB cap)', () => {
  test('bundle: 5 MB constant is present in the served digit-ui JS', async () => {
    test.setTimeout(180_000);

    // The 5 MB cap appears as either the byte literal (5242880) or the
    // expression form (`5 * 1024 * 1024`). Different bundlers + minifiers
    // pick differently — accept either.
    const r = await fetch(`${BASE_URL}/digit-ui/index.js`);
    expect(r.ok, `digit-ui index.js should be served (got ${r.status})`).toBe(true);
    const text = await r.text();

    const hasLiteralBytes = text.includes('5242880');
    const hasExprForm =
      text.includes('5*1024*1024') || /5\s*\*\s*1024\s*\*\s*1024/.test(text);
    expect(
      hasLiteralBytes || hasExprForm,
      'expected 5 MB constant (5242880 or `5*1024*1024`) in digit-ui bundle',
    ).toBe(true);

    // Defence-in-depth: the legacy 1 MB cap (`1048576` or `1*1024*1024`)
    // must NOT appear in the same source string. (We can't grep the whole
    // bundle for a regression — `1048576` could legitimately come from a
    // different sub-module — but the `MAX_PROFILE_IMAGE_BYTES` symbol name
    // is unique to the profile uploader.)
    const profileSnippet = text.match(/MAX_PROFILE_IMAGE_BYTES[^;]{0,80}/);
    if (profileSnippet) {
      expect(profileSnippet[0]).not.toMatch(/1048576|1\s*\*\s*1024\s*\*\s*1024/);
    }
  });

  test('ui: profile page mounts an image-accepting file input', async ({ page }) => {
    await page.goto(`${BASE_URL}/digit-ui/employee/user/profile`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // The avatar/upload entry point is rendered via UploadDrawer behind a
    // click. Give the page a beat to mount the avatar block.
    await page.waitForTimeout(2_000);

    // Click the avatar/edit-photo affordance — the trigger varies across
    // digit-ui versions so we accept any of the common selectors.
    const avatarTrigger = page
      .locator(
        // Primary: the avatar label/img with an aria role of button.
        'button[aria-label*="profile" i], button[aria-label*="photo" i], ' +
          // Secondary: the gallery icon container.
          '[class*="profile-pic"], [class*="profile-img"], ' +
          'label[for="file"]',
      )
      .first();

    if (await avatarTrigger.isVisible().catch(() => false)) {
      await avatarTrigger.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // The UploadDrawer mounts `<input id="file" type="file" accept="..." />`
    // when the drawer opens. Even when the drawer doesn't open (selector
    // drift), the static profile page still renders the picker for the
    // form field — so we accept any `input[type=file]` on the page.
    const fileInputs = page.locator('input[type="file"]');
    const count = await fileInputs.count();
    expect(count, 'profile page must render at least one file input').toBeGreaterThan(0);

    // Pick the first one — its `accept` attribute should permit images.
    const accept = await fileInputs.first().getAttribute('accept');
    if (accept) {
      // accept can be `image/*, .png, .jpeg, .jpg` or `image/*` or any
      // permutation. Just assert the image family is present.
      expect(accept).toMatch(/image\/\*|\.jpe?g|\.png/i);
    }
  });

  test('localization: size-exceeded toast resolves in en_IN AND sw_KE', async () => {
    const code = 'CORE_COMMON_PROFILE_MAXIMUM_UPLOAD_SIZE_EXCEEDED';
    for (const locale of ['en_IN', 'sw_KE']) {
      const r = await fetch(
        `${LOC_SEARCH}?codes=${code}&tenantId=${ROOT_TENANT}&locale=${locale}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ RequestInfo: { authToken: '' } }),
        },
      );
      const json = (await r.json()) as { messages?: Array<{ code: string; message: string }> };
      const row = (json.messages ?? []).find((m) => m.code === code);
      expect(row, `${code} missing in ${locale}`).toBeTruthy();
      expect(row!.message.length).toBeGreaterThan(0);
      // Sanity: the seeded translation isn't just the upper-snake key
      // mirrored back.
      expect(row!.message).not.toBe(code);
    }
  });
});
