import { Controller, Get, Post, Body, Param, Query, UseGuards, Request, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { TenantReconciliationService } from './tenant-reconciliation.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Controller('api/v1/tenant/reconciliation')
@UseGuards(TenantJwtGuard)
export class TenantReconciliationController {
  constructor(private svc: TenantReconciliationService) {}

  @Get('unreconciled-collections')
  unreconciled(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.svc.listUnreconciledCollections(req.user, page, Math.min(limit, 200));
  }

  @Post('reconcile')
  reconcile(
    @Request() req: { user: TenantJwtPayload },
    @Body('transactionIds') transactionIds: string[],
    @Body('settlementReference') settlementReference?: string,
  ) {
    return this.svc.reconcile(req.user, transactionIds, settlementReference);
  }

  @Get('reversed-transactions')
  reversed(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.svc.listReversedTransactions(req.user, page, Math.min(limit, 200));
  }

  @Get('partially-allocated')
  partiallyAllocated(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.svc.listPartiallyAllocated(req.user, page, Math.min(limit, 200));
  }

  @Get('snapshots')
  listSnapshots(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.svc.listSnapshots(req.user, page, Math.min(limit, 200));
  }

  @Get('snapshots/:date')
  getSnapshot(@Request() req: { user: TenantJwtPayload }, @Param('date') date: string) {
    return this.svc.getSnapshot(req.user, date);
  }

  @Post('snapshots/:date/generate')
  generateSnapshot(@Request() req: { user: TenantJwtPayload }, @Param('date') date: string) {
    return this.svc.generateSnapshot(req.user, date);
  }

  @Post('snapshots/:date/lock')
  lockDay(@Request() req: { user: TenantJwtPayload }, @Param('date') date: string) {
    return this.svc.lockDay(req.user, date);
  }

  @Post('snapshots/:date/unlock')
  unlockDay(@Request() req: { user: TenantJwtPayload }, @Param('date') date: string) {
    return this.svc.unlockDay(req.user, date);
  }
}
