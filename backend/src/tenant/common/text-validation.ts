import { BadRequestException } from '@nestjs/common';

/**
 * Rejects a value that is empty of any letter or digit — e.g. "@@@" or "---".
 * Punctuation, spaces and symbols are otherwise allowed (branch names legitimately
 * include things like "R&D Branch" or "Anna Nagar - Phase 2"), so this only catches
 * the case a plain "required" check misses: a non-empty string with nothing
 * identifying in it.
 */
export function assertNotOnlySpecialChars(value: string | undefined | null, fieldLabel: string): void {
  const trimmed = value?.trim();
  if (trimmed && !/[a-zA-Z0-9]/.test(trimmed)) {
    throw new BadRequestException(`${fieldLabel} cannot consist of only special characters`);
  }
}
