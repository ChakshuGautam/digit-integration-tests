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
| `BASE_URL` | `https://naipepea.digit.org` | DIGIT UI base URL |
| `DIGIT_TENANT` | `ke.nairobi` | City-level tenant ID |
| `ROOT_TENANT` | Derived from `DIGIT_TENANT` | State/root tenant ID |
| `DIGIT_USERNAME` | `ADMIN` | Employee admin username |
| `DIGIT_PASSWORD` | `eGov@123` | Employee admin password |
| `CITIZEN_PHONE_PREFIX` | `7` | First digit(s) for valid mobile numbers |
| `FIXED_OTP` | `123456` | OTP value (for mock OTP deployments) |
| `SERVICE_CODE` | `IllegalConstruction` | PGR service code for complaint tests |
| `LOCALITY_CODE` | `NAIROBI_CITY_VIWANDANI` | Boundary locality code for address |

See `.env.example` for a complete template.

## Test Suites

### `citizen-login.spec.ts`
- Login page renders with mobile input
- Citizen can log in with OTP and reach home page

### `employee-login.spec.ts`
- Valid credentials return access token
- Bad credentials are rejected
- API session injection loads employee home

### `full-pgr-lifecycle.spec.ts`
Full complaint lifecycle (7 tests, serial):
1. Admin API token acquisition
2. Citizen login via UI (auto-register + OTP)
3. Citizen creates PGR complaint via UI wizard (6-step form)
4. Admin sees complaint in PGR inbox
5. Admin assigns complaint to employee
6. Employee resolves complaint
7. Citizen verifies RESOLVED status
