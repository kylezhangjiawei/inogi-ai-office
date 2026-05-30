import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { SaveDepartmentDto } from './dto/save-department.dto';

const DEPARTMENT_SELECT = {
  id: true,
  code: true,
  name: true,
  category: true,
  manager: true,
  description: true,
  sortOrder: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const [departments, groupedUsers] = await Promise.all([
      this.prisma.department.findMany({
        select: DEPARTMENT_SELECT,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.user.groupBy({
        by: ['department'],
        _count: { _all: true },
        where: { department: { not: null } },
      }),
    ]);

    const userCountByName = new Map(
      groupedUsers.map((item) => [item.department ?? '', item._count._all]),
    );

    return departments.map((department) => ({
      ...department,
      userCount: userCountByName.get(department.name) ?? 0,
    }));
  }

  async options() {
    return this.prisma.department.findMany({
      where: { enabled: true },
      select: { id: true, code: true, name: true, category: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async save(payload: SaveDepartmentDto) {
    const data = {
      name: payload.name.trim(),
      code: payload.code.trim().toUpperCase(),
      category: payload.category.trim(),
      manager: payload.manager?.trim() ?? '',
      description: payload.description?.trim() ?? '',
      sortOrder: payload.sortOrder ?? 0,
      enabled: payload.enabled ?? true,
    };

    if (payload.id) {
      return this.prisma.department.update({
        where: { id: payload.id },
        data,
        select: DEPARTMENT_SELECT,
      });
    }

    return this.prisma.department.create({ data, select: DEPARTMENT_SELECT });
  }

  async updateStatus(id: string, enabled: boolean) {
    const existing = await this.prisma.department.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('部门不存在');

    return this.prisma.department.update({
      where: { id },
      data: { enabled },
      select: DEPARTMENT_SELECT,
    });
  }

  async remove(id: string) {
    const department = await this.prisma.department.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!department) throw new NotFoundException('部门不存在');

    const userCount = await this.prisma.user.count({
      where: { department: department.name },
    });
    if (userCount > 0) {
      throw new Error(`该部门下仍有 ${userCount} 名用户，请先调整用户部门后再删除`);
    }

    await this.prisma.department.delete({ where: { id } });
    return { ok: true };
  }
}
