import { Controller, Post, Body, HttpCode, HttpStatus, Get, UseGuards, Req } from '@nestjs/common';
import { TenantAuthService } from './tenant-auth.service';
import { TenantLoginDto } from './dto/tenant-login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TenantJwtGuard } from './guards/tenant-jwt.guard';

@Controller('api/v1/tenant/auth')
export class TenantAuthController {
  constructor(private auth: TenantAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: TenantLoginDto) {
    return this.auth.login(dto);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyLoginOtp(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Get('me')
  @UseGuards(TenantJwtGuard)
  me(@Req() req: { user: Record<string, unknown> }) {
    return req.user;
  }
}
