/**
 * True when a non-empty value has no letter or digit in it — e.g. "@@@" or "---".
 *
 * NOTE: deliberately weak and NOT sufficient on its own — "Q#QWRE" and
 * "@#$@#$2123" both pass, because each contains one letter or digit. Prefer the
 * allowlist checks below, which state what a field may contain rather than the
 * single thing it may not be.
 */
export function isOnlySpecialChars(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== '' && !/[a-zA-Z0-9]/.test(trimmed);
}

// ── Allowlists ───────────────────────────────────────────────────────────────
// Mirrors backend/src/tenant/common/text-validation.ts verbatim, so the submit
// button's enabled state and the inline errors never disagree with what the API
// actually accepts.

/** Place/business name: letters, digits, spaces, & - . , ' ( ) / — e.g. "R&D Branch". */
export const PLACE_NAME_RE = /^[a-zA-Z0-9\s\-.,'&()/]+$/;

/** Identifier code: alphanumeric plus - and _ — e.g. "BLR-01". */
export const CODE_RE = /^[a-zA-Z0-9\-_]+$/;

/**
 * Person name: letters, spaces and periods — periods allowed so initials work
 * ("Dr. K. Raman"). Digits, hyphens and apostrophes are rejected by product
 * decision.
 */
export const PERSON_NAME_RE = /^[a-zA-Z\s.]+$/;

/** Town/city name: letters, spaces, - . ' — e.g. "Thiruvananthapuram - East". */
export const CITY_RE = /^[a-zA-Z\s\-.']+$/;

/** Street address: place-name set plus # for door numbers — e.g. "#4, 12/3 MG Road". */
export const ADDRESS_RE = /^[a-zA-Z0-9\s\-.,'&()/#]+$/;

export const PLACE_NAME_CHARS = "letters, numbers, spaces and & - . , ' ( ) /";
export const CODE_CHARS = 'letters, numbers, hyphens and underscores';
/**
 * Email. Mirrors the backend: real domain labels and a letters-only TLD of at
 * least two characters, so "user@gmail.com!" and "a@b..com" are rejected.
 */
export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export const PERSON_NAME_CHARS = 'letters, spaces and periods';
export const CITY_CHARS = "letters, spaces and - . '";
export const ADDRESS_CHARS = "letters, numbers, spaces and # & - . , ' ( ) /";

/**
 * Returns an error message for a value that breaks the allowlist or carries no
 * real content, or null when it's fine. `requireLetter` distinguishes a field
 * that must be readable text (a name) from one where digits alone are
 * legitimate (a door-number address).
 */
export function allowedCharsError(
  value: string,
  fieldLabel: string,
  allowed: RegExp,
  describeAllowed: string,
  requireLetter = true,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!allowed.test(trimmed)) return `${fieldLabel} can only contain ${describeAllowed}`;
  if (requireLetter && !/[a-zA-Z]/.test(trimmed)) return `${fieldLabel} must contain at least one letter`;
  if (!requireLetter && !/[a-zA-Z0-9]/.test(trimmed)) return `${fieldLabel} must contain at least one letter or number`;
  return null;
}
