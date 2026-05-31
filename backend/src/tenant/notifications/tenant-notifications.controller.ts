import {
  Controller, Get, Patch, Param, Query, UseGuards, Request,
  DefaultValuePipe, ParseIntPipe, ParseBoolPipe,
} from '@nestjs/common';
import { TenantNotificationsService } from './tenant-notifications.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Controller('api/v1/tenant/notifications')
@UseGuards(TenantJwtGuard)
export class TenantNotificationsController {
  constructor(private svc: TenantNotificationsService) {}

  @Get()
  list(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('unreadOnly', new DefaultValuePipe(false), ParseBoolPipe) unreadOnly: boolean,
  ) {
    return this.svc.list(req.user, page, Math.min(limit, 50), unreadOnly);
  }

  @Get('unread-count')
  unreadCount(@Request() req: { user: TenantJwtPayload }) {
    return this.svc.unreadCount(req.user);
  }

  @Patch('read-all')
  markAllRead(@Request() req: { user: TenantJwtPayload }) {
    return this.svc.markAllRead(req.user);
  }

  @Patch(':id/read')
  markRead(@Request() req: { user: TenantJwtPayload }, @Param('id') id: string) {
    return this.svc.markRead(req.user, id);
  }
}
