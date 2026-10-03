// Mirrors assertStrongPassword in backend/src/common/utils/password.ts, so a form can say
// what is wrong before the request is sent. The server is the authority.

export const PASSWORD_HINT = 'At least 8 characters, with a letter and a number';

/** Why `value` can't be used as a new password, or null if it can. */
export function passwordProblem(value: string): string | null {
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (new TextEncoder().encode(value).length > 72) return 'Password must be at most 72 characters';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Password must contain at least one letter and one number';
  return null;
}
