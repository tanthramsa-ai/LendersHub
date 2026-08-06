import { Module } from '@nestjs/common';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { OverdueAgeingService } from './overdue-ageing.service';
import { OverdueAgeingController } from './overdue-ageing.controller';
import { TenantNotificationsService } from '../tenant/notifications/tenant-notifications.service';

@Module({
  controllers: [OverdueAgeingController],
  providers: [NotificationSchedulerService, OverdueAgeingService, TenantNotificationsService],
  exports: [NotificationSchedulerService, OverdueAgeingService],
})
export class SchedulerModule {}
