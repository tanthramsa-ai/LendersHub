import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Request, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { TenantLoansService, CreateLoanDto, CreateWeeklyLoanDto, CreateDailyLoanDto, CreateMonthlyLoanDto, CreateAgentRiskLoanDto, CreateTermLoanDto, RecordPaymentDto } from './tenant-loans.service';
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
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
    @Query('loanTypeId') loanTypeId?: string,
    @Query('officerId') officerId?: string,
  ) {
    return this.svc.list(req.user, page, Math.min(limit, 100), { status, search, branchId, loanTypeId, officerId });
  }

  @Get('weekly')
  listWeekly(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.listWeeklyLoans(req.user, page, Math.min(limit, 100), { search, branchId, status });
  }

  @Post('weekly/preview')
  previewWeekly(
    @Request() _req: { user: TenantJwtPayload },
    @Body() dto: Pick<CreateWeeklyLoanDto, 'principal' | 'interestRate' | 'termWeeks' | 'firstDueDate' | 'calculationType' | 'emiRounding'>,
  ) {
    return this.svc.previewWeeklySchedule(dto);
  }

  @Post('weekly')
  createWeekly(@Request() req: { user: TenantJwtPayload }, @Body() dto: CreateWeeklyLoanDto) {
    return this.svc.createWeeklyLoan(req.user, dto);
  }

  @Get('daily')
  listDaily(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('cycleType') cycleType?: string,
  ) {
    return this.svc.listDailyLoans(req.user, page, Math.min(limit, 100), { search, branchId, status, cycleType });
  }

  @Post('daily/preview')
  previewDaily(
    @Request() _req: { user: TenantJwtPayload },
    @Body() dto: Pick<CreateDailyLoanDto, 'principal' | 'interestRate' | 'termDays' | 'firstDueDate' | 'calculationType' | 'emiRounding' | 'cycleType'>,
  ) {
    return this.svc.previewDailySchedule(dto);
  }

  @Post('daily')
  createDaily(@Request() req: { user: TenantJwtPayload }, @Body() dto: CreateDailyLoanDto) {
    return this.svc.createDailyLoan(req.user, dto);
  }

  @Get('agent-risk')
  listAgentRisk(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.listAgentRiskLoans(req.user, page, Math.min(limit, 100), { search, branchId, status });
  }

  @Post('agent-risk/preview')
  previewAgentRisk(
    @Request() _req: { user: TenantJwtPayload },
    @Body() dto: Pick<CreateAgentRiskLoanDto, 'principal' | 'interestRate' | 'termMonths' | 'firstDueDate'>,
  ) {
    return this.svc.previewAgentRiskSchedule(dto);
  }

  @Post('agent-risk')
  createAgentRisk(@Request() req: { user: TenantJwtPayload }, @Body() dto: CreateAgentRiskLoanDto) {
    return this.svc.createAgentRiskLoan(req.user, dto);
  }

  @Get('monthly')
  listMonthly(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.listMonthlyLoans(req.user, page, Math.min(limit, 100), { search, branchId, status });
  }

  @Post('monthly/preview')
  previewMonthly(
    @Request() _req: { user: TenantJwtPayload },
    @Body() dto: Pick<CreateMonthlyLoanDto, 'principal' | 'interestRate' | 'termMonths' | 'firstDueDate'>,
  ) {
    return this.svc.previewMonthlySchedule(dto);
  }

  @Post('monthly')
  createMonthly(@Request() req: { user: TenantJwtPayload }, @Body() dto: CreateMonthlyLoanDto) {
    return this.svc.createMonthlyLoan(req.user, dto);
  }

  @Get('term-loan')
  listTermLoans(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.listTermLoans(req.user, page, Math.min(limit, 100), { search, branchId, status });
  }

  @Post('term-loan/preview')
  previewTermLoan(
    @Request() _req: { user: TenantJwtPayload },
    @Body() dto: Pick<CreateTermLoanDto, 'principal' | 'interestRate' | 'termMonths' | 'firstDueDate' | 'calculationType' | 'emiRounding'>,
  ) {
    return this.svc.previewTermLoanSchedule(dto);
  }

  @Post('term-loan')
  createTermLoan(@Request() req: { user: TenantJwtPayload }, @Body() dto: CreateTermLoanDto) {
    return this.svc.createTermLoan(req.user, dto);
  }

  @Get(':id')
  findOne(@Request() req: { user: TenantJwtPayload }, @Param('id') id: string) {
    return this.svc.findOne(req.user, id);
  }

  @Post()
  create(@Request() req: { user: TenantJwtPayload }, @Body() dto: CreateLoanDto) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id/close')
  closeLoan(@Request() req: { user: TenantJwtPayload }, @Param('id') id: string) {
    return this.svc.closeLoan(req.user, id);
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
