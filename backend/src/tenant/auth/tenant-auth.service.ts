import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantLoginDto } from './dto/tenant-login.dto';

@Injectable()
export class TenantAuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(dto: TenantLoginDto) {
    // 1. Resolve tenant from public schema
    const tenant = await this.prisma.tenant.findUnique({
      where: { subdomain: dto.subdomain },
      select: { id: true, companyName: true, subdomain: true, schemaName: true, status: true },
    });

    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status !== 'ACTIVE') throw new UnauthorizedException('Tenant account is not active');

    // 2. Look up user in the tenant's private schema
    const client = await this.prisma.pool.connect();
    let user: { id: string; email: string; password: string; first_name: string; last_name: string; role: string; is_active: boolean } | null = null;

    try {
      const schemaName = tenant.schemaName;
      await client.query(`SET search_path = "${schemaName}", public`);
      const res = await client.query<{ id: string; email: string; password: string; first_name: string; last_name: string; role: string; is_active: boolean }>(
        `SELECT id, email, password, first_name, last_name, role, is_active FROM users WHERE email = $1 LIMIT 1`,
        [dto.email],
      );
      user = res.rows[0] ?? null;
    } finally {
      client.release();
    }

    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.is_active) throw new UnauthorizedException('User account is deactivated');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const payload = {
      sub: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      tenantId: tenant.id,
      subdomain: tenant.subdomain,
      schemaName: tenant.schemaName,
      type: 'tenant_user' as const,
    };

    return {
      accessToken: this.jwt.sign(payload, { expiresIn: '8h' }),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
      },
      tenant: {
        id: tenant.id,
        companyName: tenant.companyName,
        subdomain: tenant.subdomain,
      },
    };
  }
}
