import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { SaveSystemSettingDto } from './dto/save-system-setting.dto';

type JsonRecord = Record<string, unknown>;

@Injectable()
export class SystemSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.systemSetting.findMany({
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
  }

  async save(payload: SaveSystemSettingDto) {
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
