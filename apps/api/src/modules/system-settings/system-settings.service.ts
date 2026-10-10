import { ForbiddenException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { SaveSystemSettingDto } from './dto/save-system-setting.dto';

type JsonRecord = Record<string, unknown>;
const PROTECTED_CATEGORIES = ['electronic-gate', 'factory-qc', 'rd-meeting-todos'];
// The gate currently uses electronic-gate.item.; reserve its entire namespace
// so legacy or future rows cannot bypass the dedicated validation endpoints.
const PROTECTED_PREFIXES = ['electronic-gate.', 'factory-qc.', 'rd.meeting-todos.'];
function isProtected(row: { key: string; category: string } | null): boolean {
  return !!row && (PROTECTED_CATEGORIES.includes(row.category) || PROTECTED_PREFIXES.some(prefix => row.key.startsWith(prefix)));
}

@Injectable()
export class SystemSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.systemSetting.findMany({
      where: { NOT: { OR: [
        { category: { in: PROTECTED_CATEGORIES } },
        ...PROTECTED_PREFIXES.map(prefix => ({ key: { startsWith: prefix } })),
      ] } },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
  }

  async save(payload: SaveSystemSettingDto) {
    if (isProtected(payload)) throw new ForbiddenException('电子闸门、FactoryQc 及会议待办须通过专用管理接口修改');
    // Check both the original id and destination key: changing a protected row's
    // name/category must not turn it into an ordinary writable setting.
    const [byId, byKey] = await Promise.all([
      payload.id ? this.prisma.systemSetting.findUnique({ where: { id: payload.id }, select: { key: true, category: true } }) : Promise.resolve(null),
      this.prisma.systemSetting.findUnique({ where: { key: payload.key }, select: { key: true, category: true } }),
    ]);
    if (isProtected(byId) || isProtected(byKey)) throw new ForbiddenException('电子闸门、FactoryQc 及会议待办须通过专用管理接口修改');
    if (payload.id) {
      return this.prisma.systemSetting.update({
        where: { id: payload.id },
        data: {
          category: payload.category,
          key: payload.key,
          value: payload.value as JsonRecord as any,
          description: payload.description,
        },
      });
    }

    return this.prisma.systemSetting.upsert({
      where: { key: payload.key },
        create: {
          category: payload.category,
          key: payload.key,
          value: payload.value as JsonRecord as any,
          description: payload.description,
        },
        update: {
          category: payload.category,
          value: payload.value as JsonRecord as any,
          description: payload.description,
        },
      });
  }
}
