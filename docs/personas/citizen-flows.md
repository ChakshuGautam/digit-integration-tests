# Citizen UI — Flows & Stories Catalogue

Catalogue of every citizen-facing page, component, and user action on the
DIGIT PGR UI as deployed at `https://naipepea.digit.org/digit-ui/citizen/`.
Source code reference: `theflywheel/digit-ui-esbuild` (citizen UI lives in
`products/pgr/src/` and `packages/modules/{core,common}/src/citizen/`).

This document is the source-of-truth map between **citizen user journeys**
and the **specs in `tests/citizen/`**. The "Test-planning notes" section
at the bottom lists which stories already have a test and which are gaps.

When stories drift (UI redesigns, new wizard steps, route renames),
update this doc in the same PR as the corresponding spec changes.

## Provenance

First compiled 2026-04-29 by an Explore agent walking the
digit-ui-esbuild source, then spot-checked. The **flow set, component
names, sub-component citations, and API endpoints are accurate**.
**Specific line numbers** are sample-verified — most are off by ±10 lines
due to file drift since the read window. Treat them as locator hints,
not exact addresses; re-confirm before quoting in test code.

When this catalogue is used to plan tests, verify the exact selector / line
each test depends on against the live source first.

## Browser validation — 2026-04-29

Every flow below was walked end-to-end in Chrome against
`http://localhost:18080/digit-ui/citizen/` (digit-ui-esbuild dev server
proxying to the naipepea backend). A fresh citizen `712345678` was
auto-registered, filed a complaint (`NCCG-PGR-2026-04-29-013280`), and
visited every reachable route. Status flags below each story:

- ✅ **verified** — observed behaviour matches the catalogue
- ⚠ **corrected** — catalogue had a divergence; correction inline
- ❌ **broken** — page errors out / dead handler on the live build
- 🚫 **inferred** — couldn't validate (state-gated; e.g. rate requires RESOLVED)

See `## Validation summary — 2026-04-29` at the bottom for the headline
divergences (Profile is much smaller than catalogued; wizard has 6 steps
not 8; FAQ + How-It-Works return error pages; etc.).

---

## Citizen route table (verified — `products/pgr/src/constants/Routes.js`)

Base: `/digit-ui/citizen/pgr/`

| Route | Page |
|---|---|
| `/complaints` | `ComplaintsList` |
| `/complaint/details/:id` | `ComplaintDetailsPage` |
| `/rate/:id*` | `SelectRating` |
| `/create-complaint` (+ wizard sub-steps) | `CreatePGRFlow` (`FormExplorer`) |
| `/create-complaint/response` | `Response` |
| `/reopen` (root) | `ReopenComplaint` wrapper |
| `/reopen/:id` | step 0 — Reason |
| `/reopen/upload-photo/:id` | step 1 — UploadPhoto |
| `/reopen/addional-details/:id` | step 2 — AdditionalDetails (note: typo `addional` in source) |
| `/reopen/response` | step 3 — Response |
| `/response` | post-rate Response |

Sub-paths inside the create-complaint wizard (declared but routed inside
`FormExplorer`, not as discrete React routes):
`/subtype`, `/location`, `/pincode`, `/address`, `/landmark`,
`/upload-photos`, `/details`, `/response`.

Module entry: `products/pgr/src/Module.js` — `CitizenApp` is the citizen
route container (`./pages/citizen/index.js`).

---

## Flow 1: Authentication & Onboarding

### Story 1.1: Select language

- **Route**: `/digit-ui/citizen/select-language`
- **Page component**: `LanguageSelection` (`packages/modules/core/src/pages/citizen/Home/LanguageSelection.js`)
- **Sub-components**: `PageBasedInput`, `RadioButtons`, `Loader`
- **User actions**:
  - Click language radio → selection highlighted
  - Click "Continue" → `Digit.LocalizationService.changeLanguage()` + navigate to login
- **Localization keys**: `CS_COMMON_CHOOSE_LANGUAGE`, `CORE_COMMON_CONTINUE`

### Story 1.2: Register — enter mobile number

- **Route**: `/digit-ui/citizen/register` (`isUserRegistered=false` branch in `packages/modules/core/src/pages/citizen/Login/index.js`)
- **Page component**: `SelectMobileNumber` (`packages/modules/core/src/pages/citizen/Login/SelectMobileNumber.js`)
- **User actions**:
  - Type mobile → validated against `ValidationConfigs.mobileNumberValidation` MDMS
  - Click "Send OTP" → `Digit.UserService.sendOtp()` (TYPE_REGISTER) → OTP screen
- **API calls**: `POST /user-otp/v1/_send`
- **Edge cases**: If `INDIVIDUAL_SERVICE_CONTEXT_PATH` env is set, OTP is skipped and the flow goes directly to name entry.
- **Localization keys**: `CS_COMMON_MOBILE_NUMBER`, `CORE_COMMON_REQUIRED_ERRMSG`

### Story 1.3: Register — enter OTP

