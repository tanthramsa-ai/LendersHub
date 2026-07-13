import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

export interface SuperAdminJwtPayload {
  sub: string;
  email: string;
  role: string;
  type: string;
}

@Injectable()
export class SuperAdminJwtStrategy extends PassportStrategy(Strategy, 'super-admin-jwt') {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  async validate(payload: SuperAdminJwtPayload) {
    if (payload.type !== 'super_admin' || payload.role !== 'SUPER_ADMIN') {
      throw new UnauthorizedException();
    }

    // Use a dedicated connection with app.bypass_rls so FORCE RLS on public.users
    // does not hide the SUPER_ADMIN row (tenant_id is NULL).
    const client = await this.prisma.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.bypass_rls', 'true', TRUE)");
      const res = await client.query<{
        id: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        role: string;
        totp_enabled: boolean;
        tenant_id: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, email, first_name, last_name, role, totp_enabled, tenant_id, created_at, updated_at
         FROM users WHERE id = $1`,
        [payload.sub],
      );
      await client.query('COMMIT');

      const user = res.rows[0];
      if (!user || user.role !== 'SUPER_ADMIN') throw new UnauthorizedException();

      return {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        totpEnabled: user.totp_enabled,
        tenantId: user.tenant_id,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
