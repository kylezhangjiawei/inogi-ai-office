import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException, ServiceUnavailableException, type OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { PrismaService } from '../../prisma/prisma.service';
import { parseProtocolJson, validateProtocolCatalog, validateSerialConfig, type FactoryCommand, type FactoryProtocolCatalog, type FactorySerialConfig } from './factory-qc.contract';
import { FACTORY_PROTOCOL_DEFAULT, FACTORY_SERIAL_DEFAULT } from './factory-qc.defaults';
import { protocolPublicationIssues } from './factory-qc.release';
import { GATE_DEFINITIONS, GATE_SETTING_CATEGORY, GATE_SETTING_PREFIX, type GateConfig } from './electronic-gate.catalog';
import type { FactoryQcActor, FactoryQcCommandState, FactoryQcHistoryEntry, FactoryQcHistoryVersion, FactoryQcKind, FactoryQcManagementState, FactoryQcProtocolStatus, FactoryQcSerialStatus } from './factory-qc.management';
import { FACTORY_SERIAL_ITEM_IDS, serialFromItems, serialToItemValues } from './factory-qc.serial';
export { FACTORY_SERIAL_ITEM_IDS } from './factory-qc.serial';

type Tx = Prisma.TransactionClient;
type ProtocolState = FactoryQcProtocolStatus & { schemaVersion: 1 };
type SerialState = FactoryQcSerialStatus & { schemaVersion: 1 };
type Snapshot = FactoryQcHistoryVersion & { activeItems?: Record<string, GateConfig> };
const CATEGORY = 'factory-qc';
const serialIds = new Set<string>(FACTORY_SERIAL_ITEM_IDS);
const stateKey = (kind: FactoryQcKind) => `factory-qc.${kind}.management`;
const historyKey = (kind: FactoryQcKind, version: string) => `factory-qc.${kind}.history.${encodeURIComponent(version)}`;
const commandKey = (profile: string, command: string) => JSON.stringify([profile, command]);
// PostgreSQL JSONB does not preserve object key order; array order remains significant.
const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function expected(payload: unknown, keys: string[]): Record<string, unknown> & { expectedRevision: number } {
  if (!object(payload) || Object.keys(payload).some(key => !keys.includes(key)) || !Number.isSafeInteger(payload.expectedRevision) || Number(payload.expectedRevision) < 0 || Number(payload.expectedRevision) >= Number.MAX_SAFE_INTEGER) {
    throw new BadRequestException('必须提供有效的当前版本及受支持的配置字段');
  }
  return payload as Record<string, unknown> & { expectedRevision: number };
}
function assertRevision(actual: number, value: number) { if (actual !== value) throw new ConflictException('配置已更新，请重新加载并核对后操作；本次修改未写入'); }
function actorName(actor: FactoryQcActor) { return actor.name?.trim() || actor.id || null; }
function validate<T>(operation: () => T): T {
  try { return operation(); } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '配置校验失败'); }
}

/** Published-only serial projection. Management fields never enter this object. */
export function serialConfigFromActiveItems(items: Record<string, GateConfig>, version: string): FactorySerialConfig | null {
  return validate(() => serialFromItems(items, version));
}