- **Route**: `/digit-ui/citizen/register/otp` (`Login/index.js` Route definition near line 410)
- **Page component**: `SelectOtp` (`packages/modules/core/src/pages/citizen/Login/SelectOtp.js`)
- **User actions**:
  - Type 6-digit OTP → presence validation
  - Click "Resend OTP" → `resendOtp()` re-calls `sendOtp`
  - Click "Submit" → `Digit.UserService.registerUser()` → `Digit.UserService.authenticate()`
- **API calls**: `POST /user/_register`, `POST /user-otp/v1/_validate`
- **Edge cases**: Auto-register-on-login fallback exists if a "login" attempt fails on an unregistered number.
- **Localization keys**: `INVALID_OTP`, `OTP_RESEND_ERROR`

### Story 1.4: Register — enter name & email

- **Route**: `/digit-ui/citizen/register/name`
- **Page component**: `SelectName` (`packages/modules/core/src/pages/citizen/Login/SelectName.js`)
- **User actions**:
  - Type name (mandatory)
  - Type email (optional)
  - Click "Continue" → standard flow proceeds to OTP, custom flow (`INDIVIDUAL_SERVICE_CONTEXT_PATH`) calls `/v1/_register`
- **Localization keys**: `CORE_COMMON_NAME`, `CORE_COMMON_EMAIL`

### Story 1.5: Login (existing citizen)

- **Route**: `/digit-ui/citizen/login` (`isUserRegistered=true` branch)
- **Page component**: `SelectMobileNumber` → `SelectOtp` (same components as register, different `userType`)
- **User actions**:
  - Type mobile → "Send OTP" → `POST /user-otp/v1/_send` (TYPE_LOGIN)
  - On naipepea, **OTP is fixed at `123456`** via Kong `request-termination` mock
  - Type OTP → `Digit.UserService.authenticate()` issues an access token
- **Edge cases**: Unregistered number → option to register surfaces; auto-register fallback path exists in code.

---

## Flow 2: Home & Landing

### Story 2.1: View home page with module cards

- **Route**: `/digit-ui/citizen/`
- **Page component**: `CitizenHome` (`packages/modules/core/src/pages/citizen/Home/index.js`)
- **Sub-components**: `TopBarSideBar`, `StaticCitizenSideBar`, `CardBasedOptions`, `ImageComponent`
- **User actions**:
  - Click "PGR / Complaints" tile → `/digit-ui/citizen/pgr`
  - Sidebar module link → respective module home
  - Header language button → `/digit-ui/citizen/select-language`
  - Header user icon → `/digit-ui/citizen/user/profile`
  - Header logout → clear user, redirect to login
- **Data sources**:
  - `uiHomePage` MDMS (banner, services card, WhatsApp banner)
  - `ACCESSCONTROL-ACTIONS-TEST` MDMS (sidebar role-action map)

### Story 2.2: Switch language from header

- **Route**: any `/digit-ui/citizen/*`
- **Component**: `TopBarSideBar` language dropdown (`packages/modules/common/src/components/TopBarSideBar/index.js`)
- **User actions**: dropdown → select language → `Digit.LocalizationService.changeLanguage()` → re-render

---

## Flow 3: File Complaint (wizard)

The wizard is a `FormComposerV2` driven by step configs declared in
`products/pgr/src/pages/citizen/Create/FormExplorer.js` (configs array
lists `createComplaint, pinComplaintLocaton, locationDetails,
complaintsLocation, additionalDetails, complaintsUploadimages`).

### Story 3.1: Pick "Myself" or "Another User"

- **Step config**: `selectComplaintType` (subtype branching)
- **User actions**: Radio → `formData.complaintType` = `MYSELF` / `ANOTHER_USER` → "Next"
- **Localization keys**: `ES_CREATECOMPLAINT_FOR`, `MYSELF`, `ANOTHER_USER`

### Story 3.2: Select complaint type (service definition)

- **Step config**: `createComplaint` (`products/pgr/src/pages/citizen/Create/steps-config/CreateComplients.js`)
- **Data source**: `RAINMAKER-PGR.ServiceDefs` MDMS, fetched via `Digit.Hooks.useCustomMDMS` in `FormExplorer`. Unique `menuPath` values are extracted and translated as `SERVICEDEFS.<UPPER_PATH>`.
- **User actions**: Open dropdown → translated complaint-type list → select → `formData.SelectComplaintType = { code, menuPathName }`
- **API calls**: `GET /MDMS/v2/search` (RAINMAKER-PGR.ServiceDefs) at module mount
- **Localization keys**: `SERVICEDEFS.*`

### Story 3.3: Select location (cascading boundary)

- **Step config**: `complaintsLocation` (`products/pgr/src/pages/citizen/Create/steps-config/ComplaintsLocation.js`)
- **Component**: `PGRBoundaryComponent` (`products/pgr/src/components/BoundaryComponent.js`) — cascading dropdowns
- **Data source**: `boundaryHierarchyOrder` from `SessionStorage`, populated by `usePGRInitialization` on module mount
- **User actions**: Cascade County → Sub-County → Ward → Locality → `formData.SelectedBoundary`
- **Localization keys**: `CS_ADDCOMPLAINT_COMPLAINT_LOCATION`, `CS_COMPLAINT_LOCATION`

### Story 3.4: Enter pincode + landmark

