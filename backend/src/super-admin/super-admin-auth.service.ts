import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as otplib from 'otplib';
import * as qrcode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { SuperAdminLoginDto } from './dto/super-admin-login.dto';
import { Verify2faDto } from './dto/verify-2fa.dto';
import { ConfirmSetup2faDto } from './dto/confirm-setup-2fa.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuditLogService } from './audit-log/audit-log.service';

@Injectable()
export class SuperAdminAuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private auditLog: AuditLogService,
  ) {}

  async login(dto: SuperAdminLoginDto, ipAddress: string) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (!user || user.role !== 'SUPER_ADMIN') {
      await this.audit(null, dto.email, ipAddress, false, 'Invalid credentials');
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      await this.audit(user.id, dto.email, ipAddress, false, 'Invalid password');
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.audit(user.id, dto.email, ipAddress, true, null);

    if (!user.totpEnabled) {
      return {
        requiresTwoFactor: false,
        totpEnabled: false,
        accessToken: this.signFullToken(user.id, user.email, false),
      };
    }

    const tempToken = this.jwt.sign(
      { sub: user.id, email: user.email, type: 'super_admin_2fa_pending' },
      { expiresIn: '10m' },
    );

    return {
      requiresTwoFactor: true,
      totpEnabled: true,
      tempToken,
    };
  }

  async setupTwoFactor(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    if (user.totpEnabled) throw new ConflictException('2FA is already enabled');

    const secret = otplib.generateSecret();
    const otpauthUrl = otplib.generateURI({ label: user.email, issuer: 'LendersHub', secret });
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret },
    });

    return { qrCodeDataUrl, otpauthUrl };
  }

  async confirmSetup(userId: string, dto: ConfirmSetup2faDto, ipAddress: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    if (user.totpEnabled) throw new ConflictException('2FA is already enabled');
    if (!user.totpSecret) throw new ForbiddenException('Setup not initiated');

    const result = otplib.verifySync({ token: dto.token, secret: user.totpSecret!, epochTolerance: 30 });
    const valid = result.valid;
    if (!valid) {
      await this.audit(userId, user.email, ipAddress, false, 'Invalid 2FA token during setup');
      throw new UnauthorizedException('Invalid 2FA code');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: true },
    });

    await this.audit(userId, user.email, ipAddress, true, '2FA setup complete');
    await this.auditLog.record({
      actor: { id: userId, email: user.email },
      ipAddress,
      action: 'super_admin.2fa_enabled',
      targetType: 'super_admin',
      targetId: userId,
      targetLabel: user.email,
    });

    return { accessToken: this.signFullToken(user.id, user.email, true) };
  }

  async verifyTwoFactor(userId: string, dto: Verify2faDto, ipAddress: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    if (!user.totpEnabled || !user.totpSecret) throw new ForbiddenException('2FA not configured');

    const result = otplib.verifySync({ token: dto.token, secret: user.totpSecret!, epochTolerance: 30 });
    const valid = result.valid;
    if (!valid) {
      await this.audit(userId, user.email, ipAddress, false, 'Invalid 2FA token');
      throw new UnauthorizedException('Invalid 2FA code');
    }

    await this.audit(userId, user.email, ipAddress, true, null);

    return { accessToken: this.signFullToken(user.id, user.email, true) };
  }

  async changePassword(userId: string, dto: ChangePasswordDto, ipAddress: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const valid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');
    const hashed = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { password: hashed } });

    await this.auditLog.record({
      actor: { id: userId, email: user.email },
      ipAddress,
      action: 'super_admin.password_changed',
      targetType: 'super_admin',
      targetId: userId,
      targetLabel: user.email,
    });

    return { message: 'Password changed successfully' };
  }

  async disableTwoFactor(userId: string, ipAddress: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    if (!user.totpEnabled) throw new ConflictException('2FA is not enabled');
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecret: null },
    });

    await this.auditLog.record({
      actor: { id: userId, email: user.email },
      ipAddress,
      action: 'super_admin.2fa_disabled',
      targetType: 'super_admin',
      targetId: userId,
      targetLabel: user.email,
    });

    return { message: '2FA disabled' };
  }

  private signFullToken(userId: string, email: string, totpEnabled: boolean) {
    return this.jwt.sign(
      { sub: userId, email, role: 'SUPER_ADMIN', type: 'super_admin', totpEnabled },
      { expiresIn: '30m' },
    );
  }

  private async audit(
    userId: string | null,
    email: string,
    ipAddress: string,
    success: boolean,
    reason: string | null,
  ) {
    await this.prisma.loginAuditLog.create({
      data: { userId, email, ipAddress, success, reason },
    });
  }
}
