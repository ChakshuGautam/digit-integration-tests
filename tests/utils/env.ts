/**
 * Environment configuration — all env vars with defaults.
 *
 * Every test reads from here, not from process.env directly.
 * This ensures consistent defaults and documents what's configurable.
 */

export const BASE_URL = process.env.BASE_URL || 'https://naipepea.digit.org';
export const TENANT = process.env.DIGIT_TENANT || 'ke.nairobi';
export const ROOT_TENANT = process.env.ROOT_TENANT || (TENANT.includes('.') ? TENANT.split('.')[0] : TENANT);
export const ADMIN_USER = process.env.DIGIT_USERNAME || 'ADMIN';
export const ADMIN_PASS = process.env.DIGIT_PASSWORD || 'eGov@123';
export const FIXED_OTP = process.env.FIXED_OTP || '123456';
export const CITIZEN_PHONE_PREFIX = process.env.CITIZEN_PHONE_PREFIX || '7';
export const SERVICE_CODE = process.env.SERVICE_CODE || 'IllegalConstruction';
export const LOCALITY_CODE = process.env.LOCALITY_CODE || 'NAIROBI_CITY_VIWANDANI';
export const DEFAULT_PASSWORD = 'eGov@123';

// ── Keycloak SSO config ────────────────────────────────────────────────────
// Read by tests/keycloak/*.spec.ts. Each spec self-skips when the realm's
// OIDC discovery endpoint isn't reachable (deployments without KC enabled).
export const KC_REALM = process.env.KC_REALM || ROOT_TENANT;
export const KC_CLIENT_ID = process.env.KC_CLIENT_ID || 'digit-ui';
export const KC_BASE = process.env.KC_BASE || `${BASE_URL}/auth`;
export const TOKEN_EXCHANGE_BASE = process.env.TOKEN_EXCHANGE_BASE || `${BASE_URL}/token-exchange`;
export const CITIZEN_BASENAME = process.env.CITIZEN_BASENAME || '/citizen';

// ── Platform-admin (KC master realm) config ─────────────────────────────────
// Used by tests/keycloak/kc-platform-admin.spec.ts. The spec self-skips when
// KC_MASTER_ADMIN_PASSWORD isn't provided — the master admin password is
// sensitive and lives in OpenBao on the production servers, so CI runs that
// don't have it (or runs against deployments without the platform-admin
// overlay routes) simply skip the spec rather than fail.
export const KC_MASTER_REALM = process.env.KC_MASTER_REALM || 'master';
export const KC_MASTER_ADMIN_USER = process.env.KC_MASTER_ADMIN_USER || 'admin';
export const KC_MASTER_ADMIN_PASS = process.env.KC_MASTER_ADMIN_PASSWORD || '';
export const PLATFORM_ADMIN_BASE =
  process.env.PLATFORM_ADMIN_BASE || `${TOKEN_EXCHANGE_BASE}/platform-admin`;

// Public path to egov-enc-service via Kong. The /crypto/v1/_generatekey
// endpoint (Digit-Core #1354) is exercised by the platform-admin spec to
// validate the new-state-root provisioning chain end-to-end.
export const ENC_SERVICE_BASE =
  process.env.ENC_SERVICE_BASE || `${BASE_URL}/egov-enc-service`;

/**
 * Decode a JWT payload without verifying its signature — for assertion only.
 * Tests should also re-verify any claim that load-bears on a behavior (the
 * overlay re-validates signatures on every API call, so trusting the
 * payload for shape assertions is fine).
 */
export function decodeJwtPayload(jwt: string): Record<string, any> {
  const part = jwt.split('.')[1];
  if (!part) return {};
  const pad = part.length % 4 === 2 ? '==' : part.length % 4 === 3 ? '=' : '';
  const b64 = (part + pad).replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

/** Generate a unique citizen phone number valid for the deployment's mobile validation */
export function generateCitizenPhone(): string {
  // Prefix + remaining digits from timestamp to ensure uniqueness
  const remaining = 9 - CITIZEN_PHONE_PREFIX.length;
  return CITIZEN_PHONE_PREFIX + Date.now().toString().slice(-remaining);
}

/** Generate a unique employee phone number */
export function generateEmployeePhone(): string {
  const remaining = 9 - CITIZEN_PHONE_PREFIX.length;
  return CITIZEN_PHONE_PREFIX + (Date.now() + 1).toString().slice(-remaining);
}
