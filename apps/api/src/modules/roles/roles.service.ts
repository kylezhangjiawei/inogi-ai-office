import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SaveRoleDto } from './dto/save-role.dto';
import { DEFAULT_ROLES } from './roles.defaults';

const DEFAULT_ROLE_SEED_SETTING_KEY = 'roles.defaultsSeeded';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    await this.ensureDefaultRoles();
    return this.prisma.role.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { users: true } } },
    });
  }

  async listOptions() {
    await this.ensureDefaultRoles();
    return this.prisma.role.findMany({
      select: { id: true, name: true, permissions: true },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    await this.ensureDefaultRoles();
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('角色不存在');
    return role;
  }

  private assertPermissionScope(permissions: unknown, actorPermissions: string[]) {
    if (actorPermissions.includes('*')) return;
    if (Array.isArray(permissions) && permissions.some((permission) => !actorPermissions.includes(permission))) {
      throw new ForbiddenException('不能管理或授予超出当前账号权限范围的角色，请联系超级管理员');
    }
  }

  private rethrowSaveError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException({
          statusCode: 409,
          code: 'ROLE_NAME_ALREADY_EXISTS',
          message: '角色名称已存在，请更换名称',
        });
      }
      if (error.code === 'P2025') throw new NotFoundException('角色不存在或已被删除，请刷新列表后重试');
    }
    throw error;
  }

  async save(payload: SaveRoleDto, actor: { id: string; permissions: string[] }) {
    const requiredPermission = payload.id ? 'role:edit' : 'role:create';
    if (!actor.permissions.includes('*') && !actor.permissions.includes(requiredPermission)) {
      throw new ForbiddenException(payload.id ? '没有编辑角色的权限' : '没有创建角色的权限');
    }
    this.assertPermissionScope(payload.permissions, actor.permissions);
    if (payload.id) {
      const existing = await this.prisma.role.findUnique({ where: { id: payload.id } });
      if (!existing) throw new NotFoundException('角色不存在或已被删除，请刷新列表后重试');
      if (Array.isArray(existing.permissions) && existing.permissions.includes('*')) {
        throw new ForbiddenException('超级管理员角色不允许修改');
      }
      this.assertPermissionScope(existing.permissions, actor.permissions);
      return this.prisma.role.update({
        where: { id: payload.id },
        data: {
          name: payload.name,
          description: payload.description,
          permissions: payload.permissions,
        },
      }).catch((error: unknown) => this.rethrowSaveError(error));
    }

    return this.prisma.role.create({
      data: {
        name: payload.name,
        description: payload.description,
        permissions: payload.permissions,
      },
    }).catch((error: unknown) => this.rethrowSaveError(error));
  }

  async remove(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('角色不存在');
    if (Array.isArray(role.permissions) && role.permissions.includes('*')) {
      throw new ForbiddenException('超级管理员角色不允许删除');
    }
    if (role._count.users > 0) {
      throw new BadRequestException(`该角色下仍有 ${role._count.users} 名用户，请先移除或重新分配后再删除`);
    }

    await this.prisma.role.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureDefaultRoles() {
    const seeded = await this.prisma.systemSetting.findUnique({
      where: { key: DEFAULT_ROLE_SEED_SETTING_KEY },
      select: { id: true },
    });
    if (seeded) return;

    for (const role of DEFAULT_ROLES) {
      const existing = await this.prisma.role.findUnique({
        where: { name: role.name },
        select: { id: true },
      });

      if (!existing) {
        await this.prisma.role.create({ data: role });
      }
    }

    await this.prisma.systemSetting.upsert({
      where: { key: DEFAULT_ROLE_SEED_SETTING_KEY },
      create: {
        category: 'system',
        key: DEFAULT_ROLE_SEED_SETTING_KEY,
        value: {
          seeded_at: new Date().toISOString(),
          role_names: DEFAULT_ROLES.map((role) => role.name),
        },
        description: 'Default roles have been initialized once; do not recreate roles after user edits/deletes them.',
      },
      update: {
        value: {
          seeded_at: new Date().toISOString(),
          role_names: DEFAULT_ROLES.map((role) => role.name),
        },
      },
    });
  }
}
