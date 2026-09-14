import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';

import { resolveEnglishName } from '../../common/english-name';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveUserDto } from './dto/save-user.dto';

const USER_SELECT = {
  id: true,
  name: true,
  englishName: true,
  username: true,
  email: true,
  department: true,
  status: true,
  roleId: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, name: true, permissions: true } },
};

function isSuperAdminRole(permissions: unknown): boolean {
  return Array.isArray(permissions) && (permissions as string[]).includes('*');
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }

  private assertRoleScope(permissions: unknown, actorPermissions: string[]) {
    if (actorPermissions.includes('*')) return;
    if (Array.isArray(permissions) && permissions.some((permission) => !actorPermissions.includes(permission))) {
      throw new ForbiddenException('不能管理或分配超出当前账号权限范围的角色，请联系超级管理员');
    }
  }

  /**
   * 角色与部门的完整性校验。
   *
   * 此前两者都是「照单全收」：roleId 不验证是否存在、department 是自由文本不比对部门主数据，
   * 于是能创建出没有角色（登录后零权限、首页都打不开）或挂着不存在部门（数据隔离全部落空）的账号。
   *
   * ⚠️ User.department 存的是部门**名称**而非外键（见 schema.prisma），部门改名时由
   * departments.service 级联改写。因此这里只能按 name 比对，并要求部门处于启用状态。
   */
  private async assertRoleAndDepartment(payload: SaveUserDto, isCreate: boolean, actorPermissions: string[]) {
    if (isCreate && !payload.roleId) {
      throw new BadRequestException('请为用户指定角色：无角色的账号登录后没有任何权限');
    }
    if (payload.roleId) {
      const role = await this.prisma.role.findUnique({
        where: { id: payload.roleId },
        select: { id: true, permissions: true },
      });
      if (!role) throw new BadRequestException('指定的角色不存在，可能已被删除，请重新选择');
      this.assertRoleScope(role.permissions, actorPermissions);
    }

    const department = payload.department?.trim();
    if (isCreate && !department) {
      throw new BadRequestException('请为用户指定部门：部门决定数据可见范围，不能为空');
    }
    if (department) {
      const found = await this.prisma.department.findUnique({
        where: { name: department },
        select: { enabled: true },
      });
      if (!found) {
        throw new BadRequestException(`部门「${department}」不存在，请从部门列表中选择`);
      }
      if (!found.enabled) {
        throw new BadRequestException(`部门「${department}」已停用，不能再分配用户`);
      }
    }
  }

  private rethrowSaveError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = error.meta?.target;
        const fields = Array.isArray(target) ? target : [target];
        if (fields.includes('username')) {
          throw new ConflictException({
            statusCode: 409,
            code: 'USERNAME_ALREADY_EXISTS',
            message: '用户名已存在，请更换用户名',
          });
        }
        if (fields.includes('email')) {
          throw new ConflictException({
            statusCode: 409,
            code: 'EMAIL_ALREADY_EXISTS',
            message: '邮箱已被使用，请更换邮箱',
          });
        }
        throw new ConflictException('用户名或邮箱已存在，请检查后重试');
      }
      if (error.code === 'P2025') throw new NotFoundException('用户不存在');
    }
    throw error;
  }

  async save(payload: SaveUserDto, actor: { id: string; permissions: string[] }) {
    const requiredPermission = payload.id ? 'user:edit' : 'user:create';
    if (!actor.permissions.includes('*') && !actor.permissions.includes(requiredPermission)) {
      throw new ForbiddenException(payload.id ? '没有编辑用户的权限' : '没有创建用户的权限');
    }
    await this.assertRoleAndDepartment(payload, !payload.id, actor.permissions);
    if (payload.id) {
      const existing = await this.prisma.user.findUnique({
        where: { id: payload.id },
        include: { role: true },
      });
      if (!existing) throw new NotFoundException('用户不存在');
      if (isSuperAdminRole(existing.role?.permissions)) {
        throw new ForbiddenException('超级管理员账号信息不允许修改');
      }
      this.assertRoleScope(existing.role?.permissions, actor.permissions);

      return this.prisma.user.update({
        where: { id: payload.id },
        data: {
          name: payload.name,
          englishName: payload.englishName === undefined
            ? existing?.englishName
            : resolveEnglishName(payload.englishName),
          ...(payload.email ? { email: payload.email } : {}),
          username: payload.username ?? undefined,
          department: payload.department ?? undefined,
          // ⚠️ 必须是 undefined（保持原值）而非 null（清空）：前端在角色下拉为空时发送
          // roleId: undefined，旧写法会把该用户的角色一并抹掉，使其登录后零权限。
          // 与上面 department 的处理保持一致——未提供即不改动。
          roleId: payload.roleId ?? undefined,
          status: payload.status ?? 'ACTIVE',
        },
        select: USER_SELECT,
      }).catch((error: unknown) => this.rethrowSaveError(error));
    }

    // 未提供邮箱时自动生成唯一占位邮箱，避免 UNIQUE 约束冲突
    const email =
      payload.email?.trim() ||
      `u-${randomBytes(8).toString('hex')}@noemail.internal`;

    const createData: Parameters<typeof this.prisma.user.create>[0]['data'] = {
      name: payload.name,
      englishName: resolveEnglishName(payload.englishName),
      email,
      username: payload.username ?? undefined,
      department: payload.department ?? undefined,
      roleId: payload.roleId ?? null,
      status: payload.status ?? 'ACTIVE',
    };

    if (payload.password) {
      createData.passwordHash = await argon2.hash(payload.password, {
        type: argon2.argon2id,
      });
    }

    return this.prisma.user.create({ data: createData, select: USER_SELECT })
      .catch((error: unknown) => this.rethrowSaveError(error));
  }

  async updateStatus(id: string, status: 'ACTIVE' | 'DISABLED' | 'INVITED') {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    if (isSuperAdminRole(user.role?.permissions) && status === 'DISABLED') {
      throw new Error('超级管理员账号不允许被停用');
    }

    return this.prisma.user.update({
      where: { id },
      data: { status },
      select: USER_SELECT,
    });
  }

  /**
   * 重置用户密码。
   * isSelf = true 时跳过超管身份校验（允许超管自行修改密码）。
   * isSelf = false 时禁止修改超管账号密码。
   */
  async adminResetPassword(id: string, newPassword: string, isSelf = false) {
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new BadRequestException('新密码至少需要 8 位');
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    if (!isSelf && isSuperAdminRole(user.role?.permissions)) {
      throw new Error('超级管理员账号密码不允许被其他人修改');
    }

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      await tx.refreshToken.deleteMany({ where: { userId: id } });
    });
    return { ok: true };
  }

  async remove(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: { select: { permissions: true } },
      },
    });
    if (!user) throw new NotFoundException('用户不存在');
    if (isSuperAdminRole(user.role?.permissions)) {
      throw new ForbiddenException('超级管理员账号不允许被删除');
    }

    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }
}
