import { Controller, Get, Query, UseGuards, Request, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { TenantAccountsService } from './tenant-accounts.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Controller('api/v1/tenant/accounts')
@UseGuards(TenantJwtGuard)
export class TenantAccountsController {
  constructor(private svc: TenantAccountsService) {}

  @Get('summary')
  getSummary(@Request() req: { user: TenantJwtPayload }) {
    return this.svc.getSummary(req.user);
  }

  @Get('monthly-trend')
  getMonthlyTrend(
    @Request() req: { user: TenantJwtPayload },
    @Query('months', new DefaultValuePipe(6), ParseIntPipe) months: number,
  ) {
    return this.svc.getMonthlyTrend(req.user, Math.min(months, 24));
  }

  @Get('top-borrowers')
  getTopBorrowers(
    @Request() req: { user: TenantJwtPayload },
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.svc.getTopBorrowers(req.user, Math.min(limit, 50));
  }
}
