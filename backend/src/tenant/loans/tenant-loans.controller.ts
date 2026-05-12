import { Controller, Get, Post, Param, Body, Query, UseGuards, Request, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { TenantLoansService, CreateLoanDto, RecordPaymentDto } from './tenant-loans.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Controller('api/v1/tenant/loans')
@UseGuards(TenantJwtGuard)
export class TenantLoansController {
  constructor(private svc: TenantLoansService) {}

  @Get()
  list(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: string,
  ) {
    return this.svc.list(req.user, page, Math.min(limit, 100), status);
  }

  @Get(':id')
  findOne(@Request() req: { user: TenantJwtPayload }, @Param('id') id: string) {
    return this.svc.findOne(req.user, id);
  }

  @Post()
  create(@Request() req: { user: TenantJwtPayload }, @Body() dto: CreateLoanDto) {
    return this.svc.create(req.user, dto);
  }

  @Post(':id/payments')
  recordPayment(
    @Request() req: { user: TenantJwtPayload },
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.svc.recordPayment(req.user, id, dto);
  }
}
