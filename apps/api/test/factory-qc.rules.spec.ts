import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { ElectronicGateService } from '../src/modules/electronic-gate/electronic-gate.service';
import { ElectronicGateModule } from '../src/modules/electronic-gate/electronic-gate.module';
import { FactoryQcPublicController } from '../src/modules/electronic-gate/factory-qc.controller';
import { FactoryQcService } from '../src/modules/electronic-gate/factory-qc.service';
import { GATE_DEFINITIONS, GATE_SETTING_CATEGORY, GATE_SETTING_PREFIX, type GateConfig } from '../src/modules/electronic-gate/electronic-gate.catalog';
import { IS_PUBLIC_KEY } from '../src/modules/auth/decorators/public.decorator';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';

type Row = { key: string; category: string; value: any; updatedAt: Date };

/** No Prisma client is instantiated. The fixture has a single read primitive and cannot write. */
function fixture() {
  const rows: Row[] = [];
  let reads = 0;
  const prisma = { systemSetting: { async findMany({ where }: any) {
    reads++;
    return structuredClone(rows.filter(row => row.category === where.category && where.key.in.includes(row.key)));
  } } };
  return { rows, service: new ElectronicGateService(prisma as any), readCount: () => reads };
}

function complete(id: string): GateConfig {
  const definition = GATE_DEFINITIONS.find(item => item.id === id)!;
  const config = structuredClone(definition.defaults);
  config.model = 'Q7'; config.market = 'U';
  for (const field of definition.fields) {
    config.values[field.key] = field.type === 'select' ? field.options![0].value
      : field.type === 'number' ? String(field.min ?? (field.key === 'minimum' ? 0 : 10)) : '测试规范 Q-001';
  }
  if (id === 'serial-port') config.values.port = 'COM3';
  return config;
}

function row(id: string, active: GateConfig | null, draft: GateConfig | null = null): Row {
  return {
    key: `${GATE_SETTING_PREFIX}${id}`, category: GATE_SETTING_CATEGORY, updatedAt: new Date('2026-09-09T00:00:00Z'),
    value: { schemaVersion: 1, revision: 2, active, draft, updatedBy: 'PRIVATE-OPERATOR', publishedAt: active ? '2026-09-09T00:00:00Z' : null },
  };
}

test('empty rules are a stable successful response, with no implicit publication or write', async () => {
  const f = fixture();
  const actual = await f.service.downloadRules();
  assert.deepEqual(actual, {
    schemaVersion: 1,
    version: `rules-${createHash('sha256').update(JSON.stringify({ schemaVersion: 1, items: [] })).digest('hex')}`,
    items: [],
  });
  assert.deepEqual(await f.service.downloadRules(), actual);
  assert.equal(f.readCount(), 2); assert.equal(f.rows.length, 0);
});

test('partial rules project only published critical/routine active values including enabled=false', async () => {
  const f = fixture();
  const active = complete('debug-status'); active.values.expected = '0';
  const newerDraft = complete('debug-status'); newerDraft.helpText = 'PRIVATE-DRAFT'; newerDraft.values.expected = '1';
  const disabled = complete('total-usage'); disabled.enabled = false; disabled.values.maximum = '20.5';
  f.rows.push(row('debug-status', active, newerDraft), row('total-usage', disabled),
    row('internal-temperature', null, complete('internal-temperature')),
    row('manual-1', complete('manual-1')), row('baud-rate', complete('baud-rate')), row('command-1', complete('command-1')));
  const before = structuredClone(f.rows);
  const result = await f.service.downloadRules();
  assert.equal(f.readCount(), 1, 'one database statement must supply the entire response');
  assert.deepEqual(result.items.map(item => item.id), ['debug-status', 'total-usage']);
  assert.equal(result.items[0].values.expected, '0'); assert.equal(result.items[1].enabled, false);
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['displayName', 'enabled', 'failureAction', 'helpText', 'id', 'market', 'model', 'values']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-DRAFT|PRIVATE-OPERATOR|publishedAt|updatedAt|revision|defaults/);
  assert.deepEqual(f.rows, before);
});