@Injectable()
export class FactoryQcService implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  /** Prisma has connected during module initialization before application bootstrap runs. */
  async onApplicationBootstrap(): Promise<void> { await this.initializeDefaults(); }

  /** Seed only entirely new domains. Any existing state, draft, item or history is preserved. */
  async initializeDefaults(): Promise<{ protocol: 'initialized' | 'preserved'; serial: 'initialized' | 'preserved' }> {
    const protocol = await this.prisma.$transaction(async tx => {
      await this.lock(tx, 'protocol');
      const rows = await tx.systemSetting.findMany({ where: { key: { startsWith: 'factory-qc.protocol.' } } });
      if (rows.length) return 'preserved' as const;
      const catalog = validateProtocolCatalog(structuredClone(FACTORY_PROTOCOL_DEFAULT));
      this.assertPublishable(catalog);
      const state = this.emptyProtocol();
      state.revision = 1;
      await this.addSnapshot(tx, 'protocol', catalog, state.revision, { name: '系统默认初始化' }, '首次初始化已确认的读取协议（不含质检放行标准）', state.history);
      state.commands = this.syncCommands([], catalog);
      state.active = catalog;
      await this.writeState(tx, 'protocol', state);
      return 'initialized' as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    const serial = await this.prisma.$transaction(async tx => {
      await this.lock(tx, 'serial');
      const managementRows = await tx.systemSetting.findMany({ where: { key: { startsWith: 'factory-qc.serial.' } } });
      const itemRows = await tx.systemSetting.findMany({ where: { key: { in: FACTORY_SERIAL_ITEM_IDS.map(id => `${GATE_SETTING_PREFIX}${id}`) } } });
      if (managementRows.length || itemRows.length) return 'preserved' as const;
      const content = validateSerialConfig(structuredClone(FACTORY_SERIAL_DEFAULT));
      const values = serialToItemValues(content);
      const activeItems: Record<string, GateConfig> = {};
      const publishedAt = new Date().toISOString();
      for (const id of FACTORY_SERIAL_ITEM_IDS) {
        const definition = GATE_DEFINITIONS.find(item => item.id === id && item.category === 'connection');
        if (!definition) throw new InternalServerErrorException(`默认串口配置项缺失：${id}`);
        const active: GateConfig = { ...structuredClone(definition.defaults), enabled: true,
          values: { ...definition.defaults.values, ...values[id], evidence: 'FactoryQc v0.5.2 已确认默认串口配置' } };
        activeItems[id] = active;
        await tx.systemSetting.create({ data: {
          key: `${GATE_SETTING_PREFIX}${id}`, category: GATE_SETTING_CATEGORY, description: definition.title,
          value: { schemaVersion: 1, draft: null, active, revision: 1, updatedBy: '系统默认初始化', publishedAt } as unknown as Prisma.InputJsonValue,
        } });
      }
      if (!same(serialConfigFromActiveItems(activeItems, content.version), content)) throw new InternalServerErrorException('默认串口配置与独立配置项不一致');
      const state = this.emptySerial();
      state.revision = 1; state.readyCount = FACTORY_SERIAL_ITEM_IDS.length; state.active = content;
      await this.addSnapshot(tx, 'serial', content, state.revision, { name: '系统默认初始化' }, '首次初始化完整默认串口参数', state.history, activeItems);
      await this.writeState(tx, 'serial', state);
      return 'initialized' as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return { protocol, serial };
  }

  async lockSerial(tx: Tx) { await this.lock(tx, 'serial'); }
  private async lock(tx: Tx, kind: FactoryQcKind) {
    // PostgreSQL transaction locks serialize all application processes, including first creation.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-qc:${kind}`}))`;
  }
  private emptyProtocol(): ProtocolState { return { schemaVersion: 1, revision: 0, active: null, draft: null, draftBaseVersion: null, commands: [], history: [] }; }
  private emptySerial(): SerialState { return { schemaVersion: 1, revision: 0, active: null, readyCount: 0, totalCount: FACTORY_SERIAL_ITEM_IDS.length, history: [] }; }
  private async readState(db: Pick<Tx, 'systemSetting'>, kind: 'protocol'): Promise<ProtocolState>;
  private async readState(db: Pick<Tx, 'systemSetting'>, kind: 'serial'): Promise<SerialState>;
  private async readState(db: Pick<Tx, 'systemSetting'>, kind: FactoryQcKind): Promise<ProtocolState | SerialState>;
  private async readState(db: Pick<Tx, 'systemSetting'>, kind: FactoryQcKind): Promise<ProtocolState | SerialState> {
    const row = await db.systemSetting.findUnique({ where: { key: stateKey(kind) } });
    if (!row) return kind === 'protocol' ? this.emptyProtocol() : this.emptySerial();
    const state = row.value;
    if (!object(state) || state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || !Array.isArray(state.history) || (kind === 'protocol' && !Array.isArray(state.commands))) {
      throw new InternalServerErrorException('工厂质检配置存储异常，请联系管理员核查');
    }
    return structuredClone(state) as unknown as ProtocolState | SerialState;
  }
  private async writeState(tx: Tx, kind: FactoryQcKind, state: ProtocolState | SerialState) {
    const data = { category: CATEGORY, value: state as unknown as Prisma.InputJsonValue, description: `Factory QC ${kind} 管理状态` };
    await tx.systemSetting.upsert({ where: { key: stateKey(kind) }, create: { key: stateKey(kind), ...data }, update: data });
  }
  async getState(): Promise<FactoryQcManagementState> {
    const [protocol, serial] = await Promise.all([this.readState(this.prisma, 'protocol'), this.readState(this.prisma, 'serial')]);
    this.ensureInitialDraftCommands(protocol);
    const serialRows = await this.prisma.systemSetting.findMany({ where: { category: GATE_SETTING_CATEGORY, key: { startsWith: GATE_SETTING_PREFIX } } });
    serial.readyCount = serialRows.filter(row => serialIds.has(row.key.slice(GATE_SETTING_PREFIX.length)) && object(row.value) && object(row.value.active) && row.value.active.enabled === true).length;
    const { schemaVersion: _p, ...protocolStatus } = protocol;
    const { schemaVersion: _s, ...serialStatus } = serial;
    return { protocol: protocolStatus, serial: serialStatus };
  }
  example() { return structuredClone(FACTORY_PROTOCOL_DEFAULT); }
  async downloadProtocol(): Promise<FactoryProtocolCatalog> {
    const state = await this.readState(this.prisma, 'protocol');
    if (!state.active) throw new ServiceUnavailableException('协议目录尚未发布');
    return validateProtocolCatalog(state.active);
  }
  async downloadSerial(): Promise<FactorySerialConfig> {
    const state = await this.readState(this.prisma, 'serial');
    if (!state.active) throw new ServiceUnavailableException('串口参数尚未全部发布');
    return validateSerialConfig(state.active);
  }
  private async transaction(kind: FactoryQcKind, operation: (tx: Tx) => Promise<void>) {
    await this.prisma.$transaction(async tx => { await this.lock(tx, kind); await operation(tx); }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return this.getState();
  }
  async saveCatalogDraft(payload: unknown): Promise<FactoryQcManagementState> {
    const input = expected(payload, ['expectedRevision', 'catalog', 'json']);
    if (('catalog' in input) === ('json' in input)) throw new BadRequestException('请提供完整目录或原始 JSON 文本中的一种');
    const catalog = validate(() => 'json' in input ? parseProtocolJson(input.json as string) : validateProtocolCatalog(input.catalog));
    return this.transaction('protocol', async tx => {
      const state = await this.readState(tx, 'protocol');
      assertRevision(state.revision, input.expectedRevision);
      state.draft = catalog; state.draftBaseVersion = state.active?.version ?? null; state.revision++;
      if (!state.active) state.commands = this.initialDraftCommands(state.commands, catalog);
      await this.writeState(tx, 'protocol', state);
    });
  }
  async publishCatalog(payload: unknown, actor: FactoryQcActor) {
    const input = expected(payload, ['expectedRevision']);
    return this.transaction('protocol', async tx => {
      const state = await this.readState(tx, 'protocol');
      assertRevision(state.revision, input.expectedRevision);
      if (!state.draft) throw new BadRequestException('请先显式导入并校验完整目录草稿');
      if (state.draftBaseVersion !== (state.active?.version ?? null)) throw new ConflictException('已发布目录已变化，请重新核对并保存整包草稿');
      const catalog = validate(() => validateProtocolCatalog(state.draft));
      this.assertPublishable(catalog);
      state.revision++;
      await this.addSnapshot(tx, 'protocol', catalog, state.revision, actor, '完整目录发布', state.history);
      const wasInitial = !state.active;
      state.commands = this.syncCommands(state.commands, catalog);
      if (wasInitial) state.commands = state.commands.map(command => ({ ...command, draft: null }));
      state.active = catalog; state.draft = null; state.draftBaseVersion = null;
      await this.writeState(tx, 'protocol', state);
    });
  }
  private locate(state: ProtocolState, profileId: string, commandId: string, allowInitial = false): FactoryQcCommandState {
    if (!state.active && !allowInitial) throw new BadRequestException('首版须先发布完整协议目录，不能单独发布命令');
    if (!state.active && !state.draft) throw new BadRequestException('请先保存完整目录草稿，再逐项维护读取配置');
    if (!state.active) this.ensureInitialDraftCommands(state);
    const catalog = state.active ?? state.draft!;
    const exists = catalog.profiles.some(profile => profile.id === profileId && profile.commands.some(command => command.id === commandId));
    const target = state.commands.find(command => command.profileId === profileId && command.commandId === commandId && (command.active || (allowInitial && !state.active && command.draft)));
    if (!exists || !target) throw new NotFoundException('当前目录中不存在该命令；新增固件或命令请使用完整目录草稿');
    return target;
  }
  private withCommand(catalog: FactoryProtocolCatalog, profileId: string, commandId: string, command: unknown): FactoryProtocolCatalog {
    if (!object(command) || command.id !== commandId) throw new BadRequestException('单项编辑不能改变命令 ID');
    const candidate = structuredClone(catalog);
    const profile = candidate.profiles.find(item => item.id === profileId)!;
    profile.commands = profile.commands.map(item => item.id === commandId ? command as unknown as FactoryCommand : item);
    return validate(() => validateProtocolCatalog(candidate));
  }
  async saveCommandDraft(profileId: string, commandId: string, payload: unknown) {
    const input = expected(payload, ['expectedRevision', 'command']);
    return this.transaction('protocol', async tx => {
      const state = await this.readState(tx, 'protocol');
      const target = this.locate(state, profileId, commandId, true);
      assertRevision(target.revision, input.expectedRevision);
      const validated = this.withCommand(state.active ?? state.draft!, profileId, commandId, input.command);
      target.draft = validated.profiles.find(profile => profile.id === profileId)!.commands.find(command => command.id === commandId)!;
      target.revision++; state.revision++;
      if (!state.active) state.draft = validated;
      await this.writeState(tx, 'protocol', state);
    });
  }
  async publishCommand(profileId: string, commandId: string, payload: unknown, actor: FactoryQcActor) {
    const input = expected(payload, ['expectedRevision']);
    return this.transaction('protocol', async tx => {
      const state = await this.readState(tx, 'protocol');
      const target = this.locate(state, profileId, commandId);
      assertRevision(target.revision, input.expectedRevision);
      if (!target.draft) throw new BadRequestException('请先保存本命令草稿');
      // Only this draft is overlaid; every other command comes from the current published snapshot.
      const catalog = this.withCommand(state.active!, profileId, commandId, target.draft);
      state.revision++;
      catalog.version = this.nextVersion('protocol', state.revision, state.history);
      this.assertPublishable(catalog);
      await this.addSnapshot(tx, 'protocol', catalog, state.revision, actor, `单项命令 ${profileId}/${commandId}`, state.history);
      state.commands = this.syncCommands(state.commands, catalog, commandKey(profileId, commandId));
      state.active = catalog;
      await this.writeState(tx, 'protocol', state);
    });
  }
  private syncCommands(previous: FactoryQcCommandState[], catalog: FactoryProtocolCatalog, clearDraftKey?: string): FactoryQcCommandState[] {
    const remaining = new Map(previous.map(item => [commandKey(item.profileId, item.commandId), item]));
    const result: FactoryQcCommandState[] = [];
    for (const profile of catalog.profiles) for (const command of profile.commands) {
      const key = commandKey(profile.id, command.id), old = remaining.get(key);
      result.push({ profileId: profile.id, commandId: command.id, active: structuredClone(command),
        revision: old ? old.revision + (!same(old.active, command) || key === clearDraftKey ? 1 : 0) : 1,
        draft: key === clearDraftKey ? null : old?.draft ?? null });
      remaining.delete(key);
    }
    // Keep detached drafts visible in management state; an explicit full import never erases another editor's draft.
    for (const old of remaining.values()) if (old.draft) result.push({ ...old, active: null, revision: old.revision + 1 });
    return result;
  }
  private assertPublishable(catalog: FactoryProtocolCatalog) {
    const issues = protocolPublicationIssues(catalog);
    if (issues.length) throw new BadRequestException(issues.join('；'));
  }
  private initialDraftCommands(previous: FactoryQcCommandState[], catalog: FactoryProtocolCatalog): FactoryQcCommandState[] {
    const remaining = new Map(previous.map(command => [commandKey(command.profileId, command.commandId), command]));
    const commands: FactoryQcCommandState[] = [];
    for (const profile of catalog.profiles) for (const command of profile.commands) {
      const key = commandKey(profile.id, command.id), old = remaining.get(key);
      commands.push({ profileId: profile.id, commandId: command.id, revision: (old?.revision ?? 0) + 1, active: null, draft: structuredClone(command) });
      remaining.delete(key);
    }
    // Retain revision tombstones so removing and re-adding an id never revives an old edit.
    for (const old of remaining.values()) commands.push({ ...old, active: null, draft: null, revision: old.revision + 1 });
    return commands;
  }
  private ensureInitialDraftCommands(state: ProtocolState) {
    if (state.active || !state.draft) return;
    for (const profile of state.draft.profiles) for (const command of profile.commands) {
      if (!state.commands.some(item => item.profileId === profile.id && item.commandId === command.id)) {
        state.commands.push({ profileId: profile.id, commandId: command.id, revision: 0, active: null, draft: structuredClone(command) });
      }
    }
  }
  private nextVersion(kind: FactoryQcKind, revision: number, history: FactoryQcHistoryEntry[]) {
    const base = `${kind}-${revision}`;
    let result = base, suffix = 1;
    while (history.some(item => item.version === result)) result = `${base}-${suffix++}`;
    return result;
  }
  private async addSnapshot(tx: Tx, kind: FactoryQcKind, content: FactorySerialConfig | FactoryProtocolCatalog, revision: number, actor: FactoryQcActor, reason: string, history: FactoryQcHistoryEntry[], activeItems?: Record<string, GateConfig>) {
    if (history.some(item => item.version === content.version)) throw new ConflictException('该版本号已有不可变快照，请填写新的版本号；恢复旧内容请使用回滚');
    const entry: FactoryQcHistoryEntry = { version: content.version, revision, publishedAt: new Date().toISOString(), publishedBy: actorName(actor), reason };
    const snapshot: Snapshot = { ...entry, kind, content: structuredClone(content), ...(activeItems ? { activeItems: structuredClone(activeItems) } : {}) };
    await tx.systemSetting.create({ data: { key: historyKey(kind, content.version), category: CATEGORY, description: `Factory QC ${kind} ${content.version}`, value: snapshot as unknown as Prisma.InputJsonValue } });
    history.unshift(entry);
  }
  /** Caller must acquire lockSerial before modifying any individual serial row. */
  async publishSerialFromActiveItems(tx: Tx, items: Record<string, GateConfig>, actor: FactoryQcActor): Promise<FactoryQcSerialStatus> {
    const state = await this.readState(tx, 'serial');
    state.revision++;
    state.readyCount = FACTORY_SERIAL_ITEM_IDS.filter(id => items[id]?.enabled === true).length;
    const content = serialConfigFromActiveItems(items, this.nextVersion('serial', state.revision, state.history));
    if (content) {
      const activeItems = Object.fromEntries(FACTORY_SERIAL_ITEM_IDS.map(id => [id, structuredClone(items[id])]));
      await this.addSnapshot(tx, 'serial', content, state.revision, actor, '独立串口参数发布', state.history, activeItems);
      state.active = content;
    }
    await this.writeState(tx, 'serial', state);
    const { schemaVersion: _, ...status } = state;
    return status;
  }
  private kind(value: unknown): FactoryQcKind {
    if (value !== 'serial' && value !== 'protocol') throw new BadRequestException('请选择串口参数或协议目录');
    return value;
  }
  async history(kind: unknown) { return (await this.readState(this.prisma, this.kind(kind))).history; }
  private async snapshot(db: Pick<Tx, 'systemSetting'>, kind: FactoryQcKind, version: string): Promise<Snapshot> {
    const row = await db.systemSetting.findUnique({ where: { key: historyKey(kind, version) } });
    if (!row) throw new NotFoundException('未找到该历史版本');
    const value = row.value as unknown as Snapshot;
    if (value.kind !== kind || value.version !== version || value.content?.version !== version) throw new InternalServerErrorException('历史快照异常');
    return structuredClone(value);
  }
  async historyVersion(kind: unknown, version: string): Promise<FactoryQcHistoryVersion> {
    const { activeItems: _, ...snapshot } = await this.snapshot(this.prisma, this.kind(kind), version);
    return snapshot;
  }
  async rollback(payload: unknown, actor: FactoryQcActor) {
    const input = expected(payload, ['kind', 'version', 'expectedRevision']);
    const kind = this.kind(input.kind);
    if (typeof input.version !== 'string' || !input.version.trim()) throw new BadRequestException('请指定历史版本');
    const version = input.version;
    return this.transaction(kind, async tx => {
      const snapshot = await this.snapshot(tx, kind, version);
      if (kind === 'protocol') {
        const state = await this.readState(tx, 'protocol'); assertRevision(state.revision, input.expectedRevision);
        const content = validate(() => validateProtocolCatalog(snapshot.content));
        this.assertPublishable(content);
        state.commands = this.syncCommands(state.commands, content); state.active = content; state.revision++;
        await this.writeState(tx, kind, state);
      } else {
        const state = await this.readState(tx, 'serial'); assertRevision(state.revision, input.expectedRevision);
        const content = validate(() => validateSerialConfig(snapshot.content));
        if (!snapshot.activeItems || FACTORY_SERIAL_ITEM_IDS.some(id => !snapshot.activeItems![id])) throw new ConflictException('该历史版本缺少独立配置项，不能安全回滚');
        const items = snapshot.activeItems;
        if (!same(serialConfigFromActiveItems(items, content.version), content)) throw new ConflictException('历史串口项目与快照不一致，不能安全回滚');
        const rows = await tx.systemSetting.findMany({ where: { category: GATE_SETTING_CATEGORY, key: { startsWith: GATE_SETTING_PREFIX } } });
        const byId = new Map(rows.map(row => [row.key.slice(GATE_SETTING_PREFIX.length), row]));
        for (const id of serialIds) {
          const row = byId.get(id);
          if (!row || !object(row.value) || !Number.isSafeInteger(row.value.revision)) throw new ConflictException('独立串口配置项缺失，无法同步回滚');
          const result = await tx.systemSetting.updateMany({ where: { key: row.key, value: { path: ['revision'], equals: row.value.revision as number } }, data: { value: { ...row.value, active: items[id], revision: Number(row.value.revision) + 1, publishedAt: new Date().toISOString(), updatedBy: actorName(actor) } as unknown as Prisma.InputJsonValue } });
          if (result.count !== 1) throw new ConflictException('串口草稿在回滚过程中已被修改，本次回滚未生效，请重新加载后操作');
        }
        state.active = content; state.readyCount = FACTORY_SERIAL_ITEM_IDS.length; state.revision++;
        await this.writeState(tx, kind, state);
      }
    });
  }
}
