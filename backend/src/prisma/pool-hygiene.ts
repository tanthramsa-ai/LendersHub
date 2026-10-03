/**
 * The minimum of pg.Pool / pg.PoolClient this needs, so it can be unit-tested without a database.
 */
export interface PoolLike {
  on(event: 'acquire', listener: (client: { query(sql: string): Promise<unknown> }) => void): unknown;
}

/**
 * Stops one request's `SET search_path = "tenant_x", public` from leaking into the next.
 *
 * Tenant services point a pooled connection at their schema and hand it back without undoing
 * it, so whoever is handed that connection next inherits a tenant's search_path. Anything that
 * names a platform table unqualified (`users`, `tenants`) then silently reads a tenant table
 * instead: the super-admin guard failed with a 500 for exactly this reason, and
 * `SELECT COUNT(*) FROM users` during tenant creation could count the wrong table.
 *
 * pg-pool emits 'acquire' just before it hands the connection over, and a pg client runs its
 * queries in the order they were issued, so a RESET queued here always runs before the
 * caller's first query, with no await and no change to any caller. Code that needs a tenant
 * schema already issues its own SET search_path after connecting, so nothing relies on the
 * old value surviving.
 */
export function resetSearchPathOnAcquire(pool: PoolLike): void {
  pool.on('acquire', (client) => {
    // A failure here is the connection's own (broken socket); the caller's query will report it.
    client.query('RESET search_path').catch(() => undefined);
  });
}
