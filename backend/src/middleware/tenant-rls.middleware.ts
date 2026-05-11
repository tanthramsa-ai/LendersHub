import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { decode } from 'jsonwebtoken';
import { rlsContext } from '../rls/rls-context';

@Injectable()
export class TenantRlsMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    // Super-admin routes always bypass RLS.  Authentication is enforced by the
    // JWT/Temp guards; RLS acts as an additional defence-in-depth layer for
    // tenant-scoped data, not as the primary access control for super-admin ops.
    if (req.path.startsWith('/api/v1/super-admin/')) {
      rlsContext.run({ bypassRls: true }, next);
      return;
    }

    // For tenant-user routes (future US): scope queries to the caller's tenant.
    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;

    if (token) {
      try {
        const payload = decode(token) as Record<string, unknown> | null;
        if (payload?.tenantId && typeof payload.tenantId === 'string') {
          rlsContext.run({ tenantId: payload.tenantId }, next);
          return;
        }
      } catch {
        // Malformed token — guards will produce the 401.
      }
    }

    // No recognised context: PostgreSQL RLS blocks all tenant-scoped rows by
    // default (fail-safe).  Platform tables (tenants, login_audit_logs) have
    // no RLS and remain accessible.
    next();
  }
}
