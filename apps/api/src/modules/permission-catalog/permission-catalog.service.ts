import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { SavePermissionCatalogItemDto } from './dto/save-permission-catalog-item.dto';
import { DEFAULT_PERMISSION_CATALOG } from './permission-catalog.defaults';

@Injectable()
export class PermissionCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listGroups(options: { enabledOnly?: boolean } = {}) {
    await this.ensureDefaults();
    const items = await this.prisma.permissionCatalogItem.findMany({
      where: options.enabledOnly ? { enabled: true } : undefined,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    const groups = new Map<string, { label: string; permissions: Array<{ code: string; label: string; description?: string; type: string; routePath?: string }> }>();
    for (const item of items) {
      const group = groups.get(item.groupLabel) ?? { label: item.groupLabel, permissions: [] };
      group.permissions.push({
        code: item.code,
        label: item.label,
        description: item.description || undefined,
        type: item.type,
        routePath: item.routePath || undefined,
      });
      groups.set(item.groupLabel, group);
    }

    return [...groups.values()];
  }

  async listItems() {
    await this.ensureDefaults();
    return this.prisma.permissionCatalogItem.findMany({
      orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async save(payload: SavePermissionCatalogItemDto) {
    await this.ensureDefaults();
    const data = {
      code: payload.code.trim(),
      label: payload.label.trim(),
      description: payload.description?.trim() ?? '',
      groupLabel: payload.groupLabel.trim(),
      type: payload.type,
      routePath: payload.routePath?.trim() ?? '',
      enabled: payload.enabled,
      sortOrder: payload.sortOrder,
    };

    if (payload.id) {
      return this.prisma.permissionCatalogItem.update({
        where: { id: payload.id },
        data,
      });
    }

    return this.prisma.permissionCatalogItem.create({ data });
  }

  async remove(id: string) {
    await this.ensureDefaults();
    const existing = await this.prisma.permissionCatalogItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('权限目录项不存在');

    await this.prisma.permissionCatalogItem.delete({ where: { id } });
    return { ok: true };
  }

  async ensureDefaults() {
    const count = await this.prisma.permissionCatalogItem.count();
    if (count > 0) return;

    await this.prisma.$transaction(
      DEFAULT_PERMISSION_CATALOG.map((item) =>
        this.prisma.permissionCatalogItem.upsert({
          where: { code: item.code },
          update: {},
          create: {
            code: item.code,
            label: item.label,
            description: item.description ?? '',
            groupLabel: item.groupLabel,
            type: item.type,
            routePath: item.routePath ?? '',
            enabled: true,
            sortOrder: item.sortOrder,
          },
        }),
      ),
    );
  }
}
