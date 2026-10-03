import { Controller, Post, Body, HttpCode, HttpStatus, Get, UseGuards, Req } from '@nestjs/common';
import { TenantAuthService } from './tenant-auth.service';
import { TenantLoginDto } from './dto/tenant-login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TenantJwtGuard } from './guards/tenant-jwt.guard';
import { Throttle } from '@nestjs/throttler';
import { AuthThrottlerGuard } from '../../common/throttle/auth-throttler.guard';

@Controller('api/v1/tenant/auth')
export class TenantAuthController {
  constructor(private auth: TenantAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: TenantLoginDto) {
    return this.auth.login(dto);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyLoginOtp(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Get('me')
  @UseGuards(TenantJwtGuard)
  me(@Req() req: { user: Record<string, unknown> }) {
    return req.user;
  }
}
