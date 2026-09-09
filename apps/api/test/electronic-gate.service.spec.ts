import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { Reflector } from '@nestjs/core';
import { ElectronicGateService } from '../src/modules/electronic-gate/electronic-gate.service';
import { ElectronicGateController } from '../src/modules/electronic-gate/electronic-gate.controller';
import { GATE_DEFINITIONS, GATE_SETTING_PREFIX, type GateConfig } from '../src/modules/electronic-gate/electronic-gate.catalog';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { DEFAULT_PERMISSION_CATALOG } from '../src/modules/permission-catalog/permission-catalog.defaults';

type Row = { key: string; category: string; value: any; updatedAt: Date };
const actor = { id: 'test-user', name: '配置测试员' };

/** Emulates the two atomic database primitives used by the service. No database or network is used. */
function fixture() {
  const rows = new Map<string, Row>();
  const model = {
    async findMany({ where }: any) {
      return structuredClone([...rows.values()].filter((row) => row.category === where.category && row.key.startsWith(where.key.startsWith)));
    },
    async findUnique({ where }: any) { return structuredClone(rows.get(where.key) ?? null); },
    async create({ data }: any) {
      if (rows.has(data.key)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
      rows.set(data.key, structuredClone(data));
      return structuredClone(data);
    },
    async updateMany({ where, data }: any) {
      const current = rows.get(where.key);
      assert.deepEqual(where.value.path, ['revision']);
      if (!current || current.value.revision !== where.value.equals) return { count: 0 };
      rows.set(where.key, structuredClone({ ...current, ...data }));
      return { count: 1 };
    },
  };
  const publications: Array<Record<string, GateConfig>> = [];
  const client = { systemSetting: model, async $transaction(work: (tx: any) => Promise<any>) {
    const previous = structuredClone([...rows]);
    try { return await work(client); }
    catch (error) { rows.clear(); for (const [key, row] of previous) rows.set(key, row); throw error; }
  } };
  const factory = { async lockSerial() {}, async publishSerialFromActiveItems(_tx: unknown, items: Record<string, GateConfig>) { publications.push(structuredClone(items)); } };
  return { rows, model, factory, publications, service: new ElectronicGateService(client as any, factory as any) };
}

function config(id: string, complete = false): GateConfig {
  const definition = GATE_DEFINITIONS.find((item) => item.id === id)!;
  const result = structuredClone(definition.defaults);
  if (!complete) return result;
  result.model = 'TEST-MODEL';
  result.market = 'TEST-MARKET';
  for (const field of definition.fields) {
    result.values[field.key] = field.type === 'select' ? field.options![0].value
      : field.type === 'number' ? String(field.min ?? (field.key === 'minimum' ? 0 : 10))
        : '测试规范 Q-001';
  }
  if (id === 'serial-port') result.values.port = 'COM3';
  return result;
}
const hasStatus = (status: number) => (error: any) => error?.getStatus?.() === status;

test('目录保留22个原始检测编号；所有49项均未发布，参考数值不作为有效规则', async () => {
  const { service, rows } = fixture();
  const { items } = await service.list();
  assert.equal(items.length, 49);
  assert.equal(new Set(items.map((item) => item.id)).size, 49);
  assert.equal(items.filter((item) => item.category === 'critical').length, 11);
  assert.equal(items.filter((item) => item.category === 'routine').length, 11);
  assert.equal(items.filter((item) => item.category === 'manual').length, 5);
  assert.equal(items.filter((item) => item.category === 'connection').length, 12);
  assert.equal(items.filter((item) => item.category === 'command').length, 10);
  assert.deepEqual(items.filter((item) => ['critical', 'routine'].includes(item.category)).map((item) => item.number).sort(), Array.from({ length: 22 }, (_, i) => String(i + 1).padStart(2, '0')));
  for (const item of items) assert.deepEqual([item.revision, item.draft, item.active, item.publishedAt], [0, null, null, null]);
  assert.equal(items.find((item) => item.id === 'default-sensitivity')?.defaults.values.expected, '3');
  assert.equal(items.find((item) => item.id === 'response-timeout')?.defaults.values.timeoutMs, '1500');
  assert.equal(rows.size, 0, 'GET 不得创建隐式已配置记录');
});

test('单项保存独立落库、可重新读取，保持另一项和参考模板不变', async () => {
  const { service, rows } = fixture();
  const draft = config('debug-status');
  draft.helpText = '单项草稿';
  const saved = await service.saveDraft('debug-status', { expectedRevision: 0, draft }, actor);
  assert.equal(saved.revision, 1);
  assert.equal(saved.updatedBy, actor.name);
  assert.equal(saved.active, null);
  assert.equal(rows.size, 1);
  const { items } = await service.list();
  assert.equal(items.find((item) => item.id === 'debug-status')?.draft?.helpText, '单项草稿');
  assert.equal(items.find((item) => item.id === 'alarm-status')?.revision, 0);
  assert.notEqual(GATE_DEFINITIONS.find((item) => item.id === 'debug-status')?.defaults.helpText, '单项草稿');
});

test('业务规则发布要求已保存且完整的草稿，不会将默认目标直接发布', async () => {
  const { service } = fixture();
  await assert.rejects(service.publish('debug-status', { expectedRevision: 0 }, actor), hasStatus(400));
  await service.saveDraft('debug-status', { expectedRevision: 0, draft: config('debug-status') }, actor);
  await assert.rejects(service.publish('debug-status', { expectedRevision: 1 }, actor), hasStatus(400));
  const current = (await service.list()).items.find((item) => item.id === 'debug-status')!;
  assert.equal(current.active, null);
  assert.equal(current.revision, 1);
});

test('发布只替换本项active，新草稿不会改变已发布快照', async () => {
  const { service } = fixture();
  const original = config('debug-status', true);
  await service.saveDraft('debug-status', { expectedRevision: 0, draft: original }, actor);
  const published = await service.publish('debug-status', { expectedRevision: 1 }, actor);
  assert.deepEqual(published.active, original);
  assert.equal(published.draft, null);
  assert.equal(published.revision, 2);
  assert.ok(published.publishedAt);
  const next = { ...original, enabled: false };
  const saved = await service.saveDraft('debug-status', { expectedRevision: 2, draft: next }, actor);
  assert.equal(saved.draft?.enabled, false);
  assert.equal(saved.active?.enabled, true);
  assert.equal(saved.publishedAt, published.publishedAt);
  const disabled = await service.publish('debug-status', { expectedRevision: 3 }, actor);
  assert.equal(disabled.active?.enabled, false);
});

test('并行首次创建和并行更新都仅成功一次，旧版本发布也返回409', async () => {
  const { service } = fixture();
  const draft = config('debug-status', true);
  const creates = await Promise.allSettled([
    service.saveDraft('debug-status', { expectedRevision: 0, draft }, actor),
    service.saveDraft('debug-status', { expectedRevision: 0, draft }, actor),
  ]);
  assert.equal(creates.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal((creates.find((item) => item.status === 'rejected') as PromiseRejectedResult).reason.getStatus(), 409);
  const updates = await Promise.allSettled([
    service.saveDraft('debug-status', { expectedRevision: 1, draft: { ...draft, helpText: 'edit A' } }, actor),
    service.saveDraft('debug-status', { expectedRevision: 1, draft: { ...draft, helpText: 'edit B' } }, actor),
  ]);
  assert.equal(updates.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal((updates.find((item) => item.status === 'rejected') as PromiseRejectedResult).reason.getStatus(), 409);
  await assert.rejects(service.publish('debug-status', { expectedRevision: 1 }, actor), hasStatus(409));
  assert.equal((await service.list()).items.find((item) => item.id === 'debug-status')?.revision, 2);
});

test('数值、枚举、未知字段及版本被校验，非法请求不会写入', async () => {
  const { service, rows } = fixture();
  for (const bad of ['NaN', 'Infinity', '1e309', '12ms', '-1', '0', '1.5']) {
    const draft = config('response-timeout', true);
    draft.values.timeoutMs = bad;
    await assert.rejects(service.saveDraft('response-timeout', { expectedRevision: 0, draft }, actor), hasStatus(400));
  }
  const badEnum = config('debug-status', true);
  badEnum.values.operator = 'always-pass';
  await assert.rejects(service.saveDraft('debug-status', { expectedRevision: 0, draft: badEnum }, actor), hasStatus(400));
  const badField = config('debug-status', true);
  badField.values.externalCommand = 'unexpected';
  await assert.rejects(service.saveDraft('debug-status', { expectedRevision: 0, draft: badField }, actor), hasStatus(400));
  await assert.rejects(service.saveDraft('debug-status', { expectedRevision: -1, draft: config('debug-status') }, actor), hasStatus(400));
  await assert.rejects(service.saveDraft('debug-status', { expectedRevision: 0, draft: { ...config('debug-status'), active: true } }, actor), hasStatus(400));
  await assert.rejects(service.saveDraft('../settings', { expectedRevision: 0, draft: config('debug-status') }, actor), hasStatus(404));
  assert.equal(rows.size, 0);
});

test('微压差与两项温度显式允许负区间，保存发布及重新读取保留原始值', async () => {
  const { service } = fixture();
  for (const id of ['v-pressure', 'internal-temperature', 'v-pressure-temperature']) {
    const draft = config(id, true);
    draft.values.minimum = '-10.5'; draft.values.maximum = '-2';
    const saved = await service.saveDraft(id, { expectedRevision: 0, draft }, actor);
    assert.equal(saved.draft?.values.minimum, '-10.5');
    assert.equal(saved.draft?.values.maximum, '-2');
    const published = await service.publish(id, { expectedRevision: 1 }, actor);
    assert.deepEqual(published.active, draft);
    assert.deepEqual((await service.list()).items.find(item => item.id === id)?.active, draft);
  }
  const signedFields = GATE_DEFINITIONS.flatMap(definition => definition.fields.filter(field => field.allowNegative).map(field => `${definition.id}.${field.key}`)).sort();
  assert.deepEqual(signedFields, ['internal-temperature.maximum', 'internal-temperature.minimum', 'v-pressure-temperature.maximum', 'v-pressure-temperature.minimum', 'v-pressure.maximum', 'v-pressure.minimum'].sort());
});

test('绝对压力、转速、计数等级及使用时长仍拒绝负数，单位不能代替许可元数据', async () => {
  const { service, rows } = fixture();
  for (const [id, key] of [['startup-pressure', 'minimum'], ['sensor-pressure', 'minimum'], ['compressor-speed', 'minimum'], ['built-in-parameters', 'time310'], ['total-usage', 'maximum'], ['button-volume', 'expected'], ['default-sensitivity', 'expected'], ['compressor-recovery', 'observationMs']]) {
    const draft = config(id, true); draft.values[key] = '-1';
    await assert.rejects(service.saveDraft(id, { expectedRevision: 0, draft }, actor), (error: any) => error?.getStatus?.() === 400 && /不能为负数/.test(error.message));
  }
  assert.equal(rows.size, 0);
  const definition = GATE_DEFINITIONS.find(item => item.id === 'v-pressure')!;
  const draft = config('v-pressure', true); draft.values.minimum = '-10'; draft.values.maximum = '-2';
  const validate = (service as any).validateConfig.bind(service);
  const renamedUnit = structuredClone(definition);
  for (const field of renamedUnit.fields) if (field.type === 'number') field.unit = '待确认';
  assert.deepEqual(validate(renamedUnit, draft, true), draft);
  const unsigned = structuredClone(definition);
  for (const field of unsigned.fields) { delete field.allowNegative; field.unit = '°C'; }
  assert.throws(() => validate(unsigned, draft, true), /不能为负数/);
});

test('微压负区间仍检查上下限与开区间，目录提示不填入未知标准或改写已有配置', async () => {
  const { service, rows } = fixture();
  const draft = config('v-pressure', true);
  draft.displayName = '已有自定义微压名称'; draft.helpText = '已有验证说明';
  draft.values.minimum = '-2'; draft.values.maximum = '-10';
  await service.saveDraft('v-pressure', { expectedRevision: 0, draft }, actor);
  await assert.rejects(service.publish('v-pressure', { expectedRevision: 1 }, actor), hasStatus(400));
  draft.values.minimum = '-10'; draft.values.boundary = 'exclusive';
  await service.saveDraft('v-pressure', { expectedRevision: 1, draft }, actor);
  await assert.rejects(service.publish('v-pressure', { expectedRevision: 2 }, actor), hasStatus(400));
  draft.values.maximum = '2';
  await service.saveDraft('v-pressure', { expectedRevision: 2, draft }, actor);
  await service.publish('v-pressure', { expectedRevision: 3 }, actor);
  const newer = structuredClone(draft); newer.values.maximum = '3';
  await service.saveDraft('v-pressure', { expectedRevision: 4, draft: newer }, actor);
  const stored = structuredClone([...rows]);
  const item = (await service.list()).items.find(item => item.id === 'v-pressure')!;
  assert.deepEqual(item.active, draft);
  assert.deepEqual(item.draft, newer);
  assert.deepEqual([...rows], stored, '读取更新后的目录提示不得写入 active/draft');
  assert.equal(item.defaults.values.minimum, '');
  assert.equal(item.defaults.values.maximum, '');
  assert.equal(item.defaults.values.measurementUnit, '');
  assert.equal(item.defaults.values.readbackSource, '');
  for (const field of item.fields.filter(field => field.type === 'number')) { assert.equal(field.min, undefined); assert.equal(field.max, undefined); }
});

test('发布严格检查上下限、开区间边界、空白依据与固定串口；失败保持草稿', async () => {
  const { service } = fixture();
  let draft = config('startup-pressure', true);
  draft.values.minimum = '12';
  draft.values.maximum = '10';
  await service.saveDraft('startup-pressure', { expectedRevision: 0, draft }, actor);
  await assert.rejects(service.publish('startup-pressure', { expectedRevision: 1 }, actor), hasStatus(400));
  draft.values.minimum = '10';
  draft.values.boundary = 'exclusive';
  await service.saveDraft('startup-pressure', { expectedRevision: 1, draft }, actor);
  await assert.rejects(service.publish('startup-pressure', { expectedRevision: 2 }, actor), hasStatus(400));
  draft = config('debug-status', true);
  draft.values.evidence = '  \n ';
  await service.saveDraft('debug-status', { expectedRevision: 0, draft }, actor);
  await assert.rejects(service.publish('debug-status', { expectedRevision: 1 }, actor), hasStatus(400));
  draft = config('serial-port', true);
  draft.values.mode = 'fixed';
  draft.values.port = '';
  await service.saveDraft('serial-port', { expectedRevision: 0, draft }, actor);
  await assert.rejects(service.publish('serial-port', { expectedRevision: 1 }, actor), hasStatus(400));
});

test('完整配置可以逐项发布49个模板，互相不覆盖', async () => {
  const { service, rows } = fixture();
  for (const definition of GATE_DEFINITIONS) {
    await service.saveDraft(definition.id, { expectedRevision: 0, draft: config(definition.id, true) }, actor);
    const published = await service.publish(definition.id, { expectedRevision: 1 }, actor);
    assert.equal(published.revision, 2);
    assert.ok(published.active);
  }
  assert.equal(rows.size, 49);
  assert.equal((await service.list()).items.filter((item) => item.active).length, 49);
});

test('数据库失败与存储损坏显式报错，不能伪装成默认配置加载成功', async () => {
  const { service, rows, model } = fixture();
  rows.set(`${GATE_SETTING_PREFIX}debug-status`, { key: `${GATE_SETTING_PREFIX}debug-status`, category: 'electronic-gate', value: { malformed: true }, updatedAt: new Date() });
  await assert.rejects(service.list(), hasStatus(500));
  model.findMany = async () => { throw new Error('database offline'); };
  await assert.rejects(service.list(), /database offline/);
});

test('电子闸门读写均要求独立页面权限，字典管理员不能绕过', () => {
  const guard = new RolesGuard(new Reflector());
  for (const handler of ['list', 'saveDraft', 'publish'] as const) {
    for (const [permissions, expected] of [[[], false], [['page:settings'], false], [['page:electronic-gate'], true], [['*'], true]] as Array<[string[], boolean]>) {
      const context = { getClass: () => ElectronicGateController, getHandler: () => ElectronicGateController.prototype[handler], switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }) };
      assert.equal(guard.canActivate(context as any), expected, handler);
    }
  }
  const entry = DEFAULT_PERMISSION_CATALOG.find((item) => item.code === 'page:electronic-gate');
  assert.equal(entry?.routePath, '/electronic-gate');
  assert.equal(entry?.groupLabel, '页面访问 · 系统管理');
});


test('串口发布在同一事务汇总其他active，不带入其余draft，失败回滚单项发布', async () => {
  const { service, publications, factory } = fixture();
  await service.saveDraft('baud-rate', { expectedRevision: 0, draft: config('baud-rate') }, actor);
  await service.saveDraft('response-timeout', { expectedRevision: 0, draft: config('response-timeout') }, actor);
  await service.publish('response-timeout', { expectedRevision: 1 }, actor);
  assert.deepEqual(Object.keys(publications[0]), ['response-timeout']);
  assert.equal(publications[0]['response-timeout'].values.timeoutMs, '1500');
  factory.publishSerialFromActiveItems = async () => { throw new Error('snapshot storage unavailable'); };
  await assert.rejects(service.publish('baud-rate', { expectedRevision: 1 }, actor), /snapshot storage unavailable/);
  const baud = (await service.list()).items.find(item => item.id === 'baud-rate')!;
  assert.equal(baud.revision, 1);
  assert.ok(baud.draft);
  assert.equal(baud.active, null);
});

test('串口参数范围与枚举严格匹配，业务scope不是下载前置条件', async () => {
  const { service } = fixture();
  for (const [id, key, values] of [
    ['baud-rate', 'baudRate', ['299', '3000001']],
    ['response-timeout', 'timeoutMs', ['99', '10001']],
    ['scan-interval', 'scanIntervalMs', ['249', '60001']],
    ['retry-delay', 'retrySeconds', ['.5', '301', '1.0001']],
    ['stop-bits', 'stopBits', ['One', '3']],
    ['serial-port', 'port', ['COM0', 'COM-TEST']],
  ] as Array<[string, string, string[]]>) {
    for (const invalid of values) {
      const draft = config(id); draft.values[key] = invalid;
      await assert.rejects(service.saveDraft(id, { expectedRevision: 0, draft }, actor), hasStatus(400));
    }
  }
  const draft = config('response-timeout');
  await service.saveDraft('response-timeout', { expectedRevision: 0, draft }, actor);
  assert.ok((await service.publish('response-timeout', { expectedRevision: 1 }, actor)).active);
});
