import { Controller, Get, Post, Patch, Put, Body, Param, Query, UseGuards, Request, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { TenantFundersService, CreateFunderDto, UpdateFunderDto, PostFunderTransactionDto, LoanAllocationInput } from './tenant-funders.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Controller('api/v1/tenant/funders')
@UseGuards(TenantJwtGuard)
export class TenantFundersController {
  constructor(private svc: TenantFundersService) {}

  @Get()
  list(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.svc.listFunders(req.user, page, Math.min(limit, 200), activeOnly === 'true');
  }

  @Post()
  create(@Request() req: { user: TenantJwtPayload }, @Body() dto: CreateFunderDto) {
    return this.svc.createFunder(req.user, dto);
  }

  @Get(':id')
  detail(
    @Request() req: { user: TenantJwtPayload },
    @Param('id') id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.svc.getFunder(req.user, id, page, Math.min(limit, 200));
  }

  @Patch(':id')
  update(@Request() req: { user: TenantJwtPayload }, @Param('id') id: string, @Body() dto: UpdateFunderDto) {
    return this.svc.updateFunder(req.user, id, dto);
  }

  @Post(':id/transactions')
  postTransaction(
    @Request() req: { user: TenantJwtPayload },
    @Param('id') id: string,
    @Body() dto: PostFunderTransactionDto,
  ) {
    return this.svc.postFunderTransaction(req.user, id, dto);
  }

  @Post(':id/transactions/:txnId/reverse')
  reverseTransaction(
    @Request() req: { user: TenantJwtPayload },
    @Param('id') id: string,
    @Param('txnId') txnId: string,
    @Body('reason') reason: string,
  ) {
    return this.svc.reverseFunderTransaction(req.user, id, txnId, reason);
  }

  @Get('loan/:loanId/allocations')
  loanAllocations(@Request() req: { user: TenantJwtPayload }, @Param('loanId') loanId: string) {
    return this.svc.getLoanAllocations(req.user, loanId);
  }

  @Put('loan/:loanId/allocations')
  setLoanAllocations(
    @Request() req: { user: TenantJwtPayload },
    @Param('loanId') loanId: string,
    @Body('allocations') allocations: LoanAllocationInput[],
  ) {
    return this.svc.setLoanAllocations(req.user, loanId, allocations ?? []);
  }
}
