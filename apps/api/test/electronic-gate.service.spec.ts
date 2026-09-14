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
      return structuredClone([...rows.values()].filter((row) => row.category === where.category
        && (where.key.in ? where.key.in.includes(row.key) : row.key.startsWith(where.key.startsWith))));
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
  if (id === 'built-in-parameters') {
    for (const key of ['parameterProfiles', 'parameterPlan', 'performanceClass']) result.values[key] = '';
    result.values.parameterSlots = JSON.stringify(Array.from({ length: 8 }, (_, gear) => ({ gear, speed: 1000 + gear, duration: 100 + gear })));
    for (const key of ['time310', 'time310Unit', 'time210', 'time210Unit', 'compressorRpm']) result.values[key] = '';
  }
  if (id === 'sensor-pressure') { result.values.gearUpperBounds = ''; result.values.gearRanges = ''; }
  if (id === 'fpga-version') result.values[result.values.operator === 'equals' ? 'allowedValues' : 'expected'] = '';
  if (id === 'fan-status') result.values.expected = '';
  if (id === 'compressor-recovery') for (const key of ['stoppedValue', 'recoveredValue', 'observationMs']) result.values[key] = '';
  if (id === 'compressor-speed') for (const key of ['gear', 'minimum', 'maximum', 'boundary']) result.values[key] = '';
  return result;
}
const hasStatus = (status: number) => (error: any) => error?.getStatus?.() === status;

