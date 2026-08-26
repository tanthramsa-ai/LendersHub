import { Controller, Get, Param, Query, UseGuards, Request } from '@nestjs/common';
import { TenantReportsService, OutstandingGroupBy } from './tenant-reports.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

function todayYmd() { return new Date().toISOString().slice(0, 10); }
function thisMonth() { return new Date().toISOString().slice(0, 7); }

/** Reporting suite — requirements doc §12 plus the §5.2 fund-utilization ratio. */
@Controller('api/v1/tenant/reports')
@UseGuards(TenantJwtGuard)
export class TenantReportsController {
  constructor(private svc: TenantReportsService) {}

  @Get('daily-collection')
  dailyCollection(@Request() req: { user: TenantJwtPayload }, @Query('date') date?: string) {
    return this.svc.dailyCollection(req.user, date ?? todayYmd());
  }

  @Get('monthly-collection')
  monthlyCollection(
    @Request() req: { user: TenantJwtPayload },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const toMonth = to ?? thisMonth();
    // Default window: the trailing 12 months ending at `to`.
    const defaultFrom = (() => {
      const d = new Date(`${toMonth}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - 11);
      return d.toISOString().slice(0, 7);
    })();
    return this.svc.monthlyCollection(req.user, from ?? defaultFrom, toMonth);
  }

  @Get('outstanding-principal')
  outstandingPrincipal(
    @Request() req: { user: TenantJwtPayload },
    @Query('groupBy') groupBy: OutstandingGroupBy = 'agent',
  ) {
    return this.svc.outstandingPrincipal(req.user, groupBy);
  }

  @Get('fund-utilization')
  fundUtilization(@Request() req: { user: TenantJwtPayload }) {
    return this.svc.fundUtilization(req.user);
  }

  @Get('funder-capital')
  funderCapital(@Request() req: { user: TenantJwtPayload }) {
    return this.svc.funderCapital(req.user);
  }

  @Get('agent-settlement')
  agentSettlement(
    @Request() req: { user: TenantJwtPayload },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.agentSettlement(req.user, from, to);
  }

  @Get('channel-reconciliation')
  channelReconciliation(
    @Request() req: { user: TenantJwtPayload },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.channelReconciliation(req.user, from, to);
  }

  @Get('npa-write-off')
  npaWriteOff(@Request() req: { user: TenantJwtPayload }) {
    return this.svc.npaWriteOff(req.user);
  }

  @Get('loan-statement/:loanId')
  loanStatement(@Request() req: { user: TenantJwtPayload }, @Param('loanId') loanId: string) {
    return this.svc.loanStatement(req.user, loanId);
  }

  @Get('adjustment-audit')
  adjustmentAudit(
    @Request() req: { user: TenantJwtPayload },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.adjustmentAudit(req.user, from, to);
  }
}
