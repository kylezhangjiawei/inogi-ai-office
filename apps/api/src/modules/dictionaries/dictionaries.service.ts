import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import { ListDictionaryItemsQueryDto } from './dto/list-dictionary-items-query.dto';
import { SaveDictionaryItemDto } from './dto/save-dictionary-item.dto';
import { SaveDictionaryTypeDto } from './dto/save-dictionary-type.dto';

type DictionaryKind = 'email' | 'generic';

type DictionaryTypeValue = {
  key: string;
  label: string;
  kind: DictionaryKind;
  sort_order: number;
  created_by: string;
  updated_by: string;
};

type DictionaryItemValue = {
  type_id: string;
  kind: DictionaryKind;
  code?: string;
  label?: string;
  remark?: string;
  account?: string;
  encrypted_secret?: string;
  updated_by: string;
};

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 5;
const TYPE_CATEGORY = 'dictionary_type';
const ITEM_CATEGORY = 'dictionary_item';

@Injectable()
export class DictionariesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secureConfigService: SecureConfigService,
  ) {}

  async listTypes() {
    const records = await this.prisma.systemSetting.findMany({
      where: { category: TYPE_CATEGORY },
      orderBy: [{ updatedAt: 'desc' }],
    });

    return records
      .map((record) => this.parseTypeRecord(record))
      .filter((record): record is NonNullable<typeof record> => Boolean(record))
      .sort((left, right) => left.value.sort_order - right.value.sort_order || left.record.createdAt.getTime() - right.record.createdAt.getTime())
      .map(({ record, value }) => this.toTypeResponse(record, value));
  }

  async saveType(payload: SaveDictionaryTypeDto, userId?: string) {
    const label = payload.label?.trim();
    if (!label) {
      throw new BadRequestException('类型名称不能为空');
    }

    const operatorName = await this.resolveOperatorName(userId);

    if (payload.id) {
      const existing = await this.prisma.systemSetting.findFirst({
        where: { id: payload.id, category: TYPE_CATEGORY },
      });
      if (!existing) {
        throw new NotFoundException('字典类型不存在');
      }

      const parsed = this.parseTypeValue(existing.value);
      if (!parsed) {
        throw new BadRequestException('字典类型数据损坏');
      }

      const updated = await this.prisma.systemSetting.update({
        where: { id: payload.id },
        data: {
          description: `${label} (${parsed.kind})`,
          value: {
            ...parsed,
            label,
            updated_by: operatorName,
          } satisfies DictionaryTypeValue as Prisma.InputJsonValue,
        },
      });

      return this.toTypeResponse(updated, {
        ...parsed,
        label,
        updated_by: operatorName,
      });
    }

    const existingTypes = await this.listTypes();
    const kind = payload.kind ?? 'generic';
    const value: DictionaryTypeValue = {
      key: await this.generateUniqueTypeKey(label),
      label,
      kind,
      sort_order: existingTypes.length,
      created_by: operatorName,
      updated_by: operatorName,
    };

    const created = await this.prisma.systemSetting.create({
      data: {
        category: TYPE_CATEGORY,
        key: `dictionary_type:${value.key}:${Date.now()}`,
        description: `${label} (${kind})`,
        value: value as Prisma.InputJsonValue,
      },
    });

    return this.toTypeResponse(created, value);
  }

  async deleteType(typeId: string) {
    const type = await this.prisma.systemSetting.findFirst({
      where: { id: typeId, category: TYPE_CATEGORY },
    });
    if (!type) {
      throw new NotFoundException('字典类型不存在');
    }

    const itemIds = (await this.prisma.systemSetting.findMany({
      where: { category: ITEM_CATEGORY },
      select: { id: true, value: true },
    }))
      .filter((record) => this.parseItemValue(record.value)?.type_id === typeId)
      .map((record) => record.id);

    await this.prisma.$transaction([
      ...(itemIds.length
        ? [this.prisma.systemSetting.deleteMany({ where: { id: { in: itemIds } } })]
        : []),
      this.prisma.systemSetting.delete({ where: { id: typeId } }),
    ]);

    return { id: typeId };
  }

  async listItems(typeId: string, query: ListDictionaryItemsQueryDto) {
    const type = await this.getTypeOrThrow(typeId);
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const keyword = query.keyword?.trim().toLowerCase() ?? '';
    const operator = query.operator?.trim() ?? '';

    const allItems = (await this.prisma.systemSetting.findMany({
      where: { category: ITEM_CATEGORY },
      orderBy: { updatedAt: 'desc' },
    }))
      .map((record) => {
        const value = this.parseItemValue(record.value);
        if (!value || value.type_id !== typeId) return null;
        return { record, value };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    const operators = Array.from(new Set(allItems.map((entry) => entry.value.updated_by).filter(Boolean))).sort((left, right) =>
      left.localeCompare(right, 'zh-CN'),
    );

    const filteredItems = allItems.filter(({ record, value }) => {
      if (operator && operator !== 'ALL' && value.updated_by !== operator) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      if (type.value.kind === 'email') {
        return [value.account, value.updated_by].some((field) => field?.toLowerCase().includes(keyword));
      }

      return [value.code, value.label, value.remark, value.updated_by].some((field) => field?.toLowerCase().includes(keyword));
    });

    const total = filteredItems.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    const pagedItems = filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    return {
      type: this.toTypeResponse(type.record, type.value),
      items: pagedItems.map(({ record, value }) => this.toItemResponse(record, value)),
      total,
      page: currentPage,
      page_size: pageSize,
      total_pages: totalPages,
      operators,
    };
  }

  async saveItem(typeId: string, payload: SaveDictionaryItemDto, userId?: string) {
    const type = await this.getTypeOrThrow(typeId);
    const operatorName = await this.resolveOperatorName(userId);

    if (type.value.kind === 'email') {
      return this.saveEmailItem(typeId, payload, operatorName);
    }

    return this.saveGenericItem(typeId, payload, operatorName);
  }

  async deleteItem(itemId: string) {
    const item = await this.prisma.systemSetting.findFirst({
      where: { id: itemId, category: ITEM_CATEGORY },
    });
    if (!item) {
      throw new NotFoundException('字典条目不存在');
    }

    await this.prisma.systemSetting.delete({ where: { id: itemId } });
    return { id: itemId };
  }

  private async saveEmailItem(typeId: string, payload: SaveDictionaryItemDto, operatorName: string) {
    const account = payload.account?.trim();
    if (!account) {
      throw new BadRequestException('邮箱账号不能为空');
    }

    if (payload.id) {
      const existing = await this.getItemOrThrow(payload.id, typeId);
      const encryptedSecret = payload.password?.trim()
        ? this.secureConfigService.encryptForStorage(payload.password.trim())
        : existing.value.encrypted_secret;
      const nextValue: DictionaryItemValue = {
        type_id: typeId,
        kind: 'email',
        account,
        encrypted_secret: encryptedSecret,
        updated_by: operatorName,
      };

      const updated = await this.prisma.systemSetting.update({
        where: { id: payload.id },
        data: {
          description: account,
          value: nextValue as Prisma.InputJsonValue,
        },
      });

      return this.toItemResponse(updated, nextValue);
    }

    if (!payload.password?.trim()) {
      throw new BadRequestException('邮箱密码不能为空');
    }

    const createdValue: DictionaryItemValue = {
      type_id: typeId,
      kind: 'email',
      account,
      encrypted_secret: this.secureConfigService.encryptForStorage(payload.password.trim()),
      updated_by: operatorName,
    };

    const created = await this.prisma.systemSetting.create({
      data: {
        category: ITEM_CATEGORY,
        key: `dictionary_item:${typeId}:${Date.now()}`,
        description: account,
        value: createdValue as Prisma.InputJsonValue,
      },
    });

    return this.toItemResponse(created, createdValue);
  }

  private async saveGenericItem(typeId: string, payload: SaveDictionaryItemDto, operatorName: string) {
    const code = payload.code?.trim();
    const label = payload.label?.trim();
    if (!code || !label) {
      throw new BadRequestException('编码和标签不能为空');
    }

    const nextValue: DictionaryItemValue = {
      type_id: typeId,
      kind: 'generic',
      code,
      label,
      remark: payload.remark?.trim() ?? '',
      updated_by: operatorName,
    };

    if (payload.id) {
      const existing = await this.getItemOrThrow(payload.id, typeId);
      const updated = await this.prisma.systemSetting.update({
        where: { id: existing.record.id },
        data: {
          description: `${code} / ${label}`,
          value: nextValue as Prisma.InputJsonValue,
        },
      });

      return this.toItemResponse(updated, nextValue);
    }

    const created = await this.prisma.systemSetting.create({
      data: {
        category: ITEM_CATEGORY,
        key: `dictionary_item:${typeId}:${code}:${Date.now()}`,
        description: `${code} / ${label}`,
        value: nextValue as Prisma.InputJsonValue,
      },
    });

    return this.toItemResponse(created, nextValue);
  }

  private async getTypeOrThrow(typeId: string) {
    const record = await this.prisma.systemSetting.findFirst({
      where: { id: typeId, category: TYPE_CATEGORY },
    });
    if (!record) {
      throw new NotFoundException('字典类型不存在');
    }

    const value = this.parseTypeValue(record.value);
    if (!value) {
      throw new BadRequestException('字典类型数据损坏');
    }

    return { record, value };
  }

  private async getItemOrThrow(itemId: string, typeId: string) {
    const record = await this.prisma.systemSetting.findFirst({
      where: { id: itemId, category: ITEM_CATEGORY },
    });
    if (!record) {
      throw new NotFoundException('字典条目不存在');
    }

    const value = this.parseItemValue(record.value);
    if (!value || value.type_id !== typeId) {
      throw new NotFoundException('字典条目不存在');
    }

    return { record, value };
  }

  private parseTypeRecord(record: {
    id: string;
    key: string;
    description: string | null;
    value: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const value = this.parseTypeValue(record.value);
    if (!value) return null;
    return { record, value };
  }

  private parseTypeValue(value: Prisma.JsonValue): DictionaryTypeValue | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const parsed = value as Record<string, unknown>;
    const key = typeof parsed.key === 'string' ? parsed.key : '';
    const label = typeof parsed.label === 'string' ? parsed.label : '';
    const kind = parsed.kind === 'email' ? 'email' : parsed.kind === 'generic' ? 'generic' : null;
    const sortOrder = typeof parsed.sort_order === 'number' ? parsed.sort_order : 0;
    const createdBy = typeof parsed.created_by === 'string' ? parsed.created_by : '系统';
    const updatedBy = typeof parsed.updated_by === 'string' ? parsed.updated_by : createdBy;

    if (!key || !label || !kind) {
      return null;
    }

    return {
      key,
      label,
      kind,
      sort_order: sortOrder,
      created_by: createdBy,
      updated_by: updatedBy,
    };
  }

  private parseItemValue(value: Prisma.JsonValue): DictionaryItemValue | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const parsed = value as Record<string, unknown>;
    const typeId = typeof parsed.type_id === 'string' ? parsed.type_id : '';
    const kind = parsed.kind === 'email' ? 'email' : parsed.kind === 'generic' ? 'generic' : null;
    const updatedBy = typeof parsed.updated_by === 'string' ? parsed.updated_by : '系统';

    if (!typeId || !kind) {
      return null;
    }

    return {
      type_id: typeId,
      kind,
      code: typeof parsed.code === 'string' ? parsed.code : undefined,
      label: typeof parsed.label === 'string' ? parsed.label : undefined,
      remark: typeof parsed.remark === 'string' ? parsed.remark : undefined,
      account: typeof parsed.account === 'string' ? parsed.account : undefined,
      encrypted_secret: typeof parsed.encrypted_secret === 'string' ? parsed.encrypted_secret : undefined,
      updated_by: updatedBy,
    };
  }

  private async resolveOperatorName(userId?: string) {
    if (!userId) return '系统';

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    return user?.name?.trim() || '系统';
  }

  private async generateUniqueTypeKey(label: string) {
    const base = this.slugifyLabel(label);
    let candidate = base;
    let suffix = 1;
    const existingKeys = new Set((await this.listTypes()).map((item) => item.key));

    while (existingKeys.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  private slugifyLabel(label: string) {
    const normalized = label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');

    if (normalized) {
      return normalized;
    }

    return `dict_${Date.now()}`;
  }

  private toTypeResponse(
    record: { id: string; createdAt: Date; updatedAt: Date },
    value: DictionaryTypeValue,
  ) {
    return {
      id: record.id,
      key: value.key,
      label: value.label,
      kind: value.kind,
      created_at: record.createdAt.toISOString(),
      updated_at: record.updatedAt.toISOString(),
    };
  }

  private toItemResponse(
    record: { id: string; updatedAt: Date },
    value: DictionaryItemValue,
  ) {
    if (value.kind === 'email') {
      return {
        id: record.id,
        kind: 'email' as const,
        account: value.account ?? '',
        password: value.encrypted_secret ? this.decryptSecret(value.encrypted_secret) : '',
        updated_at: record.updatedAt.toISOString(),
        updated_by: value.updated_by,
      };
    }

    return {
      id: record.id,
      kind: 'generic' as const,
      code: value.code ?? '',
      label: value.label ?? '',
      remark: value.remark ?? '',
      updated_at: record.updatedAt.toISOString(),
      updated_by: value.updated_by,
    };
  }

  private decryptSecret(encryptedSecret: string) {
    try {
      return this.secureConfigService.decryptFromStorage(encryptedSecret);
    } catch {
      return '';
    }
  }
}
