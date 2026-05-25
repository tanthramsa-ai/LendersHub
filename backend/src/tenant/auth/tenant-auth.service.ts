import { Injectable, UnauthorizedException, NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantLoginDto } from './dto/tenant-login.dto';

type UserRow = {
  id: string;
  email: string;
  phone: string | null;
  password: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
};

@Injectable()
export class TenantAuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(dto: TenantLoginDto) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Provide email or phone number');
    }

    // 1. Resolve tenant
    const tenant = await this.prisma.tenant.findUnique({
      where: { subdomain: dto.subdomain },
      select: { id: true, companyName: true, subdomain: true, schemaName: true, status: true },
    });
    if (!tenant) throw new NotFoundException('Organisation not found');
    if (tenant.status !== 'ACTIVE') throw new UnauthorizedException('Organisation account is not active');

    // 2. Look up user in tenant schema by email OR phone
    const client = await this.prisma.pool.connect();
    let user: UserRow | null = null;

    try {
      await client.query(`SET search_path = "${tenant.schemaName}", public`);

      let res;
      if (dto.email) {
        res = await client.query<UserRow>(
          `SELECT id, email, phone, password, first_name, last_name, role, is_active
           FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
          [dto.email.trim()],
        );
      } else {
        // Normalise phone: strip spaces/dashes, ensure starts with digits
        const phone = (dto.phone ?? '').replace(/[\s\-]/g, '');
        res = await client.query<UserRow>(
          `SELECT id, email, phone, password, first_name, last_name, role, is_active
           FROM users WHERE phone = $1 OR phone = $2 LIMIT 1`,
          [phone, phone.startsWith('+91') ? phone.slice(3) : `+91${phone}`],
        );
      }
      user = res.rows[0] ?? null;
    } finally {
      client.release();
    }

    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.is_active) throw new UnauthorizedException('Your account has been deactivated');

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
      expiresIn: 8 * 60 * 60, // seconds
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
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

  async validateToken(token: string) {
    try {
      return this.jwt.verify(token) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