function profileConfig(): GateConfig {
  const draft = config('built-in-parameters');
  draft.model = ''; draft.market = '';
  draft.values = { operator: 'profile-slots', parameterPlan: 'shipping', performanceClass: 'A', approval: 'confirmed',
    parameterProfiles: JSON.stringify([
    { models: ['Q5'], valveType: 0, plan: 'shipping', performanceClass: 'A', slots: [{ gear: 3, speed: 1000, duration: 200 }] },
    { models: ['Q6', 'Q7'], valveType: 1, plan: 'shipping', performanceClass: 'A', slots: [{ gear: 1, speed: 1500, duration: 250 }, { gear: 3, speed: 1800, duration: 300 }] },
    { models: ['Q5'], valveType: 0, plan: 'fixed-mac', performanceClass: 'A', slots: [{ gear: 3, speed: 900, duration: 180 }] }
  ]), readbackSource: '新版73/74', evidence: '测试参数表' };
  return draft;
}
function pressureConfig(): GateConfig {
  const draft = config('sensor-pressure');
  draft.model = ''; draft.market = '';
  draft.values = { operator: 'gear-upper', boundary: 'unconfirmed', approval: 'confirmed', readbackSource: '新版78', evidence: '测试压力表',
    gearUpperBounds: JSON.stringify([{ gear: 0, maximum: 120, models: ['Q5'] }, { gear: 0, maximum: 130, models: ['Q6', 'Q7'] }, { gear: 3, maximum: 160 }]) };
  return draft;
}
test('型号参数和档位上限可发布通用范围，且不生成未开放档位或隐式发布目录', async () => {
  for (const [id, draft] of [['built-in-parameters', profileConfig()], ['sensor-pressure', pressureConfig()]] as const) {
    const { service, rows } = fixture();
    const saved = await service.saveDraft(id, { expectedRevision: 0, draft }, actor);
    assert.equal(saved.active, null);
    const active = (await service.publish(id, { expectedRevision: 1 }, actor)).active!;
    assert.equal(active.model, ''); assert.equal(active.market, '');
    assert.deepEqual(active.values, draft.values);
    assert.equal(rows.size, 1);
    if (id === 'built-in-parameters') assert.deepEqual(JSON.parse(active.values.parameterProfiles)[0].slots.map((slot: any) => slot.gear), [3]);
  }
  const { service } = fixture(); const old = config('default-gear', true); old.model = ''; old.market = '';
  await service.saveDraft('default-gear', { expectedRevision: 0, draft: old }, actor);
  await assert.rejects(service.publish('default-gear', { expectedRevision: 1 }, actor), hasStatus(400));
});
test('型号方案拒绝重叠、非法开放档位、未知键、类型及未匹配选择范围', async () => {
  const base = JSON.parse(profileConfig().values.parameterProfiles);
  const mutate = (change: (value: any[]) => void) => { const value = structuredClone(base); change(value); return JSON.stringify(value); };
  const invalid = ['[]', '{}', 'bad JSON',
    mutate(p => { p[0].unknown = 1; }), mutate(p => { p[0].models = []; }), mutate(p => { p[0].models = ['Q5', 'Q5']; }),
    mutate(p => { p[0].valveType = '0'; }), mutate(p => { p[0].plan = 'other'; }), mutate(p => { p[0].performanceClass = 'B'; }),
    mutate(p => { p[0].slots = []; }), mutate(p => { p[0].slots[0].enabled = true; }), mutate(p => { p[0].slots[0].gear = 8; }),
    mutate(p => { p[0].slots.push({ ...p[0].slots[0] }); }), mutate(p => { p[0].slots[0].speed = 65536; }), mutate(p => { p[0].slots[0].duration = '200'; }),
    mutate(p => { p.push({ ...p[0], models: ['Q5', 'Q8'] }); })];
  for (const value of invalid) {
    const f = fixture(), draft = profileConfig(); draft.values.parameterProfiles = value;
    await assert.rejects(f.service.saveDraft('built-in-parameters', { expectedRevision: 0, draft }, actor), hasStatus(400));
    assert.equal(f.rows.size, 0);
  }
  const f = fixture(), unmatched = profileConfig(); unmatched.model = 'Q9';
  await assert.rejects(f.service.saveDraft('built-in-parameters', { expectedRevision: 0, draft: unmatched }, actor), hasStatus(400));
  unmatched.model = 'Q6'; unmatched.values.parameterPlan = 'fixed-mac';
  await assert.rejects(f.service.saveDraft('built-in-parameters', { expectedRevision: 0, draft: unmatched }, actor), hasStatus(400));
});
test('档位压力支持同档分机型上限但拒绝范围重叠及非有限或越界值', async () => {
  const rows = JSON.parse(pressureConfig().values.gearUpperBounds);
  const mutate = (change: (value: any[]) => void) => { const value = structuredClone(rows); change(value); return JSON.stringify(value); };
  for (const value of ['[]', '{}', 'bad JSON', mutate(r => { r[0].maximum = 65536; }), mutate(r => { r[0].maximum = '120'; }),
    mutate(r => { r[0].maximum = Infinity; }), mutate(r => { r[0].gear = -1; }), mutate(r => { r[0].models = []; }),
    mutate(r => { r[0].models = ['Q5', 'Q5']; }), mutate(r => { r[0].models = ['Q6']; }), mutate(r => { delete r[0].models; }),
    mutate(r => { r[0].enabled = true; })]) {
    const f = fixture(), draft = pressureConfig(); draft.values.gearUpperBounds = value;
    await assert.rejects(f.service.saveDraft('sensor-pressure', { expectedRevision: 0, draft }, actor), hasStatus(400)); assert.equal(f.rows.size, 0);
  }
  for (const boundary of ['inclusive', 'exclusive', 'unconfirmed']) {
    const f = fixture(), draft = pressureConfig(); draft.values.boundary = boundary;
    await f.service.saveDraft('sensor-pressure', { expectedRevision: 0, draft }, actor);
    assert.equal((await f.service.publish('sensor-pressure', { expectedRevision: 1 }, actor)).active?.values.boundary, boundary);
  }
});
test('新模式发布须填计划/等级/JSON/边界，清空冲突旧字段且不放宽旧模式范围', async () => {
  for (const [id, create, required, conflicts] of [
    ['built-in-parameters', profileConfig, ['parameterPlan', 'performanceClass', 'parameterProfiles'], ['parameterSlots', 'time310']],
    ['sensor-pressure', pressureConfig, ['gearUpperBounds', 'boundary'], ['gear', 'minimum', 'maximum']]
  ] as const) {
    for (const key of required) {
      const f = fixture(), draft = create(); draft.values[key] = '';
      await f.service.saveDraft(id, { expectedRevision: 0, draft }, actor);
      await assert.rejects(f.service.publish(id, { expectedRevision: 1 }, actor), hasStatus(400));
    }
    for (const key of conflicts) {
      const f = fixture(), draft = create(); draft.values[key] = key === 'parameterSlots' ? JSON.stringify(Array.from({length:8},(_,gear)=>({gear,speed:1,duration:1}))) : '1';
      await f.service.saveDraft(id, { expectedRevision: 0, draft }, actor);
      await assert.rejects(f.service.publish(id, { expectedRevision: 1 }, actor), hasStatus(400));
    }
    const f = fixture(), draft = create(); draft.values.unknownField = 'x';
    await assert.rejects(f.service.saveDraft(id, { expectedRevision: 0, draft }, actor), hasStatus(400));
  }
  for (const id of ['built-in-parameters', 'sensor-pressure']) {
    const f = fixture(), draft = config(id, true); draft.model = ''; draft.market = '';
    await f.service.saveDraft(id, { expectedRevision: 0, draft }, actor);
    await assert.rejects(f.service.publish(id, { expectedRevision: 1 }, actor), hasStatus(400));
  }
});


