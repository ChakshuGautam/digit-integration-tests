# Admin (Configurator) UI — Flows & Stories Catalogue

Source-of-truth map between **configurator user journeys** and the specs under
`tests/admin/`. Each flow lists routes, components, user actions, API calls,
and edge cases — grounded in what the live `/configurator/` SPA actually does
on `https://naipepea.digit.org/configurator/`.

> **Last validated**: 2026-04-30 against `https://naipepea.digit.org/configurator/`.

When stories drift (UI redesigns, route renames, schema shape changes), update
this doc in the same PR as the spec change so the map stays accurate.

## Provenance

Derived from `ChakshuGautam/digit-configurator@main` source plus the live build.
See `Nai Pepea/issues/NAIPEPEA-FIX-PLAN.md` for the underlying issue ledger
(CCRS#404, #412, #416, #417, #418, #436, #437, #439, #459-462, #467-468, #476…)
that drives most of the recent assertions here.

## Configurator route table

Base: `https://naipepea.digit.org/configurator/`. Authenticated session is
written to `auth.json` by `tests/fixtures/auth.setup.ts`.

| Route | Purpose |
|---|---|
| `/configurator/login` | Login form. Tenant + username + password; `autoComplete="off"` per #412. |
| `/configurator/manage` | Default landing after login — sidebar + dashboard. |
| `/configurator/manage/mdms-schemas` | MDMS schema catalogue (35 schemas registered on `ke`). |
| `/configurator/manage/employees` | HRMS employee list. |
| `/configurator/manage/employees/create` | Single-employee create form. |
| `/configurator/manage/employees/bulk` | Excel bulk-import wizard. |
| `/configurator/manage/employees/:uuid` | Show / Edit. |
| `/configurator/manage/users` | User (citizen) list — defaults to `roleCodes=['CITIZEN']`. |
| `/configurator/manage/users/create` | Citizen-user create. |
| `/configurator/manage/users/:uuid` | Show / Edit citizen-user. |
| `/configurator/manage/departments` | List/Create/Edit/Bulk. |
| `/configurator/manage/designations` | Same surface as departments. Multi-department chip array (PR #5 schema fix). |
| `/configurator/manage/complaint-types` | List/Create/Edit/Bulk for PGR ServiceDefs. |
| `/configurator/manage/complaints` | Inbox over `pgr-services` v2; server-side pagination + status/date filters. |
| `/configurator/manage/complaints/create` | Employee-CMS create-complaint wizard (CCRS#437). |
| `/configurator/manage/complaints/:id` | Detail + workflow actions. |
| `/configurator/manage/boundary-hierarchies` | List/Create with tenant picker (PR #25). |
| `/configurator/manage/tenants` | Tenant list (view-only on naipepea today). |
| `/configurator/manage/localization` | Pivot view (en_IN ↔ sw_KE) over enabled modules. |
| `/configurator/manage/theme-config/:code` | 38-color theme editor (`kenya-green`). |
| `/configurator/phase/1` | Onboarding Phase 1 — tenant info + branding upload. |
| `/configurator/phase/2` | Onboarding Phase 2 — boundary setup. |
| `/configurator/phase/3` | Onboarding Phase 3 — masters (depts/designations/complaint-types). |
| `/configurator/phase/4` | Onboarding Phase 4 — bulk-import employees + go-live. |

---

## Flow 1: Login + Navigation

### Story 1.1: Login form contract

- **Route**: `/configurator/login`
- **Form**: `autoComplete="off"`; password input has `autocomplete="new-password"`
  so browsers don't seed credentials (#412).
- **Validation**: tenant + username + password all required; surfaces inline
  errors before the API round-trip.
- **Spec**: `tests/admin/login.spec.ts`.

### Story 1.2: Authenticated landing + sidebar inventory

- **Route**: `/configurator/manage` after login.
- **Sidebar**: surfaces every registered MDMS schema plus dedicated routes for
  employees / users / departments / designations / complaint-types / complaints
  / boundary-hierarchies / theme / localization. The "Schemas" item replaces
  the older "Advanced" link (MDMS-1 work, PR #1).
- **Spec**: `tests/admin/login.spec.ts`, `tests/admin/recently-shipped-fixes.spec.ts`
  (`#417` no UndoToast).

---

## Flow 2: Onboarding (Phase 1 → 4)

### Story 2.1: Phase 1 — tenant info + branding upload (CCRS#418, #467)

- **Route**: `/configurator/phase/1`.
- **Two-step wizard**:
  1. Tenant info (name, code, type, lat/long, locale).
  2. Branding upload — Header logo, Header logo (dark), State logo. Each row
     accepts `image/*`; on submit, the file is POSTed to `/filestore/v1/files`
     and the returned `fileStoreId` is stamped onto the tenant record.
- **Server contract**: filestore validates `ALLOWED_FORMATS_MAP` for the
  `branding` module — JPEG / PNG / SVG. SVG was historically rejected by
  default; `reference_filestore_quirks` memory has the fix.
- **Failure modes**:
  - Client-side guard: non-image MIME → inline error before round-trip.
  - Server-side rejection (size, allow-list): `setBrandingErrors[type] = msg`.
  - **#467** — Upload Logo button currently fires the file picker but the
    POST never happens (or the response is dropped). Until fixed, the
    "Uploaded ✓" badge never appears and Continue stays disabled.
- **Spec**: `tests/admin/target-tenant-onboarding.spec.ts` (target-tenant
  persistence), `tests/admin/configurator-fixes-2026-04-30.spec.ts` (#467
  logo upload).

### Story 2.2: Phase 2 — boundary setup (CCRS#414, #468)

- **Route**: `/configurator/phase/2`.
- **Two paths**: create new hierarchy OR select existing.
- **Template download**: a "Download Template" button (`handleDownloadTemplate`
  in `Phase2Page.tsx:278`) is currently a stub showing
  `alert('Template download would start here.')`. **#468** — until the stub is
  replaced with a real XLSX builder, no template can be filled in offline.
- **Hierarchy create lands at `state.targetTenant`** (PR #26 `a502fa0`),
  not the session tenant.
- **Spec**: `tests/admin/boundary-hierarchies.spec.ts`,
  `tests/admin/configurator-fixes-2026-04-30.spec.ts` (#468 template guard).

### Story 2.3: Phase 3 — masters bulk-import

- **Route**: `/configurator/phase/3`.
- Uploads departments, designations, complaint-types via XLSX. Writes land at
  `state.targetTenant`.
- **Spec**: `tests/admin/target-tenant-onboarding.spec.ts`.

### Story 2.4: Phase 4 — bulk employees + credentials CSV

- **Route**: `/configurator/phase/4`.
- Excel upload → preview → bulk-create at the target tenant (PR #25/#26/#34).
- Completion screen offers a Credentials CSV download
  (`handleDownloadCredentials`).
- **Spec**: `tests/admin/employees.spec.ts` (test 7 — bulk import).

---

## Flow 3: Manage Employees

### Story 3.1: List + filter

- **Route**: `/configurator/manage/employees`.
- Search narrows; Status filter toggles Active/Inactive; columns are
  Code / Name / Mobile / Status.
- **Spec**: `tests/admin/employees.spec.ts` (test 1).

### Story 3.2: Single create — happy path (CCRS#404, #419, #416, #436)

- **Route**: `/configurator/manage/employees/create`.
- **Form sections** (per `EmployeeCreate.tsx`):
  - Tenant (DigitFormSelect over the `tenants` resource — defaults to session
    tenant; root admin can target a child tenant, e.g. `ke.nairobi`).
  - Employee Info (Name, Employee Code auto-derived, Mobile, Email, DOB,
    Gender, Date of Appointment, Status, Type).
  - Roles (RolesEditor; combobox over MDMS `ACCESSCONTROL.ROLES`).
  - Assignments (department + designation; at least one current).
  - Jurisdictions (boundary picker).
  - Account password (defaults to `eGov@123`).
- **API**: `POST /egov-hrms/employees/_create?tenantId=<targetTenant>`.
- **Critical contracts**:
  - DOB required (`required` attribute, server-enforced — #404 / #419).
  - Mobile passes `useMobileValidator` (Kenya pattern from
    `ValidationConfigs.mobileNumberValidation`).
  - Success toast appears (#436).
- **Spec**: `tests/admin/employees.spec.ts` (test 2).

### Story 3.3: Tenant routing — UI selection wins (CCRS#459)

- **Bug**: `EmployeeCreate.transform` previously used the session tenant
  (closure `tenantId`) instead of `data.tenantId`. A root-`ke` admin would
  pick `ke.nairobi` in the form but the POST landed at `ke`. PR #31 fixed
  the closure shadowing.
- **Regression guard**: Create with explicit `tenantId=ke.nairobi` from a
  root-tenant session → HRMS `_search` against `ke.nairobi` returns the
  employee; same search at `ke` does NOT.
- **Spec**: `tests/admin/configurator-fixes-2026-04-30.spec.ts` (#459).

### Story 3.4: Form integrity — single Username field (CCRS#460)

- **Bug**: prior builds rendered TWO "Username" labels (one in Account section,
  one duplicating in Employee Info). The current form derives `userName` from
  the employee code in `transform()` and renders no Username input on Create
  at all; on Edit, the disabled Username input appears exactly once at
  `EmployeeEdit.tsx:234`.
- **Regression guard**: `page.getByLabel(/^Username/i).count()` is `0` on
  Create and `1` on Edit (and that one is `disabled`).
- **Spec**: `tests/admin/configurator-fixes-2026-04-30.spec.ts` (#460).

### Story 3.5: Edit — round-trip without errors (CCRS#439, #476)

- **Route**: `/configurator/manage/employees/:uuid` → Edit.
- **Disabled-on-edit**: Code, Username (#460 sub-guard).
- **Date fields**: DOB + Date of Appointment render as `YYYY-MM-DD` (custom
  `DateEpochField` translates between epoch ms ↔ HTML date input).
- **#439 regression**: adding a CITIZEN role no longer triggers
  `JsonMappingException` (PR #29 `bb95281`).
- **#476 regression**: Save on a minimal field change (e.g. Name) returns 200
  and persists to HRMS.
- **Spec**: `tests/admin/employees.spec.ts` (tests 4 / 4a),
  `tests/admin/configurator-fixes-2026-04-30.spec.ts` (#476).

### Story 3.6: Deactivate

- Status = INACTIVE → DeactivationReasonSection mounts → reason from MDMS
  `deactivation-reasons` (with hardcoded floor: OTHERS / RETIRED /
  TERMINATED / RESIGNED).
- **Spec**: `tests/admin/employees.spec.ts` (test 5).

### Story 3.7: Bulk import

- 3 valid + 2 invalid rows → preview shows 2 errors → Create N → completion
  page → credentials CSV download.
- **Spec**: `tests/admin/employees.spec.ts` (test 7).

---

## Flow 4: Manage Users (citizen accounts)

### Story 4.1: List + columns

- **Route**: `/configurator/manage/users`.
- Default filter: `roleCodes=['CITIZEN']`.
- Columns: Username / Name / Mobile / Type. **No** search/filter bar (the UI
  doesn't define one).
- **Spec**: `tests/admin/users.spec.ts` (test 1).

### Story 4.2: Create citizen — Kenya mobile accepted (CCRS#461)

- **Route**: `/configurator/manage/users/create`.
- **Form** (per `UserCreate.tsx`): Username, Name, Mobile, Email, Gender.
  Defaults — type `CITIZEN`, password `eGov@123`, role `CITIZEN`.
- **Mobile validator**: `useMobileValidator()` reads
  `ValidationConfigs.mobileNumberValidation` (Kenya pattern: `^0?[17][0-9]{8}$`)
  and surfaces the error message + helper text from MDMS.
- **#461 regression**: the legacy hardcoded India regex (`^[6-9][0-9]{9}$`)
  rejected Kenyan formats `0712345678` / `712345678` even though the validator
  module already pulled the correct pattern from MDMS. The test fills both
  formats and asserts neither shows the inline error.
- **Spec**: `tests/admin/users.spec.ts` (test 2 — happy path),
  `tests/admin/configurator-fixes-2026-04-30.spec.ts` (#461 — Kenya formats).

### Story 4.3: Create citizen — full mandatory set succeeds (CCRS#462)

- **Bug**: filling Username / Name / Mobile / Email / Gender with valid Kenya
  values still surfaced "INVALID_REQUEST" / failed before the egov-user POST.
  Root cause was a missing `tenantId` enrichment in the transform when the
  session was at root `ke` — the POST went to `_createnovalidate` without a
  tenant on the user object, and egov-user rejected.
- **Regression guard**: a fully-filled form lands the user (visible via
  `/user/_search` at the session tenant) and the response carries the
  expected `type: CITIZEN` + `roles[].code === 'CITIZEN'`.
- **Spec**: `tests/admin/configurator-fixes-2026-04-30.spec.ts` (#462).

### Story 4.4: Tenant routing for citizen-user create (CCRS#459 sister)

- **Same root cause as Story 3.3** but for users: the dataProvider previously
  defaulted the tenant from the session, ignoring an operator's explicit
  pick. Citizen accounts on naipepea live at `ke` (state-level) per the DPA
  encryption convention; a user-create must NOT silently land at `ke.nairobi`
  even from a city-tenant session.
- **Spec**: `tests/admin/configurator-fixes-2026-04-30.spec.ts` (#459 user
  half).

### Story 4.5: Edit — Username + Type read-only

- **Route**: `/configurator/manage/users/:uuid` → Edit.
- Username and Type fields are disabled on the form; Name + Mobile + Email +
  Gender are editable.
- **Spec**: `tests/admin/users.spec.ts` (test 3).

---

## Flow 5: Boundary hierarchies

### Story 5.1: List + tenant picker on Create (PR #25)

- **Route**: `/configurator/manage/boundary-hierarchies`.
- Columns: Hierarchy Type / Tenant / Levels (rendered as `A → B → C`).
- Create lands at the tenant picked in the form, not session tenant.
- **Spec**: `tests/admin/boundary-hierarchies.spec.ts`.

### Story 5.2: Phase 2 boundary template download (CCRS#468)

- See Story 2.2. The template download is a stub today; the regression guard
  asserts that clicking Download Template produces an actual XLSX download
  (or, when red, that the stub `alert` is the observed behavior — flips to
  green when the real implementation lands).
- **Spec**: `tests/admin/configurator-fixes-2026-04-30.spec.ts` (#468).

---

## Flow 6: Departments / Designations / Complaint-types

### Story 6.1: List + filter + bulk import/export

- All three follow the same DigitList → DigitDatagrid pattern with bulk
  import/export buttons in the header action row.
- Designation `data.department` is an array (PR #5 schema fix); single-string
  legacy values coerce on load.
- **Spec**: `tests/admin/departments.spec.ts`,
  `tests/admin/designations.spec.ts`,
  `tests/admin/complaint-types.spec.ts`.

---

## Flow 7: Manage Complaints (Employee CMS)

### Story 7.1: List + server-side filters

- **Route**: `/configurator/manage/complaints`.
- Default `ORDER BY ser_createdtime DESC`. Sortable: `serviceRequestId`,
  `applicationStatus`. Status + date-range push to server-side filters.
  **Department** filter is client-side.
- **Spec**: `tests/admin/complaints.spec.ts`.

### Story 7.2: Create complaint (CCRS#437) — multi-bug guard

- **Route**: `/configurator/manage/complaints/create`.
- **Form** (per `digit-ui-esbuild` employee CMS, `CreateComplaintConfig.js`):
  Complainant Name + Contact (auto-filled if logged-in citizen), Complaint
  Type → Subtype, Address (City → Locality cascade), Photo.
- **#437 sub-bugs**:
  1. **Subtype reset on Type change** — fixed in
     `products/pgr/src/pages/citizen/Create/FormExplorer.js:319` (PR #26
     `bad43fb`); the regression test changes type and asserts the subtype
     dropdown clears.
  2. **Locality reset on City change** — same pattern; not yet shipped.
     Test currently red until the cascade clears the locality on city
     change.
  3. **Complainant Name regex rejects 4-char names** — current pattern
     `^[A-Za-z][A-Za-z0-9 _\-\(\)]{4,29}$` requires ≥5 characters. Fix is
     to drop the inner `{4,29}` floor (or set it to `{1,29}`). Test
     currently red.
  4. **Complaint Type dropdown blank** — fixed via `useServiceDefs`
     populating `menuPathName` (PR #42); regression already covered in
     `tests/admin/recently-shipped-fixes.spec.ts` (CCRS#42 block).
  5. **Validation errors not localized** — required keys
     (`CORE_COMMON_REQUIRED_ERRMSG`, `CORE_COMMON_INVALID_ERRMSG`,
     `CORE_COMMON_PROFILE_MAXIMUM_UPLOAD_SIZE_EXCEEDED`) must resolve in
     en_IN AND sw_KE.
- **Spec**: `tests/admin/cms-create-complaint-fixes-2026-04-30.spec.ts`.

---

## Flow 8: MDMS / Theme / Localization / Hardcoding

Already documented in `MDMS-VISIBILITY-PLAN.md` and `STATUS.md`. Specs:

- `tests/admin/theme-applied.spec.ts` — kenya-green palette propagation.
- `tests/admin/theme-editor.spec.ts` — 38 color pickers.
- `tests/admin/localization.spec.ts` — pivot view, missing-locale em-dash.
- `tests/admin/hardcoding.spec.ts` — no `pg` / Nagpur strings leak.
- `tests/admin/configurator-mdms-fixes-2026-04-29.spec.ts` — descriptor system.

---

## Issue ↔ spec quick-index

| Issue | Surface | Spec | Status |
|---|---|---|---|
| #404 / #419 | Create employee — DOB + roles | employees.spec.ts test 2 | Green (PRs `c7a2077`, `f6f27bd`) |
| #412 | Login form autocomplete | login.spec.ts | Green (PR #28 `d501bbf`) |
| #414 | Phase-2 hierarchy at target tenant | target-tenant-onboarding.spec.ts | Green (PR #26 `a502fa0`) |
| #416 | Tenant picker on Create | employees.spec.ts test 2 | Green (PR #31 `4838d46`) |
| #417 | Undo toast removed | recently-shipped-fixes.spec.ts | Green (PR #35) |
| #418 | Phase 1 branding preview | (manual smoke) | Green (PR #28 `d501bbf`) |
| #436 | Success toast on Create/Edit | employees.spec.ts test 2 | Green (PR #31 `4838d46`) |
| #437 | CMS create-complaint sub-bugs | cms-create-complaint-fixes-2026-04-30.spec.ts | Mixed (subtype green, others red) |
| #439 | Edit roles JsonMappingException | employees.spec.ts test 4a | Green (PR #29 `bb95281`) |
| **#459** | Tenant routing on user/employee create | configurator-fixes-2026-04-30.spec.ts | Green (PR #31) — regression guard |
| **#460** | Duplicate Username field | configurator-fixes-2026-04-30.spec.ts | Green — regression guard |
| **#461** | Kenya mobile rejected on user create | configurator-fixes-2026-04-30.spec.ts | Green — regression guard |
| **#462** | Citizen user create with mandatory details | configurator-fixes-2026-04-30.spec.ts | To validate live |
| **#467** | Phase 1 logo upload | configurator-fixes-2026-04-30.spec.ts | Red until upstream fix |
| **#468** | Phase 2 boundary template download | configurator-fixes-2026-04-30.spec.ts | Red until stub replaced |
| **#476** | Edit existing employee details | configurator-fixes-2026-04-30.spec.ts | To validate live |

Bold rows are added in this 2026-04-30 wave.
