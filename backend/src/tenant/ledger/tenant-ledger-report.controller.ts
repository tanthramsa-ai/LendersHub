import { Controller, Get, Post, Body, Param, Query, UseGuards, Request, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { TenantLedgerReportService } from './tenant-ledger-report.service';
import { TenantLedgerPostingService, LedgerTransactionType, LedgerPaymentChannel } from './tenant-ledger-posting.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

export interface PostAdjustmentDto {
  transactionDate?: string;
  loanId?: string;
  customerId?: string;
  principalAmount?: number;
  interestAmount?: number;
  feeAmount?: number;
  otherAmount?: number;
  paymentChannel?: LedgerPaymentChannel;
  externalReference?: string;
  remarks: string;
}

/**
 * Read-only reporting over ledger_transactions, plus the two write
 * operations requirements doc §11 lists alongside it (POST .../adjustments,
 * POST .../:id/reverse) — both just expose TenantLedgerPostingService
 * methods that already existed but had no controller route. Mounted on its
 * own base path (not /api/v1/tenant/ledger, which TenantLedgerController
 * already owns for the existing fund_transactions-backed credits/debits/
 * principal/transactions UI) to avoid a route collision on GET/POST
 * .../transactions.
 */
@Controller('api/v1/tenant/ledger-transactions')
@UseGuards(TenantJwtGuard)
export class TenantLedgerReportController {
  constructor(
    private svc: TenantLedgerReportService,
    private ledgerPosting: TenantLedgerPostingService,
  ) {}

  @Get('dashboard')
  dashboard(@Request() req: { user: TenantJwtPayload }, @Query('month') month?: string) {
    return this.svc.getDashboard(req.user, month);
  }

  @Get('daily')
  daily(
    @Request() req: { user: TenantJwtPayload },
    @Query('date') date: string | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.svc.getDaily(req.user, date ?? new Date().toISOString().slice(0, 10), page, Math.min(limit, 200));
  }

  @Get('loan/:loanId')
  loanLedger(
    @Request() req: { user: TenantJwtPayload },
    @Param('loanId') loanId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.svc.getLoanLedger(req.user, loanId, page, Math.min(limit, 200));
  }

  @Get('customer/:customerId')
  customerLedger(
    @Request() req: { user: TenantJwtPayload },
    @Param('customerId') customerId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.svc.getCustomerLedger(req.user, customerId, page, Math.min(limit, 200));
  }

  @Get()
  list(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('type') type?: LedgerTransactionType,
    @Query('loanId') loanId?: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.listTransactions(
      req.user,
      { transactionType: type, loanId, customerId, status, from, to },
      page, Math.min(limit, 200),
    );
  }

  @Post('adjustments')
  postAdjustment(@Request() req: { user: TenantJwtPayload }, @Body() dto: PostAdjustmentDto) {
    return this.ledgerPosting.postTransaction(req.user, { ...dto, transactionType: 'ADJUSTMENT' });
  }

  @Post(':id/reverse')
  reverse(
    @Request() req: { user: TenantJwtPayload },
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    return this.ledgerPosting.reverseTransaction(req.user, id, reason);
  }
}
