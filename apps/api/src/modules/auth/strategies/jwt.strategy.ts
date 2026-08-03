import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../../../prisma/prisma.service';
import { PermissionCatalogService } from '../../permission-catalog/permission-catalog.service';

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
    private readonly permissionCatalog: PermissionCatalogService,
    configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: { select: { permissions: true } } },
    });
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
      /**
       * 权限取主数据最新值，不用 JWT 里的签发快照。
       * 旧实现用 payload.permissions，导致改了角色权限或换了用户角色后，后端最长
       * ACCESS_TOKEN_TTL(15m) 内仍按旧权限判定；而前端 /auth/me 每次加载取的是实时值，
       * 两边不一致会表现为「界面能进但接口 403」或「入口没了接口却还放行」。
       * 与下面 department 的处理保持同一原则：主数据变更立即生效，无需重新登录。
       */
      // 再剔除权限目录里被「停用」的码：停用 = 对所有人失效，而不只是不可分配。
      // 超管('*')不受影响，否则误停用 page:route-management 后无人能恢复。
      permissions: await this.permissionCatalog.filterDisabled(
        Array.isArray(user.role?.permissions) ? (user.role.permissions as string[]) : [],
      ),
      // 名称和稳定编码均取主数据最新值，部门改名后无需等待令牌过期或重新登录。
      department,
      departmentCode: currentDepartment?.code ?? null,
    };
  }
}
