import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

export interface SuperAdminJwtPayload {
  sub: string;
  email: string;
  role: string;
  type: string;
}

@Injectable()
export class SuperAdminJwtStrategy extends PassportStrategy(Strategy, 'super-admin-jwt') {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  async validate(payload: SuperAdminJwtPayload) {
    if (payload.type !== 'super_admin' || payload.role !== 'SUPER_ADMIN') {
      throw new UnauthorizedException();
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.role !== 'SUPER_ADMIN') throw new UnauthorizedException();
    const { password: _, totpSecret: __, ...result } = user;
    return result;
  }
}
