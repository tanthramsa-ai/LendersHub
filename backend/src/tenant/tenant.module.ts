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
import { TenantActivityLogService } from './activity-log/tenant-activity-log.service';
import { TenantActivityLogController } from './activity-log/tenant-activity-log.controller';

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
    TenantActivityLogService,
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
    TenantActivityLogController,
  ],
})
export class TenantModule {}
