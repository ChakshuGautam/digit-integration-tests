# DIGIT Integration Tests

End-to-end Playwright tests for DIGIT — PGR lifecycle (citizen + employee
flows) and the configurator's manage surface (departments, designations,
complaints). Runs against any DIGIT deployment; configured via env vars.

## Quick Start

```bash
npm install
npx playwright install chromium

# Run everything against the default environment (Nairobi)
npm test

# Just the new manage-surface specs
npm run test:manage
npm run test:smoke

# Interactive runner
npm run test:ui

# Sanity-check that all specs parse without running them
npm run test:list

# Run against a different deployment
BASE_URL=https://bometfeedbackhub.digit.org \
DIGIT_TENANT=ke.bomet \
LOCALITY_CODE=BOMET_SOTIK \
npx playwright test
```

The first run executes the `setup` project (auth.setup.ts) which logs into
the configurator UI as `ADMIN/eGov@123` (override via `ADMIN_USER`,
`ADMIN_PASSWORD`, `TENANT_CODE`) and writes `auth.json`. All other
projects pick up `storageState: 'auth.json'`. `auth.json` is gitignored.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `https://naipepea.digit.org` | DIGIT deployment base URL |
| `DIGIT_TENANT` | `ke.nairobi` | City-level tenant ID |
| `ROOT_TENANT` | Derived from `DIGIT_TENANT` | State/root tenant ID (e.g. `ke`) |
| `DIGIT_USERNAME` | `ADMIN` | Employee admin username |
| `DIGIT_PASSWORD` | `eGov@123` | Employee admin password |
| `CITY_ADMIN_USER` | `EMP-KE_NAIROBI-000089` | City-level admin username (for UI tests) |
| `CITY_ADMIN_PASS` | `eGov@123` | City-level admin password |
| `CITIZEN_PHONE_PREFIX` | `7` | First digit(s) for valid mobile numbers |
| `FIXED_OTP` | `123456` | OTP value (for mock OTP deployments) |
| `SERVICE_CODE` | `IllegalConstruction` | PGR service code for complaint tests |
| `LOCALITY_CODE` | `NAIROBI_CITY_VIWANDANI` | Boundary locality code for address |
| `SCREENSHOT_DIR` | `/tmp/pgr-lifecycle-ui-screenshots` | Directory for UI test screenshots |

See `.env.example` for a complete template.

## Test Suites

### PGR Lifecycle — API only (`pgr-lifecycle-api.spec.ts`)

Pure API tests — no browser, runs in ~2 seconds. Tests the complete PGR complaint lifecycle:

1. Acquire admin + citizen tokens
2. Citizen creates complaint
3. Admin assigns complaint
4. Admin resolves complaint
5. Citizen verifies resolved status

```bash
npx playwright test tests/specs/pgr-lifecycle-api.spec.ts
```

### PGR Lifecycle — UI only (`pgr-lifecycle-ui.spec.ts`)

Full browser-based tests — every action done through the UI. Takes ~4 minutes:

1. Citizen logs in via OTP (UI)
2. Citizen creates complaint via wizard (UI — 6-step form)
3. Admin sees complaint in PGR inbox (UI)
4. Admin assigns complaint via Take Action modal (UI)
5. Admin resolves complaint via Take Action modal (UI)
6. Citizen sees resolved complaint on complaints page (UI)

```bash
npx playwright test tests/specs/pgr-lifecycle-ui.spec.ts
```

### Authentication (`citizen-login.spec.ts`, `employee-login.spec.ts`)

- Citizen OTP login flow (auto-register + fixed OTP)
- Employee login: valid credentials return access token, bad credentials rejected
- API session injection loads employee home

### Verification (`verify-complaint-details.spec.ts`, `verify-ct-labels.spec.ts`, `verify-logout.spec.ts`)

- Complaint details page loads and shows expected data
- Complaint type labels display correctly
- Logout flow works end-to-end

### Configurator (`configurator/*.spec.ts`)

Dashboard configurator tests for PGR charting pages.

### Configurator manage surface (`specs/manage/*.spec.ts`, `specs/smoke/*.spec.ts`)

E2E coverage of `/configurator/manage/{departments,designations,complaints}`
plus a smoke file that catches recently-cleaned hardcoding (no `'pg'`
literals leaking into payloads, login placeholder shows `ke`, etc.).

Every test that creates data uses a `PW_${hash}_${kind}` prefix and an
`afterAll` that soft-deletes via the helpers (`mdms _update isActive=false`
for masters, PGR `REJECT` workflow action for complaints). Tests pull
live data dynamically — no hardcoded `ContractDispute` / `DEPT_14` /
`PGR_LME assignee uuid`; if the tenant lacks an HRMS employee with the
needed role, the relevant test calls `test.skip()` with a clear reason.

## Project Structure

```
auth.setup.ts                         # UI login → auth.json (storageState)
helpers/
├── api.ts                            # Reads auth.json, exposes mdms/pgr/hrms
├── codes.ts                          # PW_${hash}_${kind} per-test codes
└── teardown.ts                       # cleanupMdms / cleanupPgrComplaints
specs/
├── smoke/hardcoding.spec.ts          # 4 hardcoding regression checks
└── manage/
    ├── departments.spec.ts           # 5 tests
    ├── designations.spec.ts          # 6 tests
    └── complaints.spec.ts            # 9 tests
tests/
├── specs/
│   ├── pgr-lifecycle-api.spec.ts     # Pure API lifecycle (5 tests)
│   ├── pgr-lifecycle-ui.spec.ts      # Pure UI lifecycle (6 tests)
│   ├── citizen-login.spec.ts         # Citizen OTP login
│   ├── employee-login.spec.ts        # Employee auth
│   ├── verify-complaint-details.spec.ts
│   ├── verify-ct-labels.spec.ts
│   ├── verify-logout.spec.ts
│   └── configurator/                 # Dashboard config tests
└── utils/
    ├── auth.ts                       # Token acquisition + API session injection
    ├── citizen-login.ts              # Citizen OTP login helper
    └── env.ts                        # Environment config (all env vars)
```

## CI

`.github/workflows/e2e.yml` is `workflow_dispatch`-only for now — the
manage-surface specs are still being stabilized and we don't want every
PR to wake the suite against the live tenant. Trigger manually from the
Actions tab once secrets `TEST_BASE_URL` and `ADMIN_PASSWORD` are set.

## Prerequisites

- Node.js 18+
- A running DIGIT deployment with:
  - PGR services (`pgr-services`)
  - User service (`egov-user`)
  - Workflow service (`egov-workflow-v2`)
  - Mock OTP (Kong `request-termination` plugin) for citizen login
  - City-level admin employee for UI tests (e.g. `EMP-KE_NAIROBI-000089`)

## Notes

- **API tests** are fast (~2s) and use `fetch()` directly — no browser needed
- **UI tests** use Playwright headless Chromium, take screenshots at each step
- The city-level admin (`CITY_ADMIN_USER`) is needed because DIGIT's `getCurrentTenantId()` returns the employee's login tenant — UI workflow actions require this to match the complaint's city tenant
- Citizen registration uses mock OTP (`FIXED_OTP=123456`) — the Kong gateway returns 200 for `/user-otp` and `/otp` endpoints
