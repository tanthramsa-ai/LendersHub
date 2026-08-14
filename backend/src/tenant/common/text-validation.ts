import { BadRequestException } from '@nestjs/common';

/**
 * Rejects a value that is empty of any letter or digit — e.g. "@@@" or "---".
 * Punctuation, spaces and symbols are otherwise allowed, so this only catches
 * the case a plain "required" check misses: a non-empty string with nothing
 * identifying in it.
 *
 * NOTE: this is deliberately weak and is NOT sufficient on its own. "Q#QWRE"
 * and "@#$@#$2123" both pass it, because each contains one letter or digit.
 * Prefer the allowlist validators below, which state what a field may contain
 * rather than the single thing it may not be.
 */
export function assertNotOnlySpecialChars(value: string | undefined | null, fieldLabel: string): void {
  const trimmed = value?.trim();
  if (trimmed && !/[a-zA-Z0-9]/.test(trimmed)) {
    throw new BadRequestException(`${fieldLabel} cannot consist of only special characters`);
  }
}

// ── Allowlists ───────────────────────────────────────────────────────────────
// Each says what the field MAY contain. Mirrored verbatim in
// frontend/src/lib/text-validation.ts so the submit button's enabled state and
// the inline errors never disagree with what the API actually accepts.

/** Place/business name: letters, digits, spaces, & - . , ' ( ) / — e.g. "R&D Branch", "Anna Nagar - Phase 2". */
export const PLACE_NAME_RE = /^[a-zA-Z0-9\s\-.,'&()/]+$/;

/** Identifier code: alphanumeric plus - and _ — e.g. "BLR-01", "HQ_MAIN". */
export const CODE_RE = /^[a-zA-Z0-9\-_]+$/;

/** Person name: letters, spaces, - . ' only — no digits — e.g. "Dr. K. Raman", "O'Brien-Smith". */
export const PERSON_NAME_RE = /^[a-zA-Z\s\-.']+$/;

/** Street address: place-name set plus # for door numbers — e.g. "#4, 12/3 MG Road". */
export const ADDRESS_RE = /^[a-zA-Z0-9\s\-.,'&()/#]+$/;

/**
 * Enforces an allowlist and requires the value to carry real content, not just
 * punctuation. `requireLetter` distinguishes a field that must be readable text
 * (a name) from one where digits alone are legitimate (a door-number address).
 */
export function assertAllowedChars(
  value: string | undefined | null,
  fieldLabel: string,
  allowed: RegExp,
  describeAllowed: string,
  requireLetter = true,
): void {
  const trimmed = value?.trim();
  if (!trimmed) return;

  if (!allowed.test(trimmed)) {
    throw new BadRequestException(`${fieldLabel} can only contain ${describeAllowed}`);
  }
  if (requireLetter && !/[a-zA-Z]/.test(trimmed)) {
    throw new BadRequestException(`${fieldLabel} must contain at least one letter`);
  }
  if (!requireLetter && !/[a-zA-Z0-9]/.test(trimmed)) {
    throw new BadRequestException(`${fieldLabel} must contain at least one letter or number`);
  }
}
