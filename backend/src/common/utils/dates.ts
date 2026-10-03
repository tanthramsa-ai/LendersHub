/**
 * True only for a real calendar date written YYYY-MM-DD.
 *
 * A bare `/^\d{4}-\d{2}-\d{2}$/` accepts "2026-02-31" and "2026-13-45"; those then reach
 * `new Date(...)`, which yields Invalid Date, and the first `toISOString()` throws a
 * RangeError that surfaced as a generic 500 instead of a 400.
 */
export function isValidYmd(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
