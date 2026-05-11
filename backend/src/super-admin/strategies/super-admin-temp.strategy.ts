import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface TempTokenPayload {
  sub: string;
  email: string;
  type: string;
}

@Injectable()
export class SuperAdminTempStrategy extends PassportStrategy(Strategy, 'super-admin-temp') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  async validate(payload: TempTokenPayload) {
    if (payload.type !== 'super_admin_2fa_pending') {
      throw new UnauthorizedException('Invalid token type');
    }
    return { userId: payload.sub, email: payload.email };
  }
}
