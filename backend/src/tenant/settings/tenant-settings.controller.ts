import { Controller, Get, Put, Body, UseGuards, Request } from '@nestjs/common';
import { TenantSettingsService, SmsConfigDto, WhatsAppConfigDto } from './tenant-settings.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Controller('api/v1/tenant/settings')
@UseGuards(TenantJwtGuard)
export class TenantSettingsController {
  constructor(private svc: TenantSettingsService) {}

  @Get('sms')
  getSmsConfig(@Request() req: { user: TenantJwtPayload }) {
    return this.svc.getSmsConfig(req.user);
  }

  @Put('sms')
  updateSmsConfig(
    @Request() req: { user: TenantJwtPayload },
    @Body() dto: SmsConfigDto,
  ) {
    return this.svc.updateSmsConfig(req.user, dto);
  }

  @Get('whatsapp')
  getWhatsAppConfig(@Request() req: { user: TenantJwtPayload }) {
    return this.svc.getWhatsAppConfig(req.user);
  }

  @Put('whatsapp')
  updateWhatsAppConfig(
    @Request() req: { user: TenantJwtPayload },
    @Body() dto: WhatsAppConfigDto,
  ) {
    return this.svc.updateWhatsAppConfig(req.user, dto);
  }
}
