/**
 * True when a non-empty value has no letter or digit in it — e.g. "@@@" or "---".
 * Mirrors the backend's assertNotOnlySpecialChars: punctuation, spaces and symbols
 * are otherwise fine (branch names legitimately include things like "R&D Branch"),
 * this only catches a value with nothing identifying in it.
 */
export function isOnlySpecialChars(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== '' && !/[a-zA-Z0-9]/.test(trimmed);
}
