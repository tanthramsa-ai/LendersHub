import { Controller, Get, Post, Query, Body, UseGuards, Request, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { TenantLedgerService, CreateTransactionDto } from './tenant-ledger.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Controller('api/v1/tenant/ledger')
@UseGuards(TenantJwtGuard)
export class TenantLedgerController {
  constructor(private svc: TenantLedgerService) {}

  @Get('credits')
  listCredits(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('month') month?: string,
  ) {
    return this.svc.listCredits(req.user, page, Math.min(limit, 200), month);
  }

  @Get('debits')
  listDebits(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('month') month?: string,
  ) {
    return this.svc.listDebits(req.user, page, Math.min(limit, 200), month);
  }

  @Get('principal')
  listPrincipalTransactions(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('month') month?: string,
  ) {
    return this.svc.listPrincipalTransactions(req.user, page, Math.min(limit, 200), month);
  }

  @Get('transactions')
  listTransactions(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('month') month?: string,
  ) {
    return this.svc.listManualTransactions(req.user, page, Math.min(limit, 200), month);
  }

  @Post('transactions')
  addTransaction(
    @Request() req: { user: TenantJwtPayload },
    @Body() dto: CreateTransactionDto,
  ) {
    return this.svc.addTransaction(req.user, dto);
  }
}
