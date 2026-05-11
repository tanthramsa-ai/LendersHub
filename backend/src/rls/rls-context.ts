import { AsyncLocalStorage } from 'node:async_hooks';

export interface RlsContext {
  /** UUID of the active tenant — set for regular tenant-user requests. */
  tenantId?: string;
  /** When true, all RLS policies are bypassed — set for super-admin requests. */
  bypassRls?: boolean;
}

/**
 * Module-level singleton. The middleware calls `.run()` on each request so
 * that every downstream Prisma query can read the correct isolation context
 * via `.getStore()` without needing explicit parameter passing.
 */
export const rlsContext = new AsyncLocalStorage<RlsContext>();
