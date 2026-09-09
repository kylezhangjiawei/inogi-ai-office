import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GATE_DEFINITIONS, GATE_SETTING_CATEGORY, GATE_SETTING_PREFIX, type GateConfig, type GateDefinition, type GateItem } from './electronic-gate.catalog';
import { FactoryQcService } from './factory-qc.service';

type StoredGate = {
  schemaVersion: 1;
  draft: GateConfig | null;
  active: GateConfig | null;
  revision: number;
  updatedBy: string | null;
  publishedAt: string | null;
};
type SettingRow = { key: string; value: unknown; updatedAt: Date };
type Actor = { id?: string; name?: string };
const CONFIG_KEYS = new Set(['enabled', 'model', 'market', 'displayName', 'helpText', 'values', 'failureAction']);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function revision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Only configured, published values may be consumed. Catalog references never become active implicitly. */
@Injectable()
export class ElectronicGateService {
  constructor(private readonly prisma: PrismaService, private readonly factoryQc?: FactoryQcService) {}

  async list(): Promise<{ items: GateItem[] }> {
    const rows = await this.prisma.systemSetting.findMany({ where: { category: GATE_SETTING_CATEGORY, key: { startsWith: GATE_SETTING_PREFIX } } });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return { items: GATE_DEFINITIONS.map((definition) => this.item(definition, byKey.get(this.key(definition.id)))) };
  }

  async saveDraft(id: string, payload: unknown, actor: Actor): Promise<GateItem> {
    const definition = this.definition(id);
    const expectedRevision = this.readPayload(payload, true);
    const draft = this.validateConfig(definition, (payload as Record<string, unknown>).draft, false);
    const save = async (client: Pick<Prisma.TransactionClient, 'systemSetting'>) => {
      const row = await client.systemSetting.findUnique({ where: { key: this.key(id) } });
      const current = row ? this.readStored(definition, row.value) : this.empty();
      this.assertRevision(current, expectedRevision);
      return this.persist(definition, row, { ...current, draft, revision: current.revision + 1, updatedBy: this.actorName(actor) }, client);
    };
    if (definition.category !== 'connection') return save(this.prisma);
    if (!this.factoryQc) throw new InternalServerErrorException('串口版本服务不可用，未保存配置');
    // Draft creation participates in the same lock as bootstrap, publication and rollback.
    return this.prisma.$transaction(async tx => { await this.factoryQc!.lockSerial(tx); return save(tx); });
  }

  async publish(id: string, payload: unknown, actor: Actor): Promise<GateItem> {
    const definition = this.definition(id);
    const expectedRevision = this.readPayload(payload, false);
    const publishItem = async (client: Pick<Prisma.TransactionClient, 'systemSetting'>) => {
      const row = await client.systemSetting.findUnique({ where: { key: this.key(id) } });
      const current = row ? this.readStored(definition, row.value) : this.empty();
      this.assertRevision(current, expectedRevision);
      if (!current.draft) throw new BadRequestException('请先保存本项草稿，再发布');
      const active = this.validateConfig(definition, current.draft, true);
      if (definition.category === 'connection' && !active.enabled) throw new BadRequestException('串口参数不能单项停用；请通过自动连接项控制连接开关');
      return this.persist(definition, row, {
        ...current, active, draft: null, revision: current.revision + 1,
        updatedBy: this.actorName(actor), publishedAt: new Date().toISOString(),
      }, client);
    };
    if (definition.category !== 'connection') return publishItem(this.prisma);
    if (!this.factoryQc) throw new InternalServerErrorException('串口版本服务不可用，未发布配置');
    return this.prisma.$transaction(async tx => {
      await this.factoryQc!.lockSerial(tx);
      const item = await publishItem(tx);
      const rows = await tx.systemSetting.findMany({ where: { category: GATE_SETTING_CATEGORY, key: { startsWith: GATE_SETTING_PREFIX } } });
      const activeItems: Record<string, GateConfig> = {};
      for (const candidate of GATE_DEFINITIONS.filter(entry => entry.category === 'connection')) {
        const row = rows.find(entry => entry.key === this.key(candidate.id));
        const active = row ? this.readStored(candidate, row.value).active : null;
        if (active?.enabled) activeItems[candidate.id] = active;
      }
      await this.factoryQc!.publishSerialFromActiveItems(tx, activeItems, actor);
      return item;
    });
  }