test('新版目录按主表区分已确认和暂定条件，不隐式发布；原开机基线与当前大气压独立', async () => {
  const { service, rows } = fixture();
  const { items } = await service.list();
  const get = (id: string) => items.find(item => item.id === id)!;
  assert.equal(get('startup-pressure').number, '22'); assert.equal(get('current-pressure').number, '23');
  assert.deepEqual([get('current-pressure').defaults.values.minimum, get('current-pressure').defaults.values.maximum], ['98', '105']);
  assert.equal(get('built-in-parameters').defaults.values.operator, 'profile-slots');
  assert.equal(get('built-in-parameters').defaults.values.parameterPlan, 'shipping');
  assert.equal(get('built-in-parameters').defaults.values.performanceClass, 'A');
  assert.equal(get('built-in-parameters').defaults.values.approval, 'confirmed');
  assert.equal(JSON.parse(get('built-in-parameters').defaults.values.parameterProfiles).length, 6);
  assert.equal(JSON.parse(get('built-in-parameters').defaults.values.parameterProfiles).reduce((sum: number, profile: any) => sum + profile.slots.length, 0), 42);
  assert.equal(get('sensor-pressure').defaults.values.operator, 'gear-range');
  assert.equal(get('sensor-pressure').defaults.values.boundary, 'inclusive');
  assert.deepEqual(JSON.parse(get('sensor-pressure').defaults.values.gearRanges), [
    {gear:0,minimum:200,maximum:300},{gear:1,minimum:120,maximum:175},{gear:2,minimum:135,maximum:205},{gear:3,minimum:140,maximum:240},
    {gear:4,minimum:160,maximum:270},{gear:5,minimum:180,maximum:285},{gear:6,minimum:200,maximum:300},{gear:7,minimum:210,maximum:305}
  ]);
  assert.equal(get('built-in-parameters').defaults.values.parameterSlots, '');
  assert.equal(get('compressor-speed').defaults.values.tolerancePercent, '15');
  assert.equal(get('compressor-speed').defaults.values.targetSource, 'parameters');
  assert.equal(get('compressor-recovery').defaults.values.maximum, '3');
  assert.equal(get('v-pressure').defaults.values.measurementUnit, 'raw');
  assert.equal(get('button-volume').defaults.values.expected, '3');
  const confirmed = new Set(['device-model', 'shipping-market', 'firmware-version', 'valve-type', 'fpga-version', 'compressor-speed', 'alarm-status', 'sensor-pressure', 'internal-temperature', 'fan-status', 'compressor-recovery', 'v-pressure', 'v-pressure-temperature', 'default-sensitivity', 'total-usage', 'button-volume', 'default-gear', 'calibration-230', 'calibration-232', 'current-pressure']);
  confirmed.add('built-in-parameters');
  confirmed.add('debug-status');
  for (const item of items.filter(item => ['critical', 'routine'].includes(item.category))) assert.equal(item.defaults.values.approval, confirmed.has(item.id) ? 'confirmed' : 'tentative');
  assert.equal(get('total-usage').defaults.values.maximum, '20.5');
  assert.equal(get('total-usage').defaults.values.operator, 'lte');
  assert.equal(get('valve-type').defaults.values.allowedValues, 'MAC 阀\n方阀');
  assert.equal(get('fpga-version').defaults.values.operator, 'equals');
  assert.equal(get('fpga-version').defaults.values.expected, '37');
  assert.equal(get('compressor-speed').defaults.values.approval, 'confirmed');
  assert.equal(get('alarm-status').defaults.values.expected, '0');
  assert.equal(get('calibration-230').defaults.values.expected, '1');
  assert.equal(get('calibration-232').defaults.values.expected, '1');
  assert.deepEqual([get('fan-status').defaults.values.operator, get('fan-status').defaults.values.minimum, get('fan-status').defaults.values.maximum], ['range', '1', '100']);
  assert.equal(rows.size, 0);
});