test('rule versions ignore row order, value key order, drafts and publication metadata', async () => {
  const f = fixture();
  f.rows.push(row('total-usage', complete('total-usage')), row('debug-status', complete('debug-status')));
  const before = await f.service.downloadRules();
  f.rows.reverse();
  for (const entry of f.rows) {
    entry.value.active.values = Object.fromEntries(Object.entries(entry.value.active.values).reverse());
    entry.value.revision++;
    entry.value.updatedBy = 'ANOTHER-OPERATOR';
    entry.value.publishedAt = '2026-10-10T00:00:00Z';
    entry.updatedAt = new Date('2026-10-10T00:00:00Z');
  }
  f.rows[0].value.draft = complete('debug-status');
  assert.deepEqual(await f.service.downloadRules(), before);
});

test('an invalid unpublished draft does not block the last valid published rules', async () => {
  const f = fixture();
  f.rows.push(row('debug-status', complete('debug-status')));
  const before = await f.service.downloadRules();
  f.rows[0].value.draft = { values: { operator: 'PRIVATE-INVALID-DRAFT' } };
  assert.deepEqual(await f.service.downloadRules(), before);
});

test('every effective published field affects the content version; unpublishing removes the item', async () => {
  const mutations: Array<(config: GateConfig) => void> = [
    config => { config.enabled = false; }, config => { config.model = 'Q5'; }, config => { config.market = 'C'; },
    config => { config.displayName = '新的提示'; }, config => { config.helpText = '新的帮助'; },
    config => { config.values.expected = '1'; }, config => { config.failureAction = 'warn'; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); const config = complete('debug-status'); config.values.expected = '0';
    f.rows.push(row('debug-status', config));
    const before = await f.service.downloadRules();
    mutate(f.rows[0].value.active);
    const after = await f.service.downloadRules();
    assert.notEqual(after.version, before.version);
    f.rows[0] = row('debug-status', null, complete('debug-status'));
    const removed = await f.service.downloadRules();
    assert.notEqual(removed.version, after.version); assert.deepEqual(removed.items, []);
  }
});

test('invalid published check data fails the entire response without replacing it with defaults', async () => {
  for (const corrupt of [(entry: Row) => { entry.value.active.values.unrecognized = '1'; },
    (entry: Row) => { entry.value.active.values.operator = 'unsupported'; },
    (entry: Row) => { entry.value.active.values.expected = ''; },
    (entry: Row) => { entry.value.publishedAt = null; }]) {
    const f = fixture(); const entry = row('debug-status', complete('debug-status')); corrupt(entry); f.rows.push(entry);
    await assert.rejects(f.service.downloadRules(), (error: any) => error?.getStatus?.() === 500);
  }
});

test('non-check rows and unknown identifiers are never serialized or validated as client rules', async () => {
  const f = fixture();
  f.rows.push({ key: `${GATE_SETTING_PREFIX}command-1`, category: GATE_SETTING_CATEGORY, value: 'PRIVATE-COMMAND', updatedAt: new Date() },
    { key: `${GATE_SETTING_PREFIX}not-a-check`, category: GATE_SETTING_CATEGORY, value: 'UNKNOWN', updatedAt: new Date() });
  assert.deepEqual((await f.service.downloadRules()).items, []);
});

test('total-usage public projection preserves lt and historical lte without converting the bound', async () => {
  for (const operator of ['lt', 'lte']) {
    const f = fixture(); const config = complete('total-usage'); config.values.operator = operator; config.values.maximum = '20.5';
    f.rows.push(row('total-usage', config));
    const item = (await f.service.downloadRules()).items[0];
    assert.equal(item.values.operator, operator); assert.equal(item.values.maximum, '20.5');
  }
});

test('rules controller is registered as anonymous GET /factory-qc/rules with no page permission', () => {
  const reflector = new Reflector();
  const handler = FactoryQcPublicController.prototype.rules;
  const context = { getHandler: () => handler, getClass: () => FactoryQcPublicController, switchToHttp: () => ({ getRequest: () => ({}) }) } as any;
  assert.equal(reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, FactoryQcPublicController]), true);
  assert.equal(new JwtAuthGuard(reflector).canActivate(context), true);
  assert.equal(new RolesGuard(reflector).canActivate(context), true);
  assert.equal(Reflect.getMetadata('path', FactoryQcPublicController), 'factory-qc');
  assert.equal(Reflect.getMetadata('path', handler), 'rules');
  assert.equal(Reflect.getMetadata('method', handler), 0);
  assert.ok(Reflect.getMetadata('controllers', ElectronicGateModule).includes(FactoryQcPublicController));
});

