import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

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

const DEPARTMENT_KB_ID_BY_CODE: Record<string, string> = {
  GENERAL_OFFICE: 'gm',
  HR_ADMIN: 'hr',
  FINANCE: 'finance',
  PURCHASING: 'purchasing',
  PRODUCTION: 'production',
  REGULATORY_QUALITY: 'quality',
  SALES_MARKETING: 'sales',
};

const CURRENT_EXPENSE_DEPARTMENT_CATEGORIES = [
  'expense_invoice',
  'expense_voucher',
  'expense_reimbursement',
  'expense_archive',
];

type DepartmentIdentity = {
  name: string;
  code: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * SystemSetting 里仍有少量历史模块使用部门名称/编码快照。
 * 这里只处理明确的部门字段；审计说明、普通文本等历史内容保持不变。
 */
function replaceDepartmentReferences(
  input: unknown,
  previous: DepartmentIdentity,
  next: DepartmentIdentity,
): { value: unknown; changed: boolean } {
  if (Array.isArray(input)) {
    let changed = false;
    const value = input.map((item) => {
      const replaced = replaceDepartmentReferences(item, previous, next);
      changed ||= replaced.changed;
      return replaced.value;
    });
    return { value, changed };
  }

  if (!isRecord(input)) {
    return { value: input, changed: false };
  }

  let changed = false;
  const value: Record<string, unknown> = {};
  const recordDepartmentCode =
    typeof input.department_code === 'string' ? input.department_code : null;

  for (const [key, item] of Object.entries(input)) {
    if (key === 'department' && item === previous.name) {
      value[key] = next.name;
      changed = true;
      continue;
    }
    if (
      key === 'department_name' &&
      (item === previous.name || recordDepartmentCode === previous.code)
    ) {
      value[key] = next.name;
      changed = true;
      continue;
    }
    if (key === 'department_code' && item === previous.code) {
      value[key] = next.code;
      changed = true;
      continue;
    }

    const replaced = replaceDepartmentReferences(item, previous, next);
    value[key] = replaced.value;
    changed ||= replaced.changed;
  }

  return { value, changed };
}

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

  async directory() {
    return this.prisma.department.findMany({
      select: { id: true, code: true, name: true, enabled: true },
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
      return this.prisma.$transaction(async (tx) => {
        const existing = await tx.department.findUnique({
          where: { id: payload.id },
          select: { id: true, name: true, code: true },
        });
        if (!existing) throw new NotFoundException('部门不存在');
        if (existing.code !== data.code) {
          throw new BadRequestException('部门编码是跨模块关联标识，创建后不允许修改');
        }

        const updated = await tx.department.update({
          where: { id: payload.id },
          data,
          select: DEPARTMENT_SELECT,
        });

        const previousIdentity = { name: existing.name, code: existing.code };
        const nextIdentity = { name: updated.name, code: updated.code };
        if (
          previousIdentity.name === nextIdentity.name &&
          previousIdentity.code === nextIdentity.code
        ) {
          return updated;
        }

        if (previousIdentity.name !== nextIdentity.name) {
          await tx.user.updateMany({
            where: { department: previousIdentity.name },
            data: { department: nextIdentity.name },
          });
          await tx.employeeArchive.updateMany({
            where: { department: previousIdentity.name },
            data: { department: nextIdentity.name },
          });
          await tx.procTask.updateMany({
            where: { requesterDept: previousIdentity.name },
            data: { requesterDept: nextIdentity.name },
          });
        }

        const kbId = DEPARTMENT_KB_ID_BY_CODE[updated.code];
        if (kbId && previousIdentity.name !== nextIdentity.name) {
          await tx.permissionCatalogItem.updateMany({
            where: { code: `page:dept-kb-${kbId}` },
            data: {
              label: `${nextIdentity.name}知识库`,
              description: `${nextIdentity.name}知识沉淀与分级查阅`,
            },
          });
        }

        const settings = await tx.systemSetting.findMany({
          where: {
            OR: [
              { category: { in: CURRENT_EXPENSE_DEPARTMENT_CATEGORIES } },
              { key: 'rd.people' },
              { key: 'rd.directorDashboard' },
              { key: { endsWith: '.people' } },
              { key: { endsWith: '.directorDashboard' } },
            ],
          },
          select: { id: true, value: true },
        });

        for (const setting of settings) {
          const replaced = replaceDepartmentReferences(
            setting.value,
            previousIdentity,
            nextIdentity,
          );
          if (!replaced.changed) continue;
          await tx.systemSetting.update({
            where: { id: setting.id },
            data: {
              value: JSON.parse(JSON.stringify(replaced.value)) as Prisma.InputJsonValue,
            },
          });
        }

        return updated;
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
      select: { id: true, name: true, code: true },
    });
    if (!department) throw new NotFoundException('部门不存在');

    const [userCount, employeeCount, procurementTaskCount, settings] = await Promise.all([
      this.prisma.user.count({ where: { department: department.name } }),
      this.prisma.employeeArchive.count({ where: { department: department.name } }),
      this.prisma.procTask.count({ where: { requesterDept: department.name } }),
      this.prisma.systemSetting.findMany({
        where: {
          OR: [
            { category: { in: CURRENT_EXPENSE_DEPARTMENT_CATEGORIES } },
            { key: 'rd.people' },
            { key: 'rd.directorDashboard' },
            { key: { endsWith: '.people' } },
            { key: { endsWith: '.directorDashboard' } },
          ],
        },
        select: { value: true },
      }),
    ]);
    const jsonReferenceCount = settings.filter(
      (setting) =>
        replaceDepartmentReferences(
          setting.value,
          { name: department.name, code: department.code },
          { name: '', code: '' },
        ).changed,
    ).length;
    const referenceCount =
      userCount + employeeCount + procurementTaskCount + jsonReferenceCount;
    if (referenceCount > 0) {
      throw new BadRequestException(
        `该部门仍被 ${referenceCount} 处业务数据引用，请先调整归属后再删除`,
      );
    }

    await this.prisma.department.delete({ where: { id } });
    return { ok: true };
  }
}