test('八槽参数按已开放档位标准保存发布，错误JSON/槽位/位宽/类型均拒绝', async () => {
  const valid = config('built-in-parameters', true);
  const { service } = fixture();
  await service.saveDraft('built-in-parameters', { expectedRevision: 0, draft: valid }, actor);
  const published = await service.publish('built-in-parameters', { expectedRevision: 1 }, actor);
  assert.equal(published.active?.values.parameterSlots, valid.values.parameterSlots);
  const slots = JSON.parse(valid.values.parameterSlots);
  const mutate = (change: (values: any[]) => void) => { const data = structuredClone(slots); change(data); return JSON.stringify(data); };
  for (const invalid of ['bad JSON', '{}', JSON.stringify(slots.slice(1)),
    mutate(data => { data[7].gear = 0; }), mutate(data => { data[0].speed = -1; }),
    mutate(data => { data[0].duration = 65536; }), mutate(data => { data[0].speed = '1000'; }),
    mutate(data => { data[0].gear = .5; }), mutate(data => { data[0].enabled = 'true'; }),
    mutate(data => { data.forEach(slot => { slot.enabled = false; }); }), mutate(data => { data[0].unknown = 1; })]) {
    const f = fixture(); const draft = structuredClone(valid); draft.values.parameterSlots = invalid;
    await assert.rejects(f.service.saveDraft('built-in-parameters', { expectedRevision: 0, draft }, actor), hasStatus(400));
    assert.equal(f.rows.size, 0);
  }
});

test('新操作符发布要求对应字段且不混用旧语义，未确认状态不会自动升级', async () => {
  for (const id of ['built-in-parameters', 'compressor-recovery', 'compressor-speed']) {
    const { service } = fixture(); const draft = config(id, true);
    const required = id === 'built-in-parameters' ? 'parameterSlots' : id === 'compressor-recovery' ? 'maximum' : 'targetSource';
    draft.values[required] = '';
    await service.saveDraft(id, { expectedRevision: 0, draft }, actor);
    await assert.rejects(service.publish(id, { expectedRevision: 1 }, actor), hasStatus(400));
  }
  for (const [id, key] of [['built-in-parameters', 'time310'], ['compressor-recovery', 'stoppedValue'], ['compressor-speed', 'minimum'], ['fan-status', 'expected']]) {
    const { service } = fixture(); const draft = config(id, true); draft.values[key] = '1';
    await service.saveDraft(id, { expectedRevision: 0, draft }, actor);
    await assert.rejects(service.publish(id, { expectedRevision: 1 }, actor), hasStatus(400));
  }
  for (const approval of ['tentative', 'confirmed']) {
    const { service } = fixture(); const draft = config('compressor-speed', true); draft.values.approval = approval;
    await service.saveDraft('compressor-speed', { expectedRevision: 0, draft }, actor);
    assert.equal((await service.publish('compressor-speed', { expectedRevision: 1 }, actor)).active?.values.approval, approval);
  }
  const { service } = fixture(); const draft = config('debug-status', true); delete draft.values.approval;
  assert.equal((await service.saveDraft('debug-status', { expectedRevision: 0, draft }, actor)).draft?.values.approval, 'tentative');
  for (const bad of ['approved', 'false']) {
    draft.values.approval = bad;
    await assert.rejects(service.saveDraft('debug-status', { expectedRevision: 1, draft }, actor), hasStatus(400));
  }
});

