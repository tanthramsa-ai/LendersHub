import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { TenantCollectionsService, RecordCollectionPaymentDto } from './tenant-collections.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Controller('api/v1/tenant/collections')
@UseGuards(TenantJwtGuard)
export class TenantCollectionsController {
  constructor(private svc: TenantCollectionsService) {}

  @Get('stats')
  stats(@Req() req: { user: TenantJwtPayload }) {
    return this.svc.getStats(req.user);
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

  @Post(':installmentId/payment')
  @HttpCode(HttpStatus.OK)
  recordPayment(
    @Req() req: { user: TenantJwtPayload },
    @Param('installmentId') installmentId: string,
    @Body() dto: RecordCollectionPaymentDto,
  ) {
    return this.svc.recordPayment(req.user, installmentId, dto);
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
