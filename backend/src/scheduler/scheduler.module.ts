import { Module } from '@nestjs/common';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { TenantNotificationsService } from '../tenant/notifications/tenant-notifications.service';

@Module({
  providers: [NotificationSchedulerService, TenantNotificationsService],
  exports: [NotificationSchedulerService],
})
export class SchedulerModule {}
