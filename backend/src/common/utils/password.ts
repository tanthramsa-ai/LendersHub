import { BadRequestException } from '@nestjs/common';

export const MIN_PASSWORD_LENGTH = 8;
/** bcrypt only hashes the first 72 bytes; longer passwords would silently be truncated. */
export const MAX_PASSWORD_LENGTH = 72;

/**
 * Rules for choosing a password (creating a user, resetting one). Deliberately modest:
 * long enough, not absurdly long, and not all letters or all digits. Login does NOT use
 * this, so users who set a shorter password under the old 6-character rule can still sign in.
 */
export function assertStrongPassword(value: unknown, label = 'Password'): asserts value is string {
  if (typeof value !== 'string' || !value) throw new BadRequestException(`${label} is required`);
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new BadRequestException(`${label} must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_LENGTH) {
    throw new BadRequestException(`${label} must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    throw new BadRequestException(`${label} must contain at least one letter and one number`);
  }
}
