# Employee UI — Flows & Stories Catalogue

Source-of-truth map between **employee user journeys** and the specs under
`tests/employee/`. Each flow lists routes, components, user actions, API
calls, and edge cases — grounded in what the live employee UI actually
does, not what the source code suggests it might.

> **Last validated**: 2026-04-30 against
> `https://naipepea.digit.org/digit-ui/employee/` (digit-ui-esbuild HMR
> at `/opt/digit-ui-esbuild/`, port 18080, behind nginx).

When stories drift, update this doc in the same PR as the spec change so
the map stays accurate.

## Provenance

Source walk over `digit-ui-esbuild/packages/modules/core/src/pages/employee/*`
plus the live build. See `Nai Pepea/issues/NAIPEPEA-FIX-PLAN.md` for the
issue ledger driving the recent assertions (CCRS#443, #444, #445, #446,
#406, #437, #438).

## Employee route table

Base: `https://naipepea.digit.org/digit-ui/employee/`. Authenticated session
in `auth.json` (storageState) by `tests/fixtures/auth.setup.ts`.

| Route | Purpose |
|---|---|
| `/digit-ui/employee/user/login` | Login (mobile + password). |
| `/digit-ui/employee/user/language-selection` | First-launch locale + tenant pick. Reset target via `localStorage.clear()` per memory `feedback_isolated_worktree_for_prs.md`. |
| `/digit-ui/employee/` | Landing — module cards (HRMS, Complaint Registry…). IM module hidden via `EMPLOYEE_MODULE_DENYLIST` (#446). |
| `/digit-ui/employee/user/profile` | Edit Profile — Name + Gender + Email + Photo + Mobile. |
| `/digit-ui/employee/pgr/inbox` | PGR inbox (default-open states, status filter, SLA sort). |
| `/digit-ui/employee/pgr/complaint/details/:id` | Complaint detail + workflow actions. |
| `/digit-ui/employee/pgr/complaint/inbox` | (legacy alias used by some modules) |
| `/digit-ui/employee/pgr/complaint/create` | Employee CMS create-complaint (CCRS#406, #437, #438). |
| `/digit-ui/employee/hrms/inbox` | HRMS employee search / list. |

---

## Flow 1: Authentication

### Story 1.1: Login

- **Route**: `/digit-ui/employee/user/login`.
- **Form**: mobile + password + tenant. Tenant picker lists only the
  globalConfigs `LOGIN_TENANT_ALLOWLIST` (single-tenant deployments hide
  the picker entirely — partial #443 fix).
- **API**: `POST /user/oauth/token` with `Basic egov-user-client:` (empty
  secret) per `reference_naipepea_oauth_client`.
- **Spec**: `tests/employee/login.spec.ts`.

### Story 1.2: Sidebar inventory

- After login, sidebar surfaces Home / each enabled module / language pill /
  notifications / user menu.
- IM module is suppressed via `EMPLOYEE_MODULE_DENYLIST=["IM"]` (#446).
- HamburgerButton swap (#36) kills the React mobile-render warning.
- **Spec**: `tests/employee/sidebar.spec.ts`.

---

## Flow 2: Profile

### Story 2.1: View / edit Profile

- **Route**: `/digit-ui/employee/user/profile`.
- **Page component**: `UserProfile` in
  `packages/modules/core/src/pages/citizen/Home/UserProfile.js` (shared
  with citizen — flagged via `userType` prop).
- **Editable fields**:
  - Name, Gender (dropdown), Email.
  - Mobile is unconditionally editable on naipepea (`MULTI_ROOT_TENANT`
    is unset; PR #45 dropped the gate).
  - Photo via `UploadDrawer`.
- **Persist**: `Digit.UserService.userProfileUpdate({ Users: [...] })`.
- **Spec**: `tests/employee/profile.spec.ts`.

### Story 2.2: Profile photo upload (CCRS#445)

- **Component**: `UploadDrawer` in
  `packages/modules/core/src/pages/citizen/Home/ImageUpload/UploadDrawer.js`.
- **Bug history**: legacy 1 MB cap rejected most phone-camera JPEGs and
  surfaced as "upload broken". PR #29 `500b4fa` raised
  `MAX_PROFILE_IMAGE_BYTES` to 5 MB (DIGIT filestore default for image
  modules).
- **Contract**:
  - File picker accepts `image/*, .png, .jpeg, .jpg`.
  - Files ≥ 5 MB → toast `CORE_COMMON_PROFILE_MAXIMUM_UPLOAD_SIZE_EXCEEDED`,
    no POST.
  - Files < 5 MB → POST to `/filestore/v1/files` (module
    `${userType}-profile`, e.g. `employee-profile`) → `fileStoreId` returned
    → `setProfilePic(fileStoreId)` updates the avatar.
- **Regression guard**: bundle contains the 5 MB constant
  (`5 * 1024 * 1024` or `5242880`). A profile-update API call after the
  upload carries the new `photo` filestore id.
- **Spec**: `tests/employee/profile-fixes-2026-04-30.spec.ts` (#445).

---

## Flow 3: PGR Inbox

### Story 3.1: Inbox defaults (CCRS#432)

- **Route**: `/digit-ui/employee/pgr/inbox`.
- Default filter: open states (PENDINGFORASSIGNMENT, PENDINGATLME,
  PENDINGFORREASSIGNMENT, RESOLVED-pending-rate, etc).
- Status filter populates from the workflow business service (11 PGR
  states — see `tests/admin/recently-shipped-fixes.spec.ts`).
- SLA sort icon hidden until pgr-services accepts `sortBy=serviceSla`.
- **Spec**: `tests/employee/pgr-fixes-2026-04-29.spec.ts`,
  `tests/admin/recently-shipped-fixes.spec.ts`.

### Story 3.2: Workflow actions on detail

- ASSIGN, REJECT, RESOLVE, REOPEN, ESCALATE — labels localized from
  `rainmaker-pgr` (#430), employees filtered by role bucket (#93).
- **Spec**: `tests/employee/pgr-fixes-2026-04-29.spec.ts`.

---

## Flow 4: CMS Create Complaint (CCRS#437, #438, #406)

### Story 4.1: Boundary cascade — full County → Sub-County → Ward

- Replaced flat 2-level City + Locality with `PGRBoundaryComponent`
  driven by MDMS `CMS-BOUNDARY.HierarchySchema` (#438, PR #38 `c2fe836`).
- **Spec**: covered indirectly via API in
  `tests/admin/complaints.spec.ts`.

### Story 4.2: Subtype + Locality reset on parent change (CCRS#437)

- Changing Complaint Type clears the subtype (PR #26 `bad43fb`).
- Changing City clears the locality (still open as of 2026-04-30).
- **Spec**: `tests/admin/cms-create-complaint-fixes-2026-04-30.spec.ts`.

### Story 4.3: Complainant Name regex (CCRS#437)

- Current pattern `^[A-Za-z][A-Za-z0-9 _\-\(\)]{4,29}$` rejects 4-char
  names. Fix is to relax the inner floor to `{1,29}`.
- **Spec**: `tests/admin/cms-create-complaint-fixes-2026-04-30.spec.ts`.

---

## Issue ↔ spec quick-index

| Issue | Surface | Spec | Status |
|---|---|---|---|
| #421 | Landing-page spacing | (manual smoke) | Green (PRs #22-#24) |
| #430 | Action button labels localized | recently-shipped-fixes.spec.ts | Green |
| #432 | PGR inbox defaults | recently-shipped-fixes.spec.ts | Green (UI half) |
| #437 | CMS create-complaint sub-bugs | cms-create-complaint-fixes-2026-04-30.spec.ts | Mixed (some red) |
| #438 | 3-level boundary cascade | (covered by #406) | Green |
| #441 | Citizen rating crash | (citizen surface) | Green |
| #444 | Profile +91 prefix + save | profile.spec.ts | Green |
| **#445** | Profile image upload (5 MB cap) | profile-fixes-2026-04-30.spec.ts | Green — regression guard |
| #446 | IM module hidden | sidebar.spec.ts | Green |

Bold rows are added in this 2026-04-30 wave.
