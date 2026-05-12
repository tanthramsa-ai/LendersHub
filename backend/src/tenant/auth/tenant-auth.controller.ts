import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { TenantAuthService } from './tenant-auth.service';
import { TenantLoginDto } from './dto/tenant-login.dto';

@Controller('api/v1/tenant/auth')
export class TenantAuthController {
  constructor(private auth: TenantAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: TenantLoginDto) {
    return this.auth.login(dto);
  }
}
