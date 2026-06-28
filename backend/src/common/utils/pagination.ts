/** Clamps page/limit to safe values so raw Postgres offset errors never reach the client. */
export function safePagination(page: unknown, limit: unknown, maxLimit = 200) {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const l = Math.min(Math.max(1, Math.floor(Number(limit) || 20)), maxLimit);
  return { page: p, limit: l };
}
