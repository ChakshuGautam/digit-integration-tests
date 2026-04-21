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
