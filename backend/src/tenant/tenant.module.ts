import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TenantAuthService } from './auth/tenant-auth.service';
import { TenantAuthController } from './auth/tenant-auth.controller';
import { TenantJwtStrategy } from './auth/strategies/tenant-jwt.strategy';
import { TenantDashboardService } from './dashboard/tenant-dashboard.service';
import { TenantDashboardController } from './dashboard/tenant-dashboard.controller';
import { TenantCustomersService } from './customers/tenant-customers.service';
import { TenantCustomersController } from './customers/tenant-customers.controller';
import { TenantLoansService } from './loans/tenant-loans.service';
import { TenantLoansController } from './loans/tenant-loans.controller';
import { TenantCollectionsService } from './collections/tenant-collections.service';
import { TenantCollectionsController } from './collections/tenant-collections.controller';
import { TenantUsersService } from './users/tenant-users.service';
import { TenantUsersController } from './users/tenant-users.controller';
import { TenantBranchesService } from './branches/tenant-branches.service';
import { TenantBranchesController } from './branches/tenant-branches.controller';
import { TenantSettingsService } from './settings/tenant-settings.service';
import { TenantSettingsController } from './settings/tenant-settings.controller';
import { TenantLoanTypesService } from './loan-types/tenant-loan-types.service';
import { TenantLoanTypesController } from './loan-types/tenant-loan-types.controller';
import { TenantAccountsService } from './accounts/tenant-accounts.service';
import { TenantAccountsController } from './accounts/tenant-accounts.controller';
import { TenantNotificationsService } from './notifications/tenant-notifications.service';
import { TenantNotificationsController } from './notifications/tenant-notifications.controller';
import { TenantLedgerService } from './ledger/tenant-ledger.service';
import { TenantLedgerController } from './ledger/tenant-ledger.controller';
import { TenantLedgerPostingService } from './ledger/tenant-ledger-posting.service';
import { TenantLedgerReportService } from './ledger/tenant-ledger-report.service';
import { TenantLedgerReportController } from './ledger/tenant-ledger-report.controller';
import { TenantFundersService } from './funders/tenant-funders.service';
import { TenantFundersController } from './funders/tenant-funders.controller';
import { TenantReconciliationService } from './reconciliation/tenant-reconciliation.service';
import { TenantReconciliationController } from './reconciliation/tenant-reconciliation.controller';
import { TenantPaymentWebhookService } from './payments/tenant-payment-webhook.service';
import { TenantPaymentWebhookController } from './payments/tenant-payment-webhook.controller';
import { TenantReportsService } from './reports/tenant-reports.service';
import { TenantReportsController } from './reports/tenant-reports.controller';
import { TenantActivityLogService } from './activity-log/tenant-activity-log.service';
import { TenantActivityLogController } from './activity-log/tenant-activity-log.controller';
import { TenantPermissionsService } from './permissions/tenant-permissions.service';
import { TenantPermissionsController } from './permissions/tenant-permissions.controller';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({ secret: process.env.JWT_SECRET }),
  ],
  providers: [
    TenantAuthService,
    TenantJwtStrategy,
    TenantDashboardService,
    TenantCustomersService,
    TenantLoansService,
    TenantCollectionsService,
    TenantUsersService,
    TenantBranchesService,
    TenantSettingsService,
    TenantLoanTypesService,
    TenantAccountsService,
    TenantNotificationsService,
    TenantLedgerService,
    TenantLedgerPostingService,
    TenantLedgerReportService,
    TenantFundersService,
    TenantReconciliationService,
    TenantPaymentWebhookService,
    TenantReportsService,
    TenantActivityLogService,
    TenantPermissionsService,
  ],
  controllers: [
    TenantAuthController,
    TenantDashboardController,
    TenantCustomersController,
    TenantLoansController,
    TenantCollectionsController,
    TenantUsersController,
    TenantBranchesController,
    TenantSettingsController,
    TenantLoanTypesController,
    TenantAccountsController,
    TenantNotificationsController,
    TenantLedgerController,
    TenantLedgerReportController,
    TenantFundersController,
    TenantReconciliationController,
    TenantPaymentWebhookController,
    TenantReportsController,
    TenantActivityLogController,
    TenantPermissionsController,
  ],
})
export class TenantModule {}
