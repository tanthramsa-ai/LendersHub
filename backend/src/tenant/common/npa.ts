/**
 * NPA (non-performing asset) classification.
 *
 * A loan is NPA when either:
 *  - an admin has manually flagged it (loans.npa_marked_at), or
 *  - its overdue installment count has reached the tenant's threshold.
 *
 * The threshold lives in the tenant `settings` table under `npa_overdue_threshold`
 * and falls back to this default when unset.
 */
export const NPA_DEFAULT_THRESHOLD = 4;

export const NPA_THRESHOLD_SETTING_KEY = 'npa_overdue_threshold';

/** Reads the configured threshold from a raw settings value, falling back to the default. */
export function parseNpaThreshold(raw: string | undefined | null): number {
  const parsed = parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 1
    ? parsed
    : NPA_DEFAULT_THRESHOLD;
}
