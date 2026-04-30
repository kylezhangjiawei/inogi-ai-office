import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { SaveRoleDto } from './dto/save-role.dto';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.role.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { users: true } } },
    });
  }

  listOptions() {
    return this.prisma.role.findMany({
      select: { id: true, name: true, permissions: true },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
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
      throw new Error(`该角色下仍有 ${role._count.users} 名用户，请先移除或重新分配后再删除`);
    }

    await this.prisma.role.delete({ where: { id } });
    return { ok: true };
  }
}
