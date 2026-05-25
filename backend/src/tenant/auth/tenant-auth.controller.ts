import { Controller, Post, Body, HttpCode, HttpStatus, Get, UseGuards, Req } from '@nestjs/common';
import { TenantAuthService } from './tenant-auth.service';
import { TenantLoginDto } from './dto/tenant-login.dto';
import { TenantJwtGuard } from './guards/tenant-jwt.guard';

@Controller('api/v1/tenant/auth')
export class TenantAuthController {
  constructor(private auth: TenantAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: TenantLoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  @UseGuards(TenantJwtGuard)
  me(@Req() req: { user: Record<string, unknown> }) {
    return req.user;
  }
}