test('rules controller sends raw 200 JSON and disables caches and conditional response headers', async () => {
  const payload = await fixture().service.downloadRules();
  const controller = new FactoryQcPublicController({} as any, { downloadRules: async () => payload } as any);
  const headers: Record<string, string> = { ETag: 'old', 'Last-Modified': 'old' };
  let status = 0, body = '';
  const response = {
    setHeader(key: string, value: string) { headers[key] = value; },
    removeHeader(key: string) { delete headers[key]; },
    status(value: number) { status = value; return this; },
    end(value: string) { body = value; },
  };
  await controller.rules(response as any);
  assert.equal(status, 200); assert.deepEqual(JSON.parse(body), payload);
  assert.match(headers['Content-Type'], /^application\/json/); assert.match(headers['Cache-Control'], /no-store/);
  assert.equal(headers.ETag, undefined); assert.equal(headers['Last-Modified'], undefined);
});

test('Nest resolves the added controller with a mock Prisma provider and no application bootstrap', async () => {
  const module = await Test.createTestingModule({ imports: [ElectronicGateModule] })
    .overrideProvider(PrismaService).useValue({ systemSetting: { findMany: async () => [] } }).compile();
  try {
    assert.ok(module.get(FactoryQcPublicController));
    assert.deepEqual((await module.get(ElectronicGateService).downloadRules()).items, []);
  } finally { await module.close(); }
});

test('anonymous HTTP rules download returns current unwrapped JSON for conditional requests and keeps errors uncached', async () => {
  const f = fixture();
  const module = await Test.createTestingModule({ imports: [ElectronicGateModule] })
    .overrideProvider(PrismaService).useValue({})
    .overrideProvider(ElectronicGateService).useValue(f.service)
    .overrideProvider(FactoryQcService).useValue({}).compile();
  const app = module.createNestApplication({ logger: false });
  const reflector = new Reflector();
  app.setGlobalPrefix('api');
  app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector));
  await app.listen(0, '127.0.0.1');
  try {
    const url = `${await app.getUrl()}/api/factory-qc/rules`;
    const headers = { 'If-None-Match': '*', 'If-Modified-Since': 'Wed, 09 Sep 2099 00:00:00 GMT' };
    const checkHeaders = (response: Response) => {
      assert.match(response.headers.get('content-type')!, /^application\/json/);
      assert.match(response.headers.get('cache-control')!, /no-store/);
      assert.equal(response.headers.get('etag'), null);
      assert.equal(response.headers.get('last-modified'), null);
    };
    const empty = await fetch(url, { headers });
    assert.equal(empty.status, 200); checkHeaders(empty);
    assert.deepEqual(await empty.json(), await f.service.downloadRules());

    f.rows.push(row('debug-status', complete('debug-status')));
    const published = await fetch(url, { headers });
    assert.equal(published.status, 200); checkHeaders(published);
    assert.deepEqual(await published.json(), await f.service.downloadRules());

    f.rows[0].value.active.values.operator = 'invalid';
    const invalid = await fetch(url, { headers });
    assert.equal(invalid.status, 500);
    assert.match(invalid.headers.get('content-type')!, /^application\/json/);
    assert.match(invalid.headers.get('cache-control')!, /no-store/);
    assert.doesNotMatch(await invalid.text(), /PRIVATE|invalid/);
    // Nest renders errors through its standard JSON handler, which may add an ETag.
    // The no-store directive and 500 status must still prevent a cached-success response.
    const retried = await fetch(url, { headers: { 'If-None-Match': invalid.headers.get('etag') ?? '*' } });
    assert.equal(retried.status, 500);
    assert.match(retried.headers.get('cache-control')!, /no-store/);
  } finally { await app.close(); }
});