  private key(id: string) { return `${GATE_SETTING_PREFIX}${id}`; }

  private definition(id: string) {
    const definition = GATE_DEFINITIONS.find((item) => item.id === id);
    if (!definition) throw new NotFoundException('电子闸门配置项不存在');
    return definition;
  }

  private empty(): StoredGate {
    return { schemaVersion: 1, draft: null, active: null, revision: 0, updatedBy: null, publishedAt: null };
  }

  private actorName(actor: Actor): string | null {
    return actor?.name?.trim() || actor?.id || null;
  }

  private readPayload(payload: unknown, hasDraft: boolean): number {
    const keys = hasDraft ? ['expectedRevision', 'draft'] : ['expectedRevision'];
    if (!record(payload) || Object.keys(payload).some((key) => !keys.includes(key)) || !revision(payload.expectedRevision)) {
      throw new BadRequestException('请求格式不正确，必须提供有效的配置版本');
    }
    if (payload.expectedRevision === Number.MAX_SAFE_INTEGER) throw new BadRequestException('配置版本超出有效范围');
    return payload.expectedRevision;
  }

  private validateConfig(definition: GateDefinition, value: unknown, publishing: boolean): GateConfig {
    if (!record(value) || Object.keys(value).some((key) => !CONFIG_KEYS.has(key)) ||
      typeof value.enabled !== 'boolean' || !record(value.values) ||
      !['block', 'warn'].includes(value.failureAction as string)) {
      throw new BadRequestException('配置格式不正确');
    }
    const limits = { model: 200, market: 200, displayName: 120, helpText: 2000 } as const;
    const strings: Record<string, string> = {};
    for (const [key, limit] of Object.entries(limits)) {
      if (typeof value[key] !== 'string' || (value[key] as string).length > limit) {
        throw new BadRequestException(`${key} 必须为不超过 ${limit} 字的文本`);
      }
      strings[key] = (value[key] as string).trim();
    }
    if (publishing && (!strings.displayName || (definition.category !== 'connection' && (!strings.model || !strings.market)))) {
      throw new BadRequestException('发布前请填写适用机型、发货市场和显示名称');
    }
    const fieldMap = new Map(definition.fields.map((field) => [field.key, field]));
    if (Object.keys(value.values).some((key) => !fieldMap.has(key))) throw new BadRequestException('包含当前配置项不支持的字段');
    const values: Record<string, string> = {};
    for (const field of definition.fields) {
      const raw = value.values[field.key] ?? '';
      if (typeof raw !== 'string' || raw.length > 4096) throw new BadRequestException(`${field.label} 必须为不超过 4096 字的文本`);
      const text = raw.trim();
      values[field.key] = text;
      if (!text) {
        if (publishing && field.required) throw new BadRequestException(`发布前请填写「${field.label}」`);
        continue;
      }
      if (field.type === 'select' && !field.options?.some((option) => option.value === text)) {
        throw new BadRequestException(`「${field.label}」的选项无效`);
      }
      if (field.type === 'number') {
        if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) || !Number.isFinite(Number(text))) {
          throw new BadRequestException(`「${field.label}」必须为有效数字`);
        }
        const numeric = Number(text);
        if (field.allowNegative !== true && numeric < 0) throw new BadRequestException(`「${field.label}」不能为负数`);
        if (['timeoutMs', 'retrySeconds', 'observationMs'].includes(field.key) && numeric <= 0) {
          throw new BadRequestException(`「${field.label}」必须大于 0`);
        }
        if ((field.key === 'expected' || field.key === 'timeoutMs') && !Number.isSafeInteger(numeric)) {
          throw new BadRequestException(`「${field.label}」必须为有效整数`);
        }
        if (field.integer && !Number.isSafeInteger(numeric)) throw new BadRequestException(`「${field.label}」必须为有效整数`);
        if (field.min !== undefined && numeric < field.min) throw new BadRequestException(`「${field.label}」不能小于 ${field.min}`);
        if (field.max !== undefined && numeric > field.max) throw new BadRequestException(`「${field.label}」不能大于 ${field.max}`);
        if (field.precision !== undefined && (text.split('.')[1]?.length ?? 0) > field.precision) throw new BadRequestException(`「${field.label}」最多保留 ${field.precision} 位小数`);
      }
    }
    if (publishing) {
      if (values.minimum !== undefined && values.maximum !== undefined) {
        if (Number(values.minimum) > Number(values.maximum) || (values.boundary === 'exclusive' && Number(values.minimum) === Number(values.maximum))) {
          throw new BadRequestException('上下限范围无效；下限不能高于上限，开区间必须有有效范围');
        }
      }
      if (definition.id === 'serial-port' && values.mode === 'fixed' && !values.port) throw new BadRequestException('固定串口模式必须填写串口名称');
      if (values.allowedValues && !values.allowedValues.split(/\r?\n/).some((entry) => entry.trim())) throw new BadRequestException('允许清单不能为空');
    }
    if (definition.id === 'serial-port' && values.port && (!/^COM[1-9][0-9]*$/i.test(values.port) || values.port.length > 16)) throw new BadRequestException('请输入有效的 COM 端口名称，例如 COM3');
    return {
      enabled: value.enabled, model: strings.model, market: strings.market,
      displayName: strings.displayName, helpText: strings.helpText,
      values, failureAction: value.failureAction as GateConfig['failureAction'],
    };
  }

  private readStored(definition: GateDefinition, value: unknown): StoredGate {
    if (!record(value) || value.schemaVersion !== 1 || !revision(value.revision) || value.revision < 1 ||
      !(value.updatedBy === null || typeof value.updatedBy === 'string') ||
      !(value.publishedAt === null || (typeof value.publishedAt === 'string' && Number.isFinite(Date.parse(value.publishedAt)))) ||
      !('draft' in value) || !('active' in value) || (value.draft === null && value.active === null) ||
      ((value.active === null) !== (value.publishedAt === null))) {
      throw new InternalServerErrorException('电子闸门配置数据异常，请联系管理员核查');
    }
    try {
      return {
        schemaVersion: 1, revision: value.revision, updatedBy: value.updatedBy,
        publishedAt: value.publishedAt,
        draft: value.draft === null ? null : this.validateConfig(definition, value.draft, false),
        active: value.active === null ? null : this.validateConfig(definition, value.active, true),
      };
    } catch {
      throw new InternalServerErrorException('电子闸门配置数据异常，请联系管理员核查');
    }
  }

  private assertRevision(current: StoredGate, expected: number) {
    if (current.revision !== expected) throw new ConflictException('本项配置已被其他人更新，请刷新后重试；当前草稿尚未提交');
  }

  private item(definition: GateDefinition, row?: SettingRow): GateItem {
    const stored = row ? this.readStored(definition, row.value) : this.empty();
    return { ...structuredClone(definition), draft: stored.draft, active: stored.active, revision: stored.revision,
      updatedAt: row?.updatedAt.toISOString() ?? null, updatedBy: stored.updatedBy, publishedAt: stored.publishedAt };
  }

  private async persist(definition: GateDefinition, previous: SettingRow | null, stored: StoredGate, client: Pick<Prisma.TransactionClient, 'systemSetting'> = this.prisma): Promise<GateItem> {
    const key = this.key(definition.id);
    const updatedAt = new Date();
    const value = stored as unknown as Prisma.InputJsonValue;
    if (!previous) {
      try {
        const created = await client.systemSetting.create({ data: { key, category: GATE_SETTING_CATEGORY, description: definition.title, value, updatedAt } });
        return this.item(definition, created);
      } catch (error) {
        if ((error as { code?: string })?.code === 'P2002') throw new ConflictException('本项配置已被其他人创建，请刷新后重试');
        throw error;
      }
    }
    // Compare-and-swap in one database statement; separate API processes cannot overwrite one another.
    const result = await client.systemSetting.updateMany({
      where: { key, value: { path: ['revision'], equals: stored.revision - 1 } },
      data: { value, updatedAt },
    });
    if (result.count !== 1) throw new ConflictException('本项配置已被其他人更新，请刷新后重试');
    return this.item(definition, { key, value: stored, updatedAt });
  }
}
