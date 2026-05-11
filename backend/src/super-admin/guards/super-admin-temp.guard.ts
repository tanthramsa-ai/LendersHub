import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class SuperAdminTempGuard extends AuthGuard('super-admin-temp') {}
