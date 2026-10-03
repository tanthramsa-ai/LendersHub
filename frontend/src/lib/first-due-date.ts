/**
 * Earliest first due date the server accepts for a new loan: yesterday (UTC). Mirrors
 * assertFirstDueDateNotPast in the backend, whose one day of grace covers the gap between
 * the server's UTC date and an Indian user's local date. Used as the date picker's `min`
 * so a past date can't be picked in the first place.
 */
export function earliestFirstDueDate(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