test('旧参数、停转恢复、固定转速及缺省approval存档继续读取且不写回迁移', async () => {
  const { service, rows } = fixture();
  const legacy: Record<string, Record<string, string>> = {
    'built-in-parameters': { time310: '100', time310Unit: 'ms', time210: '200', time210Unit: 'ms', compressorRpm: '3000' },
    'compressor-recovery': { stoppedValue: '0', recoveredValue: '1', observationMs: '1000' },
    'compressor-speed': { operator: 'range', gear: '3', minimum: '1000', maximum: '2000', boundary: 'inclusive' },
    'fan-status': { feedbackMethod: '反馈比例', operator: 'equals', expected: '100' },
  };
  for (const [id, values] of Object.entries(legacy)) {
    const active = config(id, true); active.values = { ...values, readbackSource: '已确认旧固件来源', evidence: '旧工艺 Q-001' };
    const key = `${GATE_SETTING_PREFIX}${id}`;
    rows.set(key, { key, category: 'electronic-gate', updatedAt: new Date('2026-09-09'),
      value: { schemaVersion: 1, revision: 7, active, draft: structuredClone(active), updatedBy: 'old-operator', publishedAt: '2026-09-09T00:00:00Z' } });
  }
  const before = structuredClone(rows);
  const listed = await service.list();
  for (const id of Object.keys(legacy)) {
    const item = listed.items.find(item => item.id === id)!;
    assert.deepEqual(item.active?.values, before.get(`${GATE_SETTING_PREFIX}${id}`)!.value.active.values);
    assert.equal(Object.prototype.hasOwnProperty.call(item.active!.values, 'approval'), false);
  }
  assert.deepEqual(rows, before);
});

test('新模板默认停用独立开机基线，当前大气压保留正式范围，音量明确为保存值', async () => {
  const { service, rows } = fixture();
  const { items } = await service.list();
  const get = (id: string) => items.find(item => item.id === id)!;
  assert.equal(get('startup-pressure').defaults.enabled, false);
  assert.match(get('startup-pressure').defaults.helpText, /历史配置.*默认停用/);
  assert.equal(get('current-pressure').defaults.enabled, true);
  assert.equal(get('current-pressure').category, 'critical');
  assert.deepEqual([get('current-pressure').defaults.values.minimum, get('current-pressure').defaults.values.maximum, get('current-pressure').defaults.values.boundary], ['98', '105', 'inclusive']);
  assert.match(get('current-pressure').defaults.helpText, /当前环境大气压/);
  assert.equal(get('button-volume').defaults.values.expected, '3');
  assert.match(get('button-volume').defaults.helpText, /EEPROM.*0～3/);
  assert.match(get('button-volume').defaults.helpText, /0xFF.*不能.*1/);
  assert.match(get('button-volume').fields.find(field => field.key === 'readbackSource')!.help!, /当前运行音量/);
  assert.deepEqual([get('debug-status').defaults.values.expected, get('debug-status').defaults.values.approval], ['0', 'confirmed']);
  assert.equal(rows.size, 0, '读取模板不得创建配置记录');
});

test('新版默认状态和说明不会改写既有大气压、音量或 Debug 的草稿及发布值', async () => {
  const { service, rows } = fixture();
  const ids = ['startup-pressure', 'current-pressure', 'button-volume', 'debug-status'];
  for (const id of ids) {
    const active = config(id, true);
    active.enabled = true;
    active.helpText = '发布时的既有说明';
    const draft = structuredClone(active);
    draft.helpText = '尚未发布的新草稿说明';
    if (id === 'button-volume') { active.values.expected = '1'; draft.values.expected = '2'; }
    const key = `${GATE_SETTING_PREFIX}${id}`;
    rows.set(key, { key, category: 'electronic-gate', updatedAt: new Date('2026-09-09'),
      value: { schemaVersion: 1, revision: 7, active, draft, updatedBy: 'old-operator', publishedAt: '2026-09-09T00:00:00Z' } });
  }
  const before = structuredClone(rows), listed = await service.list();
  for (const id of ids) {
    const item = listed.items.find(item => item.id === id)!;
    const stored = before.get(`${GATE_SETTING_PREFIX}${id}`)!.value;
    assert.deepEqual(item.active, stored.active);
    assert.deepEqual(item.draft, stored.draft);
    assert.equal(item.revision, 7);
  }
  assert.equal(listed.items.find(item => item.id === 'startup-pressure')!.defaults.enabled, false);
  assert.deepEqual(rows, before, '读取必须完整保留历史草稿和已发布数据');
});

