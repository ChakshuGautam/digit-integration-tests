# DIGIT Integration Tests

End-to-end Playwright tests for DIGIT PGR platform. Runs against any DIGIT deployment — configure via environment variables.

## Quick Start

```bash
npm install
npx playwright install chromium

# Run all tests against default environment (Nairobi)
npx playwright test

# Run against a different deployment
BASE_URL=https://bometfeedbackhub.digit.org \
DIGIT_TENANT=ke.bomet \
LOCALITY_CODE=BOMET_SOTIK \
npx playwright test
```

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

## Project Structure

```
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
