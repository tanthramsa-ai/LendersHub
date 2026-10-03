import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthThrottlerGuard } from './auth-throttler.guard';

/** Registers the throttler once for every module that has credential endpoints. */
@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10 }])],
  providers: [AuthThrottlerGuard],
  exports: [ThrottlerModule, AuthThrottlerGuard],
})
export class AuthThrottleModule {}
