import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface TenantJwtPayload {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string;
  subdomain: string;
  schemaName: string;
  type: 'tenant_user';
}

@Injectable()
export class TenantJwtStrategy extends PassportStrategy(Strategy, 'tenant-jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  async validate(payload: TenantJwtPayload) {
    if (payload.type !== 'tenant_user' || !payload.schemaName || !payload.tenantId) {
      throw new UnauthorizedException();
    }
    return payload;
  }
}
