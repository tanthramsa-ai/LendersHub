/**
 * Clamps a numeric text field to whole numbers in [1, max] as the user types.
 *
 * `<input type="number">` ignores `maxLength`, and its `max` attribute only affects
 * the spinner and :invalid styling — neither stops someone from typing e.g. "999"
 * into a field whose real range is 1-99. This makes the field itself refuse to hold
 * an out-of-range value, rather than relying on a submit-time error to catch it.
 *
 * Returns '' while the field is empty so the user can clear and retype.
 */
export function clampTenureInput(raw: string, max: number): string {
  const digits = raw.replace(/\D/g, '');
  if (digits === '') return '';
  const n = parseInt(digits, 10);
  return String(Math.min(n, max));
}
