import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { TenantCollectionsService, RecordCollectionPaymentDto } from './tenant-collections.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Controller('api/v1/tenant/collections')
@UseGuards(TenantJwtGuard)
export class TenantCollectionsController {
  constructor(private svc: TenantCollectionsService) {}

  @Get('stats')
  stats(@Req() req: { user: TenantJwtPayload }, @Query('period') period?: string) {
    return this.svc.getStats(req.user, period);
  }

  @Get('reminder')
  reminder(
    @Req() req: { user: TenantJwtPayload },
    @Query('period') period = 'D',
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
  ) {
    return this.svc.getReminder(req.user, period, parseInt(page), parseInt(limit), search);
  }

  @Get('pending')
  pending(
    @Req() req: { user: TenantJwtPayload },
    @Query('period') period = 'D',
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
  ) {
    return this.svc.getPending(req.user, period, parseInt(page), parseInt(limit), search);
  }

  @Get('today')
  today(
    @Req() req: { user: TenantJwtPayload },
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
  ) {
    return this.svc.getToday(req.user, parseInt(page), parseInt(limit), search);
  }

  @Get('overdue')
  overdue(
    @Req() req: { user: TenantJwtPayload },
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
  ) {
    return this.svc.getOverdue(req.user, parseInt(page), parseInt(limit), search);
  }

  @Get('agents')
  agents(@Req() req: { user: TenantJwtPayload }) {
    return this.svc.getAgents(req.user);
  }

  @Get('calendar')
  calendar(@Req() req: { user: TenantJwtPayload }, @Query('month') month: string) {
    return this.svc.getCalendar(req.user, month);
  }

  @Get('by-date')
  byDate(
    @Req() req: { user: TenantJwtPayload },
    @Query('date') date: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
  ) {
    return this.svc.getByDate(req.user, date, parseInt(page), parseInt(limit), search);
  }

  @Post(':installmentId/payment')
  @HttpCode(HttpStatus.OK)
  recordPayment(
    @Req() req: { user: TenantJwtPayload },
    @Param('installmentId') installmentId: string,
    @Body() dto: RecordCollectionPaymentDto,
  ) {
    return this.svc.recordPayment(req.user, installmentId, dto);
  }

  // ── Collection Calendar workflow ────────────────────────────────────────────

  @Get('calendar-items')
  calendarItems(
    @Req() req: { user: TenantJwtPayload },
    @Query('view') view: 'day' | 'week' | 'month' = 'week',
    @Query('date') date?: string,
  ) {
    return this.svc.getCalendarItems(req.user, view, date ?? new Date().toISOString().slice(0, 10));
  }

  @Get('calendar-summary')
  calendarSummary(
    @Req() req: { user: TenantJwtPayload },
    @Query('view') view: 'day' | 'week' | 'month' = 'week',
    @Query('date') date?: string,
  ) {
    return this.svc.getCalendarSummary(req.user, view, date ?? new Date().toISOString().slice(0, 10));
  }

  @Get('detail/:installmentId')
  collectionDetail(
    @Req() req: { user: TenantJwtPayload },
    @Param('installmentId') installmentId: string,
  ) {
    return this.svc.getCollectionDetail(req.user, installmentId);
  }

  @Post(':installmentId/collect')
  @HttpCode(HttpStatus.OK)
  collect(
    @Req() req: { user: TenantJwtPayload },
    @Param('installmentId') installmentId: string,
    @Body() dto: RecordCollectionPaymentDto & { idempotencyKey?: string },
  ) {
    return this.svc.collectPayment(req.user, installmentId, dto);
  }

  @Post('payments/:paymentId/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(
    @Req() req: { user: TenantJwtPayload },
    @Param('paymentId') paymentId: string,
    @Body('confirmedAmount') confirmedAmount?: number,
  ) {
    return this.svc.confirmPayment(req.user, paymentId, confirmedAmount);
  }

  @Post(':installmentId/undo')
  @HttpCode(HttpStatus.OK)
  undo(
    @Req() req: { user: TenantJwtPayload },
    @Param('installmentId') installmentId: string,
  ) {
    return this.svc.undoCollection(req.user, installmentId);
  }

  @Patch(':installmentId/assign')
  assign(
    @Req() req: { user: TenantJwtPayload },
    @Param('installmentId') installmentId: string,
    @Body('agentId') agentId: string | null,
  ) {
    return this.svc.assignAgent(req.user, installmentId, agentId ?? null);
  }
}
