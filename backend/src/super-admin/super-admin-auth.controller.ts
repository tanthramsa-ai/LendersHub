import { Controller, Post, Get, Body, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { SuperAdminAuthService } from './super-admin-auth.service';
import { SuperAdminLoginDto } from './dto/super-admin-login.dto';
import { Verify2faDto } from './dto/verify-2fa.dto';
import { ConfirmSetup2faDto } from './dto/confirm-setup-2fa.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SuperAdminJwtGuard } from './guards/super-admin-jwt.guard';
import { SuperAdminTempGuard } from './guards/super-admin-temp.guard';

@Controller('api/v1/super-admin/auth')
export class SuperAdminAuthController {
  constructor(private auth: SuperAdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: SuperAdminLoginDto, @Req() req: any) {
    const ip = req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown';
    return this.auth.login(dto, ip);
  }

  @UseGuards(SuperAdminJwtGuard)
  @Get('setup-2fa')
  setupTwoFactor(@Req() req: any) {
    return this.auth.setupTwoFactor(req.user.id);
  }

  @UseGuards(SuperAdminJwtGuard)
  @Post('setup-2fa')
  @HttpCode(HttpStatus.OK)
  confirmSetup(@Body() dto: ConfirmSetup2faDto, @Req() req: any) {
    const ip = req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown';
    return this.auth.confirmSetup(req.user.id, dto, ip);
  }

  @UseGuards(SuperAdminTempGuard)
  @Post('verify-2fa')
  @HttpCode(HttpStatus.OK)
  verifyTwoFactor(@Body() dto: Verify2faDto, @Req() req: any) {
    const ip = req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown';
    return this.auth.verifyTwoFactor(req.user.userId, dto, ip);
  }

  @UseGuards(SuperAdminJwtGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: any) {
    return this.auth.changePassword(req.user.id, dto);
  }

  @UseGuards(SuperAdminJwtGuard)
  @Post('disable-2fa')
  @HttpCode(HttpStatus.OK)
  disableTwoFactor(@Req() req: any) {
    return this.auth.disableTwoFactor(req.user.id);
  }

  @UseGuards(SuperAdminJwtGuard)
  @Get('me')
  me(@Req() req: any) {
    return req.user;
  }
}