test('目录保留22个原始编号并独立新增23当前大气压；所有50项均未发布，参考数值不作为有效规则', async () => {
  const { service, rows } = fixture();
  const { items } = await service.list();
  assert.equal(items.length, 50);
  assert.equal(new Set(items.map((item) => item.id)).size, 50);
  assert.equal(items.filter((item) => item.category === 'critical').length, 12);
  assert.equal(items.filter((item) => item.category === 'routine').length, 11);
  assert.equal(items.filter((item) => item.category === 'manual').length, 5);
  assert.equal(items.filter((item) => item.category === 'connection').length, 12);
  assert.equal(items.filter((item) => item.category === 'command').length, 10);
  assert.deepEqual(items.filter((item) => ['critical', 'routine'].includes(item.category)).map((item) => item.number).sort(), Array.from({ length: 23 }, (_, i) => String(i + 1).padStart(2, '0')));
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
  assert.equal(item.defaults.values.minimum, '16');
  assert.equal(item.defaults.values.maximum, '38');
  assert.equal(item.defaults.values.measurementUnit, 'raw');
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

test('完整配置可以逐项发布50个模板，互相不覆盖', async () => {
  const { service, rows } = fixture();
  for (const definition of GATE_DEFINITIONS) {
    await service.saveDraft(definition.id, { expectedRevision: 0, draft: config(definition.id, true) }, actor);
    const published = await service.publish(definition.id, { expectedRevision: 1 }, actor);
    assert.equal(published.revision, 2);
    assert.ok(published.active);
  }
  assert.equal(rows.size, 50);
  assert.equal((await service.list()).items.filter((item) => item.active).length, 50);
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


test('累计使用时长支持严格小于，已有小于或等于规则保持兼容', async () => {
  for (const operator of ['lt', 'lte']) {
    const { service } = fixture();
    const draft = config('total-usage', true);
    draft.values.operator = operator;
    draft.values.maximum = '20.5';
    await service.saveDraft('total-usage', { expectedRevision: 0, draft }, actor);
    const published = await service.publish('total-usage', { expectedRevision: 1 }, actor);
    assert.equal(published.active?.values.operator, operator);
    assert.equal(published.active?.values.maximum, '20.5');
    const reread = (await service.list()).items.find(item => item.id === 'total-usage');
    assert.equal(reread?.active?.values.operator, operator);
  }
});

test('前三项默认判断有效读取，兼容旧显示规则；清单方式仍要求完整清单且不改变其他项', async () => {
  for (const id of ['device-model', 'shipping-market', 'firmware-version']) {
    const f = fixture(); const draft = config(id, true);
    assert.equal(GATE_DEFINITIONS.find(item => item.id === id)!.defaults.values.operator, 'present');
    draft.values.operator = 'display'; draft.values.allowedValues = '';
    await f.service.saveDraft(id, { expectedRevision: 0, draft }, actor);
    const published = await f.service.publish(id, { expectedRevision: 1 }, actor);
    assert.equal(published.active?.values.operator, 'display');
    assert.equal(published.active?.values.allowedValues, '');
    assert.equal(f.rows.size, 1);
    const allowlist = structuredClone(draft); allowlist.values.operator = 'allowlist';
    await f.service.saveDraft(id, { expectedRevision: 2, draft: allowlist }, actor);
    await assert.rejects(f.service.publish(id, { expectedRevision: 3 }, actor), /允许/);
    assert.equal((await f.service.list()).items.find(item => item.id === id)!.active?.values.operator, 'display');
    allowlist.values.allowedValues = 'TEST-ALLOWED';
    await f.service.saveDraft(id, { expectedRevision: 3, draft: allowlist }, actor);
    assert.equal((await f.service.publish(id, { expectedRevision: 4 }, actor)).active?.values.operator, 'allowlist');
  }
  for (const id of ['valve-type', 'fpga-version']) {
    const f = fixture(); const draft = config(id, true); draft.values.operator = 'display';
    await assert.rejects(f.service.saveDraft(id, { expectedRevision: 0, draft }, actor), /选项无效/);
    draft.values.operator = 'allowlist'; draft.values.allowedValues = '';
    await f.service.saveDraft(id, { expectedRevision: 0, draft }, actor);
    await assert.rejects(f.service.publish(id, { expectedRevision: 1 }, actor), /允许/);
  }
});

test('仅显示仍要求发布范围和依据，旧清单active和草稿不被新默认覆盖', async () => {
  for (const key of ['model', 'market', 'evidence', 'readbackSource']) {
    const f = fixture(); const draft = config('device-model', true); draft.values.allowedValues = '';
    if (key === 'model' || key === 'market') draft[key] = ''; else draft.values[key] = '';
    await f.service.saveDraft('device-model', { expectedRevision: 0, draft }, actor);
    await assert.rejects(f.service.publish('device-model', { expectedRevision: 1 }, actor), hasStatus(400));
  }
  const f = fixture();
  for (const id of ['device-model', 'shipping-market', 'firmware-version']) {
    const active = config(id, true); active.values.operator = 'allowlist'; active.values.allowedValues = 'OLD-APPROVED';
    delete active.values.approval;
    const draft = structuredClone(active); draft.values.allowedValues = 'NEXT-DRAFT';
    const key = GATE_SETTING_PREFIX + id;
    f.rows.set(key, { key, category: 'electronic-gate', updatedAt: new Date('2026-09-09'),
      value: { schemaVersion: 1, revision: 7, active, draft, updatedBy: 'old-operator', publishedAt: '2026-09-09T00:00:00Z' } });
  }
  const before = structuredClone(f.rows);
  const listed = await f.service.list();
  for (const id of ['device-model', 'shipping-market', 'firmware-version']) {
    const item = listed.items.find(item => item.id === id)!;
    assert.deepEqual(item.active, before.get(GATE_SETTING_PREFIX + id)!.value.active);
    assert.deepEqual(item.draft, before.get(GATE_SETTING_PREFIX + id)!.value.draft);
    assert.equal(item.defaults.values.operator, 'present');
  }
  assert.deepEqual(f.rows, before);
});

function pressureRangeConfig(): GateConfig {
  const draft = pressureConfig();
  draft.values.operator = 'gear-range'; draft.values.boundary = 'inclusive';
  delete draft.values.gearUpperBounds;
  draft.values.gearRanges = JSON.stringify([
    { gear: 0, minimum: 200, maximum: 300, models: ['Q5'] },
    { gear: 0, minimum: 210, maximum: 305, models: ['Q6', 'Q7'] },
    { gear: 3, minimum: 140, maximum: 240 },
  ]);
  return draft;
}

test('当前分档压力范围可发布通用或机型范围，下载保留原始上下限和边界', async () => {
  for (const boundary of ['inclusive', 'exclusive']) {
    const f = fixture(), draft = pressureRangeConfig(); draft.values.boundary = boundary;
    await f.service.saveDraft('sensor-pressure', { expectedRevision: 0, draft }, actor);
    await f.service.publish('sensor-pressure', { expectedRevision: 1 }, actor);
    assert.deepEqual((await f.service.downloadRules()).items[0].values, draft.values);
    const stored = (await f.service.list()).items.find(item => item.id === 'sensor-pressure')!;
    assert.equal(stored.active?.model, ''); assert.equal(stored.active?.market, '');
  }
});

test('当前分档压力范围拒绝非法上下限、重叠机型、越界档位及未知字段且不写入', async () => {
  const base = JSON.parse(pressureRangeConfig().values.gearRanges);
  const mutate = (change: (rows: any[]) => void) => { const rows = structuredClone(base); change(rows); return JSON.stringify(rows); };
  for (const text of ['[]', '{}', 'not JSON', mutate(rows => { delete rows[0].minimum; }),
    mutate(rows => { rows[0].minimum = '200'; }), mutate(rows => { rows[0].minimum = -1; }),
    mutate(rows => { rows[0].minimum = 301; }), mutate(rows => { rows[0].maximum = 65536; }),
    mutate(rows => { rows[0].minimum = Infinity; }), mutate(rows => { rows[0].gear = 8; }),
    mutate(rows => { rows[0].models = ['Q6']; }), mutate(rows => { delete rows[0].models; }),
    mutate(rows => { rows[0].models = []; }), mutate(rows => { rows[0].models = ['Q5', 'Q5']; }),
    mutate(rows => { rows[0].unknown = 1; })]) {
    const f = fixture(), draft = pressureRangeConfig(); draft.values.gearRanges = text;
    await assert.rejects(f.service.saveDraft('sensor-pressure', { expectedRevision: 0, draft }, actor), hasStatus(400));
    assert.equal(f.rows.size, 0);
  }
  const f = fixture(), unmatched = pressureRangeConfig(); unmatched.model = 'Q8';
  unmatched.values.gearRanges = JSON.stringify(base.slice(0, 2));
  await assert.rejects(f.service.saveDraft('sensor-pressure', { expectedRevision: 0, draft: unmatched }, actor), hasStatus(400));
});

test('当前分档压力发布要求完整范围与明确边界，并拒绝混用旧上下限配置', async () => {
  for (const change of [
    (draft: GateConfig) => { draft.values.gearRanges = ''; },
    (draft: GateConfig) => { draft.values.boundary = ''; },
    (draft: GateConfig) => { draft.values.boundary = 'unconfirmed'; },
    (draft: GateConfig) => { draft.values.gearUpperBounds = pressureConfig().values.gearUpperBounds; },
    (draft: GateConfig) => { draft.values.minimum = '1'; },
    (draft: GateConfig) => { draft.values.boundary = 'exclusive'; draft.values.gearRanges = '[{"gear":0,"minimum":200,"maximum":200}]'; },
  ]) {
    const f = fixture(), draft = pressureRangeConfig(); change(draft);
    await f.service.saveDraft('sensor-pressure', { expectedRevision: 0, draft }, actor);
    await assert.rejects(f.service.publish('sensor-pressure', { expectedRevision: 1 }, actor), hasStatus(400));
    assert.equal((await f.service.downloadRules()).items.length, 0);
  }
  const f = fixture(), legacy = pressureConfig(); legacy.values.gearRanges = pressureRangeConfig().values.gearRanges;
  await f.service.saveDraft('sensor-pressure', { expectedRevision: 0, draft: legacy }, actor);
  await assert.rejects(f.service.publish('sensor-pressure', { expectedRevision: 1 }, actor), hasStatus(400));
});

test('身份有效读取与FPGA等值规则可发布下载，FPGA旧清单继续兼容并拒绝混用', async () => {
  for (const id of ['device-model', 'shipping-market', 'firmware-version', 'fpga-version']) {
    const f = fixture(), draft = config(id, true);
    draft.values.allowedValues = '';
    draft.values.operator = id === 'fpga-version' ? 'equals' : 'present';
    if (id === 'fpga-version') draft.values.expected = '37';
    await f.service.saveDraft(id, { expectedRevision: 0, draft }, actor);
    await f.service.publish(id, { expectedRevision: 1 }, actor);
    assert.deepEqual((await f.service.downloadRules()).items[0].values, draft.values);
  }
  for (const [operator, expected, allowedValues] of [['equals', '', ''], ['equals', '37', '37'], ['allowlist', '', ''], ['allowlist', '37', '37']]) {
    const f = fixture(), draft = config('fpga-version', true);
    Object.assign(draft.values, { operator, expected, allowedValues });
    await f.service.saveDraft('fpga-version', { expectedRevision: 0, draft }, actor);
    await assert.rejects(f.service.publish('fpga-version', { expectedRevision: 1 }, actor), hasStatus(400));
  }
  const f = fixture(), legacy = config('fpga-version', true);
  Object.assign(legacy.values, { operator: 'allowlist', allowedValues: '37\n38' }); delete legacy.values.expected;
  await f.service.saveDraft('fpga-version', { expectedRevision: 0, draft: legacy }, actor);
  await f.service.publish('fpga-version', { expectedRevision: 1 }, actor);
  const item = (await f.service.downloadRules()).items[0];
  assert.equal(item.values.operator, 'allowlist'); assert.equal(item.values.allowedValues, '37\n38');
});
