import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

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

  async save(payload: SaveRoleDto) {
    if (payload.id) {
      return this.prisma.role.update({
        where: { id: payload.id },
        data: {
          name: payload.name,
          description: payload.description,
          permissions: payload.permissions,
        },
      });
    }

    return this.prisma.role.create({
      data: {
        name: payload.name,
        description: payload.description,
        permissions: payload.permissions,
      },
    });
  }

  async remove(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('角色不存在');
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