- **Step configs**: `pinComplaintLocaton`, `locationDetails`
- **User actions**: Type pincode (5–6 digits, regex per Kenya pattern post-#478), type landmark/address — both optional

### Story 3.5: Describe complaint

- **Step config**: `additionalDetails` (`products/pgr/src/pages/citizen/Create/steps-config/additionalDetails.js`)
- **User actions**: Type description (mandatory, ≤1000 chars)
- **Validation**: non-empty
- **Localization keys**: `CS_COMPLAINT_DETAILS_ADDITIONAL_DETAILS`

### Story 3.6: Upload photos

- **Step config**: `complaintsUploadimages`
- **Component**: `SelectImages` (`products/pgr/src/pages/citizen/Create/Steps/SelectImages.js`)
- **User actions**: Upload (drag-drop or file input), thumbnails render → `formData.attachments` = filestore IDs; remove on click
- **API calls**: `POST /filestore/v1/files`
- **Validation**: optional
- **Localization keys**: `CS_ADDCOMPLAINT_ADD_PHOTO`, `CS_ADDCOMPLAINT_UPLOAD_PHOTOS_OPTIONAL`

### Story 3.7: Review & submit

- **User actions**: Read-only summary → "Submit Complaint"
- **API calls**: `POST /pgr-services/v2/request/_create` with `serviceCode`, `description`, `address` (locality.code, pincode, landmark, geoLocation), `attachments`, `citizen` (name, mobile)
- **Payload normalization**: `validateString` ensures non-empty strings; `geoLocation` coerced to `{ latitude, longitude }`
- **Localization keys**: `CS_COMMON_REVIEW_COMPLAINT`, `CS_COMMON_SUBMIT_COMPLAINT`

### Story 3.8: See confirmation + reference number

- **Route**: `/digit-ui/citizen/pgr/create-complaint/response`
- **Component**: `Response` (`products/pgr/src/pages/citizen/Create/Steps/Response.js`)
- **User actions**: View `serviceRequestId` (e.g. `NCCG-PGR-2026-04-28-011862`) → "View Complaint" or "File Another"
- **Data source**: `complaintDetails.response.service.serviceRequestId` from Redux store
- **Localization keys**: `CS_COMMON_COMPLAINT_FILED_SUCCESSFULLY`, `CS_COMMON_COMPLAINT_NUMBER`

---

## Flow 4: My complaints / track

### Story 4.1: View my complaints list

- **Route**: `/digit-ui/citizen/pgr/complaints`
- **Page component**: `ComplaintsList` (`products/pgr/src/pages/citizen/ComplaintsList.js`)
- **Sub-components**: `Header`, `Complaint` card (`products/pgr/src/components/Complaint.js`), `Loader`, `Card`
- **User actions**:
  - Page load → `useComplaintsListByMobile(tenantId, mobileNumber)`
  - Click card → `/digit-ui/citizen/pgr/complaint/details/:id`
- **API calls**: `POST /pgr-services/v2/request/_search?mobileNumber=...`
- **Card displays**: complaint type (translated `SERVICEDEFS.*`), filed date, complaint number, status badge (`OPEN` / `CLOSED`), localized status code
- **Edge cases**: empty list → "No Complaints Found" card
- **Localization keys**: `CS_COMMON_MY_COMPLAINTS`, `CS_COMMON_COMPLAINT_NO`, `CS_COMMON_OPEN`, `CS_COMMON_CLOSED`

---

## Flow 5: Complaint details & timeline

### Story 5.1: View complaint details

- **Route**: `/digit-ui/citizen/pgr/complaint/details/:id`
- **Page component**: `ComplaintDetailsPage` (`products/pgr/src/pages/citizen/ComplaintDetails.js`)
- **Sub-components**: `StatusTable`, `Card`, `CardSubHeader`, `Loader`
- **User actions**: Read-only render driven by `useComplaintDetails({ tenantId, id })`
- **API calls**:
  - `POST /pgr-services/v2/request/_search?serviceRequestId=...`
  - `POST /MDMS/v2/search` (RAINMAKER-PGR.ServiceDefs) for translated names
  - `Digit.UploadServices.Filefetch()` for attachment URLs
- **Sections rendered**: number, status, type, subtype, description, address (street, landmark, pincode, locality), filed date, citizen (name, mobile), thumbnails, workflow timeline, rating
- **Localization keys**: `CS_HEADER_COMPLAINT_SUMMARY`, `CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS`

### Story 5.2: View workflow timeline

- **Component**: `TimeLine` (`products/pgr/src/components/TimeLine.js`, ~177 lines)
- **Sub-components**: `ConnectingCheckPoints`, `CheckPoint`, state-specific instances under `products/pgr/src/components/timelineInstances/` (`PendingForAssignment`, `PendingAtLME`, `Resolved`, `Rejected`, `Reopen`, `StarRated`), `DisplayPhotos`
- **States rendered**: `COMPLAINT_FILED → PENDINGFORASSIGNMENT → PENDINGATLME → RESOLVED → CLOSEDAFTERRESOLUTION` (rated) or `CLOSEDAFTERREJECTION`. Branches: `REJECTED`, `REOPEN`, `PENDINGFORREASSIGNMENT`.
- **Each checkpoint shows**: localized status (`CS_COMMON_<STATUS>`), timestamp, actor (name, mobile), comment, attachments
- **Localization keys**: `WF_COMMON_COMMENTS`, `CS_COMMON_ATTACHMENTS`, `CS_COMMON_PENDINGFORASSIGNMENT`, `CS_COMMON_PENDINGATLME`, `CS_COMMON_RESOLVED`, `CS_COMMON_REJECTED`

---

## Flow 6: Rate complaint & close

### Story 6.1: Rate (1–5 stars + feedback)

- **Route**: `/digit-ui/citizen/pgr/rate/:id*`
- **Page component**: `SelectRating` (`products/pgr/src/pages/citizen/Rating/SelectRating.js`)
- **Sub-components**: `RatingCard`, checkbox group, `TextArea`, `SubmitBar`
- **User actions**:
  - Click 1–5 stars
  - Tick "What was good?" checkboxes (Service quality, Resolution time, Quality of work, Others)
  - Type optional comment
  - Click "Next" → validate rating > 0, dispatch `updateComplaints`
- **Payload built**:
  - `rating` (1–5)
  - `additionalDetail` — comma-joined feedback (or empty)
  - `workflow.action` = `RATE`
  - `workflow.comments` = comment text
- **API calls**: `PUT /pgr-services/v2/request/_update` (action `RATE`)
- **Validation**: `rating > 0`; checkboxes + comment optional
- **Localization keys**: `CS_COMPLAINT_RATE_HELP_TEXT`, `CS_COMPLAINT_RATE_TEXT`, `CS_FEEDBACK_WHAT_WAS_GOOD`, `CS_FEEDBACK_SERVICES`, `CS_FEEDBACK_RESOLUTION_TIME`, `CS_FEEDBACK_QUALITY_OF_WORK`, `CS_FEEDBACK_OTHERS`, `CS_COMMON_COMMENTS`

### Story 6.2: Thank-you confirmation

- **Route**: `/digit-ui/citizen/pgr/response`
- **Component**: `Response` (`products/pgr/src/pages/citizen/Response.js`)
- **User actions**: View thank-you → "View Complaints" or "File Another"
- **Localization keys**: `CS_RATE_THANK_YOU`, `CS_COMMON_THANK_YOU_FOR_FEEDBACK`

---

## Flow 7: Reopen complaint

### Story 7.1: Reopen with reason + photos + details

- **Routes**: `/digit-ui/citizen/pgr/reopen/:id` (Reason) → `/upload-photo/:id` (Photos) → `/addional-details/:id` (Details, note typo) → `/response`
- **Component**: `ReopenComplaint` wrapper (`products/pgr/src/pages/citizen/ReopenComplaint/index.js`) chains the steps
- **User actions**:
  - Step 0: Select reason → `formData.reason`
  - Step 1: Upload photos (optional) → `formData.attachments`
  - Step 2: Type additional details
  - Step 3: Submit → reopen API
- **API calls**: `PUT /pgr-services/v2/request/_update` (action `REOPEN`)
- **Edge cases**: complaint must be in `RESOLVED` or `REJECTED` state for the action to be valid server-side
- **Localization keys**: `CS_COMMON_REOPEN_COMPLAINT`, `CS_COMMON_REASON_FOR_REOPEN`, `CS_ADDCOMPLAINT_ADDITIONAL_DETAILS`

---

## Flow 8: Profile

### Story 8.1: View & edit profile

- **Route**: `/digit-ui/citizen/user/profile`
- **Page component**: `UserProfile` (`packages/modules/core/src/pages/citizen/Home/UserProfile.js`)
- **Sub-components**: profile photo `UploadDrawer`, text inputs (name/email/mobile), city + language dropdowns, notification toggles (SMS/Email/WhatsApp), "Change Password" trigger
- **User actions**:
  - Click profile photo → upload drawer
  - Edit name → MDMS regex `/^[a-zA-Z ]+$/i`
  - Edit email — optional
  - Edit mobile — 10 digits (Kenya pattern post-#444 fix; field is editable)
  - Switch city → tenant context change
  - Switch language → `Digit.LocalizationService.changeLanguage()`
  - Toggle notification channels → upsert preferences
  - Click "Change Password" → modal
  - Click "Save" → user-update API
- **API calls**:
  - `PUT /user/{uuid}/_update` (or equivalent — confirm in source)
  - `POST /filestore/v1/files` (photo)
  - `POST /egov-common-masters/preferences/_upsert` (notif preferences)
- **Validation**: name regex, mobile pattern from MDMS, password regex `/^([a-zA-Z0-9@#$%]{8,15})$/i`
- **Localization keys**: `PROFILE_USER_PROFILE`, `CORE_COMMON_NAME`, `CORE_COMMON_EMAIL`, `CORE_COMMON_MOBILE_NUMBER`, `CORE_COMMON_LANGUAGE`, `CORE_COMMON_NOTIFICATIONS`, `CORE_COMMON_SAVE`

### Story 8.2: Change password

- **Route**: modal on `/digit-ui/citizen/user/profile`
- **User actions**: current password + new + confirm → `Digit.UserService.changePassword()`
- **API calls**: `POST /user/_updatePassword`
- **Validation**: current matches, new ≥ 8 ≤ 15, confirm matches new

### Story 8.3: Upload profile photo

- **Component**: `UploadDrawer` (`packages/modules/core/src/pages/citizen/Home/ImageUpload/UploadDrawer.js`)
- **User actions**: pick file → preview → optional crop → "Upload" → filestore + user PUT
- **API calls**: `POST /filestore/v1/files`, `PUT /user/{uuid}/`

---

## Flow 9: Logout

### Story 9.1: Log out

- **Trigger**: `TopBarSideBar` user dropdown → "Logout" (`packages/modules/core/src/components/TopBarSideBar/index.js`)
- **User actions**: Click → `Digit.UserService.logout()` → redirect to `/digit-ui/citizen/login`
- **Cleared**: user object, tokens, session context (verified by test
  `tests/citizen/logout.spec.ts` — citizen ends back on login URL, NOT `/all-services`)
- **Localization keys**: `CORE_COMMON_LOGOUT`

---

## Flow 10: Auxiliary surfaces

These exist on the citizen route map but are tangential to the PGR core
loop. Worth a smoke test, not full flow coverage.

### Story 10.1: All services directory

- **Route**: `/digit-ui/citizen/all-services` (`packages/modules/core/src/pages/citizen/Allservices/index.js`)
- **Component**: grid of available service modules
- **User actions**: tile click → module home

### Story 10.2: FAQ

- **Route**: `/digit-ui/citizen/pgr-faq` (`packages/modules/core/src/pages/citizen/FAQs/FAQs.js`)
- **Behaviour**: read-only, MDMS-driven

### Story 10.3: How it works

- **Route**: `/digit-ui/citizen/pgr-how-it-works` (`packages/modules/core/src/pages/citizen/HowItWorks/howItWorks.js`)
- **Behaviour**: read-only static / MDMS

### Story 10.4: What's new

- **Surface**: `WhatsNewCard` on home (`packages/modules/core/src/pages/citizen/Home/index.js`)
- **Data source**: `Digit.Hooks.useEvents` with `variant="whats-new"`
- **User actions**: card click → event detail

---

## Cross-cutting reference

### Hooks → API endpoints

| Hook | Endpoint | Purpose |
|---|---|---|
| `useComplaintsListByMobile` | `POST /pgr-services/v2/request/_search` | citizen's complaints |
| `useComplaintDetails` | `POST /pgr-services/v2/request/_search` + filestore | one complaint with attachments |
| `usePGRUpdate` | `PUT /pgr-services/v2/request/_update` | rate / reopen / status transition |
| `useCustomMDMS(RAINMAKER-PGR.ServiceDefs)` | `GET /MDMS/v2/search` | complaint type list |
| `useStore.getInitData` | `GET /MDMS/v2/search` | tenant/UI/language config at boot |
| `usePGRInitialization` | boundary-service | populates `boundaryHierarchyOrder` in SessionStorage |
| `useWorkflowDetails` | `egov-workflow-v2` | timeline state transitions |

### Validation surface (citizen-side, sourced from MDMS)

- `ValidationConfigs.mobileNumberValidation` → mobile regex (currently 10 digits, Kenya `07`/`01`)
- `UserProfileValidationConfig.name` → `/^[a-zA-Z ]+$/i`
- Password → `/^([a-zA-Z0-9@#$%]{8,15})$/i`
- Pincode → 5 digits (Kenya, post-#478)
- Description → non-empty, ≤1000 chars

### Where the citizen tenant comes from

`FormExplorer.js` (and other citizen entry points) read tenant via:
```
Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code
  || Digit.ULBService.getCurrentTenantId()
```
On naipepea, citizen `tenantId` = `ke` (state); address `tenantId` =
`ke.nairobi` (city). The split is enforced in the `_create` payload.

### Things deliberately not catalogued

- `dss/` (Decision Support System) — citizen exposure is unclear on naipepea; needs a separate scan if enabled.
- Engagement / events / surveys — `packages/modules/engagement/`, surface but not part of the PGR core loop.
- Payments — `packages/modules/open-payment/`; no PGR fee on naipepea so the citizen flow doesn't hit it.

---

## Test-planning notes

- 10 flows × ~3 stories average ≈ ~30 testable user journeys.
- Coverage that already exists in `tests/citizen/`:
  - `login.spec.ts` — Story 1.5 (existing-user OTP login)
  - `login-mobile.spec.ts` — Story 1.2 mobile validator (CCRS#429)
  - `complaint-details.spec.ts` — Story 5.1 detail render no-crash
  - `complaint-type-labels.spec.ts` — Story 3.2 SERVICEDEFS translation
  - `pgr-fixes.spec.ts` — Stories 4.1 / 6.1 / 5.2 spot fixes (CCRS#421/#422/#441)
  - `create-fixes-2026-04-29.spec.ts` — Story 3.4–3.7 pincode + AddressOne/Two payload (CCRS#478)
  - `timeline-fixes-2026-04-29.spec.ts` — Stories 5.2 / 6.1 timeline + rating localization (CCRS#473)
  - `logout.spec.ts` — Story 9.1
- Material gaps as of 2026-04-29:
  - **Story 1.1** language selection — no test
  - **Story 1.2/1.3/1.4** new-user registration — only existing-user login covered
  - **Story 2.1** home page tile grid — no test
  - **Story 3.1** "myself / another user" branch — no test
  - **Story 3.3** boundary cascade — no test
  - **Story 3.6** photo upload — no test
  - **Story 3.7** end-to-end submit (citizen-driven) — only the launch-fixes payload-shape spec touches it; full happy-path UI submission is in `tests/lifecycle/pgr-ui.spec.ts` not citizen/
  - **Story 6.1** rating UI flow — no test (only the post-RATE backend assertion)
  - **Story 6.2** thank-you screen — no test
  - **Story 7.1** reopen flow — no test
  - **Story 8.1/8.2/8.3** profile / password / photo — no test (employee-side `+254` prefix is the only profile assertion)
  - **Story 10.x** auxiliary — no test

---

## Validation summary — 2026-04-29

Walked the entire citizen surface in Chrome against `http://localhost:18080`.
Created a real complaint (`NCCG-PGR-2026-04-29-013280`) end-to-end. Per-flow
divergences below; the original Story sections above are kept verbatim for
historical reference, with a status flag and corrections layered here.

### Routing — corrections to the table at the top

- `/digit-ui/citizen/` redirects unauthenticated visitors to
  `/digit-ui/citizen/all-services` (NOT to `/login`, NOT to a tile grid
  module home).
- `/digit-ui/citizen/all-services` is the **default landing** post-login —
  shows "Citizen Complaint Resolution System" header with two text links
  (`File a Complaint`, `My Complaints`).
- `/digit-ui/citizen/pgr-home` is the **branded "Nai Pepea" PGR module
  home** — hero with "Report a grievance, track the resolution" and PGR
  badge. The sidebar item "Citizen Complaint R…" links here.
- Complaint detail URL is `/digit-ui/citizen/pgr/complaints/:id` (PLURAL),
  NOT `/complaint/details/:id` as `Routes.js` declares. The Routes.js
  export and the actually-mounted path diverge — trust the URL bar.
- Reopen sub-step paths (`/upload-photo/:id`, `/addional-details/:id`)
  declared in `Routes.js` are dead — the wizard doesn't navigate to them.
- The create-complaint wizard URL stays at
  `/digit-ui/citizen/pgr/create-complaint/complaint-type` for ALL 6 steps;
  per-step paths in `Routes.js` (`/pincode`, `/landmark`, etc.) are dead.

### Flow 1 — Authentication

| Story | Status | Notes |
|---|---|---|
| 1.1 select language | 🚫 inferred | No splash language-selection screen on first hit; `English` defaults in header pill. Route exists per source but isn't part of the auth path on this build. |
| 1.2 register mobile | ⚠ corrected | Page title is "Provide your mobile number" (not "Send OTP"). Button label is **"Next"**, not "Send OTP". `+254` prefix is rendered as a non-typeable hint left of the input. Helper text: "Enter your 10-digit mobile number". A `CS_LOGIN_REGISTER_WITH_EMAIL` link below mobile field is **rendered as the raw key** — localization gap. |
| 1.3 register OTP | ⚠ corrected | Title "OTP Verification". 6 separate `maxlength=1` inputs. "Resend another OTP N secs" countdown text. Button: "Next". Mobile shown without `+254` prefix as `"Enter the OTP sent to 712345678"`. Mock OTP `123456` succeeded against the local proxy. |
| 1.4 register name+email | 🚫 inferred | Walked the OTP-login path for an already-known number — the name+email screen wasn't triggered. Route `/citizen/register/name` likely exists but unverified. |
| 1.5 login | ✅ verified | Same form as register-mobile, post-OTP redirects to `/citizen/all-services` (NOT to `/citizen/`). |

### Flow 2 — Home & Landing

| Story | Status | Notes |
|---|---|---|
| 2.1 home tile grid | ⚠ corrected | No "module tile grid". Post-login lands on `/all-services` showing "Citizen Complaint Resolution System" + 2 yellow text links. Branded Nai Pepea hero is at `/pgr-home` (separate page). Sidebar after login: **Home / Citizen Complaint R… (truncated, → /pgr-home) / Edit Profile / Logout / HELPLINE**. |
| 2.2 header language switch | ✅ verified | Header has an "English" pill (top-right) + bell icon. No user-icon dropdown — logout lives in the sidebar. |

Sidebar additions to catalogue: **HELPLINE** item (renders raw "HELPLINE" key, no localization, click handler appears dead — no nav, no modal observed); avatar + mobile-as-name shown above sidebar items. No header user-dropdown exists in this build — the catalogue's "click user icon → logout" is incorrect.

### Flow 3 — File Complaint wizard — REWRITTEN (was 8 stories, actually 6 steps)

The actual wizard has **6 steps**, not 8. The catalogued Stories 3.1
("Myself / Another User") and 3.7 (Review/Confirm) **do not exist** in
the live UI — `selectComplaintType` step config in source is dead-code,
and there is no review screen between photos and submit.

| New step | Catalogue mapping | Title (live) | Behaviour |
|---|---|---|---|
| 1 | (replaces 3.1+3.2) | **Complaint Details** | Two dropdowns: Complaint Type * (e.g. `Lands`, `Innovation And Digital Economy`, `Lands` — the `menuPath` translated) + Complaint Subtype * (raw UPPER_SNAKE codes, e.g. `LAND OWNERSHIP DISPUTE`, `SURVEYING DELAY` — **not localised**). |
| 2 | 3.3 partial | **Pin Complaint Location** | Leaflet map with reverse-geocoded address shown above pin. Search bar, draggable pin, "recenter" button bottom-right. Address auto-populates downstream Postal Code. |
| 3 | 3.4 | **Location Details** | 4 fields: Address / Address Line 1 / Landmark / Postal Code. Postal Code is **pre-filled** from step 2 reverse-geocode (`40476` for the Nairobi CBD pin). All optional. |
| 4 | 3.3 | **Complaint's Location** (note apostrophe) | Cascading boundary: County → Sub County → Ward. **Only 3 levels** — no Locality. Cascade gates child levels (PR #9 / CCRS#477 fix verified). Sub-County options have **duplicate entries** ("Makadara", "Kibra" each rendered twice — boundary-data quality issue). |
| 5 | 3.5 | **Additional Details** | Single Description textarea, required. No visible char counter, no help text. |
| 6 | 3.6+3.8 | **Upload complaint photos** | Single dropzone with camera-icon "+". Optional. Bottom button: **SUBMIT** (not NEXT — this is the final step). |

Footer buttons across the wizard: **NEXT** (yellow filled) and **BACK**
(white outline). Step 6 swaps NEXT for **SUBMIT**. URL stays at
`/citizen/pgr/create-complaint/complaint-type` for all steps.

| Story | Status |
|---|---|
| 3.1 myself/another | ❌ broken/dead-coded |
| 3.2 complaint type | ✅ verified — extends to subtype too (in same step) |
| 3.3 location cascade | ✅ verified |
| 3.4 pincode + landmark | ✅ verified — actual fields are Address / Address Line 1 / Landmark / Postal Code |
| 3.5 description | ✅ verified |
| 3.6 photos | ✅ verified — also the wizard's last step |
| 3.7 review | ❌ doesn't exist |
| 3.8 confirmation | ⚠ corrected — see below |

### Flow 3.8 — Confirmation (corrected)

- URL: `/digit-ui/citizen/pgr/response` (NOT `/create-complaint/response`)
- Title: **"Complaint Submitted"** (not `CS_COMMON_COMPLAINT_FILED_SUCCESSFULLY`)
- Big green hero with thumbs-up icon
- Complaint No.: e.g. `NCCG-PGR-2026-04-29-013280`
- Body text: "The notification along with complaint number is sent to your registered mobile number. You can track the complaint status using mobile or web app."
- **Single button**: "Go back to home page" (yellow) — there is no "View Complaint" or "File Another"

### Flow 4 — My Complaints list

✅ verified with corrections:
- Card header is the **subtype name** ("Land Ownership Dispute"), not the type/menuPath as catalogued.
- Status badge: pink/light pill `OPEN` (or `CLOSED`), then the localised workflow state below ("Pending for assignment").
- Filed date format: `29-Apr-2026` (DD-Mon-YYYY).

### Flow 5 — Complaint detail + timeline

✅ verified with corrections:
- URL: `/citizen/pgr/complaints/:id` (PLURAL) — see Routing correction.
- Top section: heading "Complaint Summary", sub-card "Complaint Details" with rows: Complaint No. / Application Status / Complaint Type / Complaint Sub-Type / Additional Details / Filed Date / Address.
- Address row renders the boundary chain unlocalized: e.g. `NAIROBI_CENTRAL` then "Nairobi" then `40476`. **`NAIROBI_CENTRAL` is a raw boundary code** — localization gap.
- Map widget with lat/lng overlay + **"Open in Maps"** button (blue) — the catalogue claimed a plain `google.com/maps?q=lat,lng` link.
- Timeline section title: "Complaint Timeline".
- Timeline checkpoints: yellow dot for current state; gray dot for past. Each has status name + `DD/MM/YYYY` date + actor (mobile-as-name) + channel ("Filed Via Web").

### Flow 6 — Rate

✅ verified Story 6.1 (UI render) / 🚫 inferred Story 6.2:
- URL: `/citizen/pgr/rate/:id` ✓ — page renders even when complaint is **not** RESOLVED (server probably rejects on submit but UI is unguarded).
- Heading is the question itself: **"How would you rate your experience with us?"** (twice — page title + section title).
- 5-star rating row.
- Checkbox group "What was good ?" with options: **Services** / **Resolution Time** / **Quality of Work** / **Others** (catalogue claimed "Service quality" — actual is "Services"). Spaces around `?` in label.
- Comments textarea.
- Couldn't submit (would fail server-side); thank-you screen (Story 6.2) at `/citizen/pgr/response` shares the route with the file-complaint confirmation — content for rate-completion not validated.

### Flow 7 — Reopen

✅ verified Story 7.1 (step 0 only):
- URL: `/citizen/pgr/reopen/:id` ✓.
- Step 0 title: **"Choose Reason to Re-open the Complaint"**.
- 4 **radio** options (catalogue said "select reason → formData.reason"; actual UI is a radio group, not a free-text or dropdown):
  1. No work was done
  2. Only partial work was done
  3. Employee did not turn up
  4. No permanent solution
- "Next" button proceeds; subsequent steps not validated (state-gated, would require RESOLVED).
- Page renders for non-RESOLVED complaints — server gates the action on submit.

### Flow 8 — Profile — MAJOR shrink (was 3 stories, actually 1)

⚠ corrected — the catalogue overstates this surface heavily:
- URL: `/digit-ui/citizen/user/profile` ✓
- Fields rendered: **Photo + Name * + Gender + Email** — that's it.
- **No mobile field** (mobile is the immutable login key).
- **No language switcher**.
- **No notification toggles** (SMS / Email / WhatsApp).
- **No change-password modal** — Story 8.2 does not exist on the citizen UI.
- "Save" button (red, plain text).
- Photo upload: orange "+" camera button on the placeholder triggers a file picker (catalogue Story 8.3 — present but a sub-feature, not a separate story).

| Story | Status |
|---|---|
| 8.1 view + edit | ⚠ corrected (only Name/Gender/Email + photo) |
| 8.2 change password | ❌ not exposed on citizen UI |
| 8.3 upload photo | ✅ sub-feature of 8.1 |

### Flow 9 — Logout

✅ verified Story 9.1 with one correction:
- Trigger is the **sidebar** "Logout" item (NOT a header dropdown — there is no header user dropdown on this build).
- Click → modal: title "Logout", message "Are you sure you want to **Logout**", buttons **Cancel** + **Yes, Logout**.
- Existing `tests/citizen/logout.spec.ts` matches `button:has-text("Yes")` — should ideally tighten to `Yes, Logout` (the actual label).

### Flow 10 — Auxiliary

| Story | Status | Notes |
|---|---|---|
| 10.1 all-services | ⚠ corrected — it's the **default landing**, not an aux page. Title "Citizen Complaint Resolution System". Two text links: File a Complaint (→ wizard step 1) and My Complaints (→ list). Also reachable as `/digit-ui/citizen/all-services`. |
| 10.2 FAQ | ❌ broken — `/digit-ui/citizen/pgr-faq` returns "Something went wrong" + a "Home" button. Broken `<img>` placeholder shows raw text "error". |
| 10.3 How it works | ❌ broken — `/digit-ui/citizen/pgr-how-it-works` shows the same "Something went wrong" page. |
| 10.4 What's New | 🚫 inferred — no `WhatsNewCard` visible on `/all-services` or `/pgr-home`; not validated. Likely not enabled on this build. |

Additional finding: `/digit-ui/citizen/pgr-home` is the **branded module home** ("Nai Pepea" / "Report a grievance, track the resolution" / "Nairobi City County Government" / PGR badge). Not in the original catalogue — add as Story 10.5 if anyone wants to test the brand surface.

The `HELPLINE` sidebar item is a click-handler with no observed effect (no navigation, no modal). Either tel: link suppressed by the dev browser or a dead handler. Worth a smoke test if anyone wires this up.

### Localization gaps observed

Raw keys / codes leaking through to the citizen UI on this build:
- `CS_LOGIN_REGISTER_WITH_EMAIL` (login page link below mobile field)
- `HELPLINE` (sidebar item — likely `CS_COMMON_HELPLINE_TITLE` unset)
- Subtype names in the create-complaint Type/Subtype dropdown (e.g. `LAND OWNERSHIP DISPUTE`)
- `NAIROBI_CENTRAL` (boundary code in detail-page Address row)

### Test-coverage opportunities revealed by validation

The biggest gaps that map to **easy** Playwright wins are:
1. **Wizard 6-step happy path** — file a complaint as a citizen end-to-end, assert the redirect to `/pgr/response`, assert the `NCCG-PGR-…` ID format, assert the back-to-home button. Today only `tests/lifecycle/pgr-ui.spec.ts` covers this and lives outside the citizen tree.
2. **Boundary-cascade gating regression** — already covered by `pin-and-cascade-fixes-2026-04-29.spec.ts`. Add an assertion that Sub-County dedup is the data-quality gap (so we notice when Bomet-vs-Nairobi seed sorts itself out).
3. **Subtype dropdown localization** — assert that ServiceDef subtype options aren't rendered as raw UPPER_SNAKE; today's coverage in `complaint-type-labels.spec.ts` only checks the type/menuPath, not the subtype.
4. **Profile field set** — assert the citizen profile renders **only** Name/Gender/Email + photo — guard against unintended exposure of password / notification toggles / mobile-edit if those get re-enabled without a full review.
5. **Aux page recovery** — when FAQ / How-It-Works are fixed, `/citizen/pgr-faq` should not render the "Something went wrong" fallback. A spec that asserts the absence of that string would flag both successful builds and the regression.
6. **Logout label tightening** — bump `tests/citizen/logout.spec.ts` to require "Yes, Logout" rather than just "Yes".
