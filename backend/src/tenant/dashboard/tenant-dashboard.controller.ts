import { Controller, Get, Query, UseGuards, Request, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { TenantDashboardService } from './tenant-dashboard.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Controller('api/v1/tenant/dashboard')
@UseGuards(TenantJwtGuard)
export class TenantDashboardController {
  constructor(private svc: TenantDashboardService) {}

  @Get('stats')
  getStats(@Request() req: { user: TenantJwtPayload }) {
    return this.svc.getStats(req.user);
  }

  @Get('recent-activity')
  getRecentActivity(@Request() req: { user: TenantJwtPayload }) {
    return this.svc.getRecentActivity(req.user);
  }

  @Get('active-loans')
  getActiveLoans(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.svc.getActiveLoans(req.user, page, Math.min(limit, 50));
  }
}
