import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class TenantJwtGuard extends AuthGuard('tenant-jwt') {}
