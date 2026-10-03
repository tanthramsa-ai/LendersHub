import {
  Body, Controller, Delete, Get, Param, Post, Query, Request, StreamableFile, UseGuards, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { CreateEntryDto, TenantFinancialLedgerService } from './tenant-financial-ledger.service';

type Req = { user: TenantJwtPayload };

/**
 * The Financial Ledger statement: summary cards, the transaction grid with running balance,
 * breakdowns, Excel/PDF export and manual cash/bank entries. Role scoping (Owner/Admin full,
 * Manager loan money only, Agent own collections) is enforced in the service.
 */
@Controller('api/v1/tenant/financial-ledger')
@UseGuards(TenantJwtGuard)
export class TenantFinancialLedgerController {
  constructor(private svc: TenantFinancialLedgerService) {}

  @Get('summary')
  summary(@Request() req: Req, @Query() query: Record<string, unknown>) {
    return this.svc.summary(req.user, query);
  }

  @Get('transactions')
  transactions(@Request() req: Req, @Query() query: Record<string, unknown>) {
    return this.svc.transactions(req.user, query);
  }

  @Get('breakdown')
  breakdown(@Request() req: Req, @Query() query: Record<string, unknown>) {
    return this.svc.breakdown(req.user, query);
  }

  @Get('export/excel')
  async excel(@Request() req: Req, @Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    return this.file(await this.svc.exportFile(req.user, query, 'xlsx'), res);
  }

  @Get('export/pdf')
  async pdf(@Request() req: Req, @Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    return this.file(await this.svc.exportFile(req.user, query, 'pdf'), res);
  }

  @Post('entries')
  createEntry(@Request() req: Req, @Body() dto: CreateEntryDto) {
    return this.svc.createEntry(req.user, dto);
  }

  @Delete('entries/:id')
  deleteEntry(@Request() req: Req, @Param('id') id: string, @Query('reason') reason?: string) {
    return this.svc.deleteEntry(req.user, id, reason);
  }

  private file(f: { buffer: Buffer; filename: string; contentType: string }, res: Response) {
    res.set({
      'Content-Type': f.contentType,
      'Content-Disposition': `attachment; filename="${f.filename}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(f.buffer);
  }
}
