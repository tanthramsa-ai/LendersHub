import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsService } from '../../sms/sms.service';
import { TenantLoginDto } from './dto/tenant-login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

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

function randomOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

@Injectable()
export class TenantAuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private sms: SmsService,
  ) {}

  // ── Step 1: validate credentials, send OTP ──────────────────────────────────

  async login(dto: TenantLoginDto) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Provide email or phone number');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { subdomain: dto.subdomain },
      select: { id: true, companyName: true, subdomain: true, schemaName: true, status: true },
    });
    if (!tenant) throw new NotFoundException('Organisation not found');
    if (tenant.status !== 'ACTIVE') throw new UnauthorizedException('Organisation account is not active');

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
        const phone = (dto.phone ?? '').replace(/[\s\-]/g, '');
        res = await client.query<UserRow>(
          `SELECT id, email, phone, password, first_name, last_name, role, is_active
           FROM users WHERE (phone = $1 OR phone = $2) LIMIT 1`,
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

    // Send OTP if user has a phone number
    if (user.phone) {
      await this.issueOtp(user.id, user.phone, 'LOGIN', tenant.schemaName!);

      // Issue a short-lived temp token (5 min) used only to verify the OTP
      const tempToken = this.jwt.sign(
        {
          sub: user.id,
          type: 'otp_pending' as const,
          tenantId: tenant.id,
          subdomain: tenant.subdomain,
          schemaName: tenant.schemaName,
        },
        { expiresIn: '5m' },
      );

      return {
        requiresOtp: true,
        tempToken,
        maskedPhone: this.maskPhone(user.phone),
        tenant: { id: tenant.id, companyName: tenant.companyName, subdomain: tenant.subdomain },
      };
    }

    // No phone — issue JWT directly (fallback for email-only users)
    return this.buildTokenResponse(user, tenant);
  }

  // ── Step 2: verify OTP, issue full JWT ──────────────────────────────────────

  async verifyLoginOtp(dto: VerifyOtpDto) {
    let payload: { sub: string; type: string; tenantId: string; subdomain: string; schemaName: string };
    try {
      payload = this.jwt.verify(dto.tempToken) as typeof payload;
    } catch {
      throw new UnauthorizedException('Session expired, please login again');
    }
    if (payload.type !== 'otp_pending') throw new UnauthorizedException('Invalid token');

    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${payload.schemaName}", public`);

      const valid = await this.consumeOtp(client, payload.sub, dto.otp, 'LOGIN');
      if (!valid) throw new UnauthorizedException('Invalid or expired OTP');

      const userRes = await client.query<UserRow>(
        `SELECT id, email, phone, first_name, last_name, role, is_active, password
         FROM users WHERE id = $1 LIMIT 1`,
        [payload.sub],
      );
      const user = userRes.rows[0];
      if (!user || !user.is_active) throw new UnauthorizedException('Account not available');

      const tenant = await this.prisma.tenant.findUnique({
        where: { id: payload.tenantId },
        select: { id: true, companyName: true, subdomain: true, schemaName: true },
      });

      return this.buildTokenResponse(user, tenant!);
    } finally {
      client.release();
    }
  }

  // ── Forgot password: send OTP ────────────────────────────────────────────────

  async forgotPassword(dto: ForgotPasswordDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { subdomain: dto.subdomain },
      select: { schemaName: true, status: true },
    });
    if (!tenant || tenant.status !== 'ACTIVE') throw new NotFoundException('Organisation not found');

    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${tenant.schemaName}", public`);
      const phone = dto.phone.replace(/[\s\-]/g, '');
      const res = await client.query<{ id: string; phone: string }>(
        `SELECT id, phone FROM users
         WHERE (phone = $1 OR phone = $2) AND is_active = TRUE LIMIT 1`,
        [phone, phone.startsWith('+91') ? phone.slice(3) : `+91${phone}`],
      );
      const user = res.rows[0];
      if (!user) {
        // Don't leak whether phone exists — return success anyway
        return { message: 'If this number is registered, an OTP has been sent' };
      }

      await this.issueOtp(user.id, user.phone!, 'RESET_PASSWORD', tenant.schemaName!);
    } finally {
      client.release();
    }

    return { message: 'If this number is registered, an OTP has been sent' };
  }

  // ── Reset password: verify OTP, update password ──────────────────────────────

  async resetPassword(dto: ResetPasswordDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { subdomain: dto.subdomain },
      select: { schemaName: true, status: true },
    });
    if (!tenant || tenant.status !== 'ACTIVE') throw new NotFoundException('Organisation not found');

    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${tenant.schemaName}", public`);
      const phone = dto.phone.replace(/[\s\-]/g, '');

      const userRes = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE (phone = $1 OR phone = $2) AND is_active = TRUE LIMIT 1`,
        [phone, phone.startsWith('+91') ? phone.slice(3) : `+91${phone}`],
      );
      const user = userRes.rows[0];
      if (!user) throw new UnauthorizedException('Invalid request');

      const valid = await this.consumeOtp(client, user.id, dto.otp, 'RESET_PASSWORD');
      if (!valid) throw new UnauthorizedException('Invalid or expired OTP');

      const hashed = await bcrypt.hash(dto.newPassword, 12);
      await client.query(
        `UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`,
        [hashed, user.id],
      );
    } finally {
      client.release();
    }

    return { message: 'Password updated successfully' };
  }

  async validateToken(token: string) {
    try {
      return this.jwt.verify(token) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async issueOtp(
    userId: string,
    phone: string,
    purpose: 'LOGIN' | 'RESET_PASSWORD',
    schemaName: string,
  ) {
    const otp = randomOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${schemaName}", public`);
      // Invalidate previous unused OTPs for same user+purpose
      await client.query(
        `UPDATE otp_tokens SET used = TRUE WHERE user_id = $1 AND purpose = $2 AND used = FALSE`,
        [userId, purpose],
      );
      await client.query(
        `INSERT INTO otp_tokens (user_id, mobile, otp, purpose, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, phone, otp, purpose, expiresAt],
      );
    } finally {
      client.release();
    }

    const label = purpose === 'LOGIN' ? 'login' : 'password reset';
    await this.sms.send(phone, `Your LendersHub ${label} OTP is ${otp}. Valid for 10 minutes.`, schemaName);
  }

  private async consumeOtp(
    client: import('pg').PoolClient,
    userId: string,
    otp: string,
    purpose: 'LOGIN' | 'RESET_PASSWORD',
  ): Promise<boolean> {
    const res = await client.query<{ id: string }>(
      `SELECT id FROM otp_tokens
       WHERE user_id = $1 AND otp = $2 AND purpose = $3
         AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [userId, otp, purpose],
    );
    if (!res.rows[0]) return false;

    await client.query(`UPDATE otp_tokens SET used = TRUE WHERE id = $1`, [res.rows[0].id]);
    return true;
  }

  private buildTokenResponse(
    user: UserRow,
    tenant: { id: string; companyName: string; subdomain: string; schemaName?: string | null },
  ) {
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
      expiresIn: 8 * 60 * 60,
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

  private maskPhone(phone: string): string {
    const clean = phone.replace(/^\+?91/, '').replace(/[\s\-]/g, '');
    return clean.length >= 4 ? `XXXXXX${clean.slice(-4)}` : '****';
  }
}
