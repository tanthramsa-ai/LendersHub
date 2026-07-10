import { Controller, Get, Query, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { TenantActivityLogService } from './tenant-activity-log.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

// Oversight roles — same tier that can see "all data" per the permission matrix
// (Loan Types, Org Settings). LOAN_OFFICER/COLLECTOR/VIEWER only see their own
// portfolio elsewhere in the app, so a cross-user activity trail is out of scope for them.
const CAN_VIEW_ACTIVITY = ['OWNER', 'MANAGER', 'ADMIN'];

@Controller('api/v1/tenant/activity-log')
@UseGuards(TenantJwtGuard)
export class TenantActivityLogController {
  constructor(private activity: TenantActivityLogService) {}

  @Get()
  list(
    @Request() req: { user: TenantJwtPayload },
    @Query('page') page = '1',
    @Query('limit') limit = '25',
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('search') search?: string,
  ) {
    if (!CAN_VIEW_ACTIVITY.includes(req.user.role)) {
      throw new ForbiddenException('You do not have permission to view the activity log');
    }
    return this.activity.list(req.user, parseInt(page, 10), parseInt(limit, 10), {
      action: action || undefined,
      entityType: entityType || undefined,
      search: search || undefined,
    });
  }
}
