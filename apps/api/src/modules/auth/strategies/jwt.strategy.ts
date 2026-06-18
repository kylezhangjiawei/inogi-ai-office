import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../../../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  roleId: string | null;
  permissions: string[];
  /** 所属部门名称（签发时快照）。 */
  department?: string | null;
  /** 部门稳定标识（签发时解析）。数据隔离以此为准。 */
  departmentCode?: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') ?? 'change-me-jwt-secret',
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status === 'DISABLED') {
      throw new UnauthorizedException();
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      roleId: user.roleId,
      permissions: payload.permissions,
      // 部门名取库内最新值；稳定标识取签发时快照（TTL 内一致，改派后重登生效）。
      department: user.department ?? null,
      departmentCode: payload.departmentCode ?? null,
    };
  }
}
