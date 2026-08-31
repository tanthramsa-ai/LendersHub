import { Controller, Get, Post, Body, Param, Query, Req, HttpCode, HttpStatus, UseGuards, Request, NotFoundException, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPaymentWebhookService } from './tenant-payment-webhook.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Controller('api/v1/tenant/payments')
export class TenantPaymentWebhookController {
  constructor(
    private svc: TenantPaymentWebhookService,
    private prisma: PrismaService,
  ) {}

  /**
   * Public — no TenantJwtGuard. The provider identifies the organisation via
   * :subdomain in the URL (there's no other way for it to know which tenant
   * a payment belongs to) and authenticates via the per-tenant webhook
   * secret checked inside the service, not a bearer token.
   */
  @Post('webhook/:subdomain/:provider')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Param('subdomain') subdomain: string,
    @Param('provider') provider: string,
    @Req() req: ExpressRequest & { rawBody?: Buffer },
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { subdomain },
      select: { schemaName: true, status: true },
    });
    if (!tenant || tenant.status !== 'ACTIVE' || !tenant.schemaName) {
      throw new NotFoundException('Organisation not found');
    }
    const rawBody = (req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))).toString('utf8');
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : (v ?? '')]),
    );
    return this.svc.receiveWebhook(tenant.schemaName, provider, rawBody, headers);
  }

  @Get('webhook-config')
  @UseGuards(TenantJwtGuard)
  webhookConfig(@Request() req: { user: TenantJwtPayload }) {
    const baseUrl = process.env.PUBLIC_API_URL ?? `${process.env.API_ORIGIN ?? 'https://api.lendershub.in'}`;
    return this.svc.getWebhookConfig(req.user, req.user.subdomain, baseUrl);
  }

  @Post('webhook-config/:provider/secret')
  @UseGuards(TenantJwtGuard)
  setSecret(
    @Request() req: { user: TenantJwtPayload },
    @Param('provider') provider: string,
    @Body('secret') secret: string,
  ) {
    return this.svc.setWebhookSecret(req.user, provider, secret);
  }

  @Get('unmatched')
  @UseGuards(TenantJwtGuard)
  unmatched(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.svc.listUnmatched(req.user, page, Math.min(limit, 200));
  }

  @Get('processed')
  @UseGuards(TenantJwtGuard)
  processed(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.svc.listProcessed(req.user, page, Math.min(limit, 200));
  }

  @Post(':eventId/match')
  @UseGuards(TenantJwtGuard)
  match(
    @Request() req: { user: TenantJwtPayload },
    @Param('eventId') eventId: string,
    @Body('loanId') loanId: string,
    @Body('installmentId') installmentId?: string,
  ) {
    return this.svc.matchToLoan(req.user, eventId, loanId, installmentId);
  }

  @Post(':eventId/reject')
  @UseGuards(TenantJwtGuard)
  reject(
    @Request() req: { user: TenantJwtPayload },
    @Param('eventId') eventId: string,
    @Body('reason') reason: string,
  ) {
    return this.svc.rejectEvent(req.user, eventId, reason);
  }
}
