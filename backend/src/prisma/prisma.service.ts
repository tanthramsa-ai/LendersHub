import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { rlsContext } from '../rls/rls-context';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);
    super({ adapter } as any);
    this.pool = pool;

    // Capture the base client before the extension is applied so the inner
    // $transaction call uses a non-extended reference (avoids recursion).
    const base = this as PrismaClient;

    const extended = this.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            const ctx = rlsContext.getStore();

            // No RLS context in the async tree — let PostgreSQL's own policy
            // decide.  With FORCE ROW LEVEL SECURITY and no session vars set,
            // the DB returns zero rows for users/loans (fail-safe).
            if (!ctx) return query(args);

            // Bypass: super-admin context. Tables without RLS (tenants,
            // login_audit_logs) are safe to query directly. For RLS-protected
            // tables (users, loans) the service layer must use runWithBypass().
            // The previous $transaction([set_config, query(args)]) approach is
            // unreliable with PrismaPg: query(args) may execute on a different
            // pool connection than set_config, so the LOCAL setting is not seen.
            if (ctx.bypassRls) {
              return query(args);
            }

            // Tenant scope: set current_tenant_id for the duration of the query.
            if (ctx.tenantId) {
              const [, result] = await base.$transaction([
                base.$executeRaw`SELECT set_config('app.current_tenant_id', ${ctx.tenantId}, TRUE)`,
                query(args),
              ]);
              return result;
            }

            return query(args);
          },
        },
      },
    });

    // Replace Prisma's own model delegates with the extended versions so all
    // callers that inject PrismaService transparently get RLS enforcement.
    (this as any).user = extended.user;
    (this as any).tenant = extended.tenant;
    (this as any).loan = extended.loan;
    (this as any).loginAuditLog = extended.loginAuditLog;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
