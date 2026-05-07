# CLAUDE.md

Guidance for Claude Code (and any human author) writing specs in this repo.

## Test authoring philosophy

This suite exists to catch regressions a real user would notice. Every new
spec follows these rules.

### 1. Drive the UI like a real user

- The test logs in through the configurator/citizen/employee login form. No
  token injection, no localStorage fixtures, no `getDigitToken()` shortcuts
  for the system-under-test.
- Every state change goes through the same buttons, inputs, file pickers,
  modals, and toasts a user would touch. No `fetch()` or service calls in
  the body of a test.
- Assertions read the rendered DOM. "The list shows my new row" beats "the
  POST returned 200 and the GET returned the row".
- Selectors prefer semantics: `getByRole`, `getByLabel`, `getByText`. Reach
  for `data-testid` only when the DOM is genuinely ambiguous, and only after
  attempting a semantic locator first.

### 2. No smoke specs

A spec that only checks "the page loads without throwing" is not allowed.
Every test drives a meaningful end-to-end flow and asserts a tangible
outcome — a created entity is visible in a list, an edit round-trips
through reload, a toast contains the user-facing success message, a status
column flips from `Active` to `Inactive`.

If the only thing you can think to assert is "the URL didn't 500", you
haven't found the test yet — keep going.

### 3. Live deployment, no mocks

All specs run against a real DIGIT deployment (default: Nairobi —
`https://naipepea.digit.org`, tenant `ke.nairobi`). No request mocking,
no service stubs, no in-memory fakes. If the backend is broken, the test
fails — that's a feature, not a bug.

The deployment under test must satisfy the preflight checks (see
`tests/fixtures/preflight.setup.ts` once it lands). Tests must not silently
skip when prerequisites are missing on the live environment; preflight
fails the run loudly instead.

### 4. Teardown is mandatory

Every spec that creates persistent state cleans up after itself.

- **Default**: tear down through the UI — open the row's deactivate button,
  confirm the modal, assert the row leaves the active list.
- **Carve-out**: API teardown is permitted only when no UI affordance
  exists (e.g. tenants in the configurator have no delete UI). When using
  API teardown, add a code comment in the form
  `// NOTE: API teardown — no UI delete affordance for <entity>. Track in #<issue>.`
- Use a unique, scoped prefix on every created entity so teardown can
  target it: `PW_${spec-hash}_${kind}` (see `tests/utils/manage/codes.ts`).
- Teardown runs in `test.afterAll` and must succeed even if the test body
  threw.

### 5. One ticket per spec

A spec body either drives a regression for a specific CCRS issue (link the
issue number in the describe-block title) or covers a coherent slice of a
manage page or onboarding phase. Mixing several unrelated assertions into
one giant spec is rejected — split them.

## Repo layout (where new tests go)

```
tests/
├── fixtures/                    auth.setup.ts + preflight.setup.ts
├── onboarding/                  Phase 1–4 wizard UI tests (one file per phase)
├── citizen/                     citizen persona UI flows
├── employee/                    employee persona UI flows
├── admin/                       legacy manage-surface specs (allowed to use
│                                API helpers; new specs do NOT)
├── lifecycle/                   cross-persona end-to-end UI flows
└── utils/                       shared helpers (selectors, fixtures, NOT API
                                 shortcuts for new specs)
```

New specs land in `tests/onboarding/`, `tests/citizen/`, `tests/employee/`,
or — for the manage surface — a per-page file under `tests/admin/` named
`<page>-ui.spec.ts` so it's clearly separate from the legacy API-driven
specs.

## Running

```bash
# Default: Nairobi
npm test

# A different deployment
BASE_URL=https://bometfeedbackhub.digit.org \
DIGIT_TENANT=ke.bomet \
LOCALITY_CODE=BOMET_SOTIK \
npx playwright test

# A single phase
npx playwright test tests/onboarding/phase1.spec.ts
```

## When in doubt

If a piece of test logic feels easier as an API call, ask whether it's
*setup/teardown* (carve-out applies, with a comment) or *the thing under
test* (no carve-out — find the UI path or file an issue for the missing
UI). The default answer is "find the UI path".
