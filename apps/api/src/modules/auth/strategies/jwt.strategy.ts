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
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status === 'DISABLED') {
      throw new UnauthorizedException();
    }
    const department = user.department?.trim() || null;
    const currentDepartment = department
      ? await this.prisma.department.findUnique({
          where: { name: department },
          select: { code: true },
        })
      : null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      roleId: user.roleId,
      permissions: payload.permissions,
      // 名称和稳定编码均取主数据最新值，部门改名后无需等待令牌过期或重新登录。
      department,
      departmentCode: currentDepartment?.code ?? null,
    };
  }
}
