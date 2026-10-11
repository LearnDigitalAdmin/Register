/**
 * Kenyan phone number validation & normalisation.
 * Accepts common data-entry variants (spaces, dashes, +254/254/0 prefixes)
 * and normalises to the 07XXXXXXXX / 01XXXXXXXX local format used elsewhere
 * in the app (see `parentPhone` usage in AppDashboard / messagingService).
 */

/** Strip everything except digits and a leading +. */
function cleanRaw(raw: string): string {
  return (raw || '').trim().replace(/[^\d+]/g, '');
}

/**
 * Returns the normalised local-format number (e.g. '0722123456') if valid,
 * or null if the input doesn't look like a Kenyan mobile/landline number.
 */
export function normalisePhone(raw: string): string | null {
  if (!raw) return null;
  let digits = cleanRaw(raw);
  if (!digits) return null;

  if (digits.startsWith('+254')) digits = '0' + digits.slice(4);
  else if (digits.startsWith('254')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('+')) digits = digits.slice(1); // unrecognised country code

  // Common valid local prefixes: 07xx, 01xx (mobile), 0xx (some landlines) — require 10 digits starting with 0.
  if (/^0[17]\d{8}$/.test(digits)) return digits;
  if (/^0[2-9]\d{7,8}$/.test(digits) && digits.length === 10) return digits; // landline fallback

  return null;
}

export function isValidPhone(raw: string): boolean {
  return normalisePhone(raw) !== null;
}

/** Formats a normalised number for display, e.g. '0722 123 456'. Falls back to raw input if invalid. */
export function formatPhoneDisplay(raw: string): string {
  const n = normalisePhone(raw);
  if (!n) return raw;
  return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
}

/**
 * Safaricom-specific validation, used ONLY for the school admin / teacher admin registration
 * phone number (needed for the daily register-reminder SMS). Parent phone numbers elsewhere in
 * the app stay on the broader `normalisePhone`/`isValidPhone` since parents may be on any network.
 * Accepts 0/254/+254 prefixes, then requires one of Safaricom's published prefixes.
 */
const SAFARICOM_PREFIXES = ['070', '071', '072', '074', '075', '076', '079', '011', '014'];

export function normaliseSafaricomPhone(raw: string): string | null {
  const n = normalisePhone(raw);
  if (!n || n.length !== 10) return null;
  const prefix = n.slice(0, 3);
  return SAFARICOM_PREFIXES.includes(prefix) ? n : null;
}

export function isSafaricomPhone(raw: string): boolean {
  return normaliseSafaricomPhone(raw) !== null;
}
