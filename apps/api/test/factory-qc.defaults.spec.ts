import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { FactoryQcService } from '../src/modules/electronic-gate/factory-qc.service';
import { ElectronicGateService } from '../src/modules/electronic-gate/electronic-gate.service';
import { FACTORY_PROTOCOL_DEFAULT, FACTORY_SERIAL_DEFAULT } from '../src/modules/electronic-gate/factory-qc.defaults';
import { FACTORY_PROTOCOL_EXAMPLE } from '../src/modules/electronic-gate/factory-qc.example';
import { validateProtocolCatalog, validateSerialConfig } from '../src/modules/electronic-gate/factory-qc.contract';
import { FACTORY_SERIAL_ITEM_IDS, serialFromItems } from '../src/modules/electronic-gate/factory-qc.serial';
import { GATE_DEFINITIONS, GATE_SETTING_CATEGORY, GATE_SETTING_PREFIX } from '../src/modules/electronic-gate/electronic-gate.catalog';

type Row = { key: string; category: string; value: any; updatedAt: Date };
const actor = { id: 'default-test', name: '配置测试员' };

/** A transactional in-memory database; no credentials, actual database or network are used. */
function fixture() {
  let rows = new Map<string, Row>();
  let queue = Promise.resolve();
  let failedKey: string | null = null;
  const locks: string[] = [];
  const model = (get: () => Map<string, Row>) => ({
    async findUnique({ where }: any) { return structuredClone(get().get(where.key) ?? null); },
    async findMany({ where }: any) {
      return structuredClone([...get().values()].filter(row =>
        (!where.category || row.category === where.category) &&
        (!where.key?.startsWith || row.key.startsWith(where.key.startsWith)) &&
        (!where.key?.in || where.key.in.includes(row.key))));
    },
    async create({ data }: any) {
      if (failedKey && data.key.includes(failedKey)) throw new Error('Injected initialization write failure');
      if (get().has(data.key)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
      const row = { updatedAt: new Date(), ...structuredClone(data) };
      get().set(data.key, row); return structuredClone(row);
    },
    async upsert({ where, create, update }: any) {
      if (failedKey && where.key.includes(failedKey)) throw new Error('Injected initialization write failure');
      const row = { ...(get().get(where.key) ?? create), ...update, updatedAt: new Date() };
      get().set(where.key, structuredClone(row)); return structuredClone(row);
    },
    async updateMany({ where, data }: any) {
      const row = get().get(where.key);
      if (!row || row.value.revision !== where.value.equals) return { count: 0 };
      get().set(where.key, { ...row, ...structuredClone(data), updatedAt: new Date() }); return { count: 1 };
    },
  });
  const db: any = {
    systemSetting: model(() => rows),
    async $transaction(operation: (tx: any) => Promise<unknown>) {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const pending = structuredClone(rows);
      const tx = { systemSetting: model(() => pending), async $executeRaw(parts: TemplateStringsArray, key: string) {
        assert.match(parts.join(''), /pg_advisory_xact_lock/);
        assert.match(key, /^factory-qc:(serial|protocol)$/); locks.push(key); return 1;
      } };
      try { const result = await operation(tx); rows = pending; return result; } finally { release(); }
    },
  };
  const service = new FactoryQcService(db);
  const gate = new ElectronicGateService(db, service);
  return { service, gate, rows: () => rows, locks, fail: (key: string | null) => { failedKey = key; },
    put: (key: string, value: unknown, category = 'factory-qc') => rows.set(key, { key, category, value, updatedAt: new Date() }) };
}

test('current defaults retain safe disabled commands and the historical v2 source stays unchanged', () => {
  assert.deepEqual(validateProtocolCatalog(FACTORY_PROTOCOL_DEFAULT), FACTORY_PROTOCOL_DEFAULT);
  assert.deepEqual(validateSerialConfig(FACTORY_SERIAL_DEFAULT), FACTORY_SERIAL_DEFAULT);
  assert.equal(FACTORY_PROTOCOL_DEFAULT.version, 'builtin-20260909-v3');
  assert.equal(FACTORY_PROTOCOL_EXAMPLE.version, 'builtin-20260909-v2');
  const current = FACTORY_PROTOCOL_DEFAULT.profiles.find(profile => profile.id === 'v4-20260908')!;
  assert.equal(current.commands.filter(command => command.enabled !== false).length, 20);
  assert.deepEqual(current.commands.filter(command => command.enabled === false).map(command => command.queryCode).sort(), ['73', '78']);
  const temperature = current.commands.find(command => command.queryCode === '79')!;
  assert.equal(temperature.fields[0].type, 'int'); assert.equal(temperature.fields[0].length, 2);
  assert.equal(current.commands.find(command => command.queryCode === '86')!.responseCode, '86');
  assert.equal(FACTORY_PROTOCOL_DEFAULT.profiles.flatMap(profile => profile.commands.flatMap(command => command.fields)).some(field => field.rule != null), false);
});

test('application bootstrap publishes exact full defaults and immutable history while all QC rules stay unconfigured', async () => {
  const f = fixture();
  await f.service.onApplicationBootstrap();
  assert.deepEqual(await f.service.downloadProtocol(), FACTORY_PROTOCOL_DEFAULT);
  assert.deepEqual(await f.service.downloadSerial(), FACTORY_SERIAL_DEFAULT);
  const state = await f.service.getState();
  assert.equal(state.protocol.revision, 1); assert.equal(state.serial.revision, 1);
  assert.equal(state.protocol.draft, null); assert.equal(state.serial.readyCount, 12);
  assert.equal(state.protocol.history.length, 1); assert.equal(state.serial.history.length, 1);
  assert.ok(state.protocol.commands.every(command => command.active && command.draft === null && command.revision === 1));
  assert.deepEqual((await f.service.historyVersion('protocol', FACTORY_PROTOCOL_DEFAULT.version)).content, FACTORY_PROTOCOL_DEFAULT);
  assert.deepEqual((await f.service.historyVersion('serial', FACTORY_SERIAL_DEFAULT.version)).content, FACTORY_SERIAL_DEFAULT);
  const { items } = await f.gate.list();
  assert.equal(items.filter(item => item.active).length, 12);
  assert.ok(items.filter(item => item.category !== 'connection').every(item => item.active === null && item.draft === null && item.revision === 0));
  const active = Object.fromEntries(items.filter(item => item.category === 'connection').map(item => [item.id, item.active!]));
  assert.deepEqual(serialFromItems(active, FACTORY_SERIAL_DEFAULT.version), FACTORY_SERIAL_DEFAULT);
  assert.equal(f.rows().size, 16);
});

test('repeated and concurrent startup is idempotent across service instances', async () => {
  const f = fixture();
  await Promise.all([f.service.initializeDefaults(), f.service.initializeDefaults()]);
  const original = structuredClone(f.rows());
  assert.deepEqual(await f.service.initializeDefaults(), { protocol: 'preserved', serial: 'preserved' });
  assert.deepEqual(f.rows(), original);
  assert.equal(f.locks.filter(key => key === 'factory-qc:protocol').length, 3);
  assert.equal(f.locks.filter(key => key === 'factory-qc:serial').length, 3);
});

test('an existing catalog draft is preserved byte-for-byte while the empty serial domain initializes', async () => {
  const f = fixture();
  const privateCatalog = structuredClone(FACTORY_PROTOCOL_EXAMPLE);
  privateCatalog.version = 'custom-unpublished';
  await f.service.saveCatalogDraft({ expectedRevision: 0, catalog: privateCatalog });
  const original = structuredClone(f.rows().get('factory-qc.protocol.management'));
  assert.deepEqual(await f.service.initializeDefaults(), { protocol: 'preserved', serial: 'initialized' });
  assert.deepEqual(f.rows().get('factory-qc.protocol.management'), original);
  await assert.rejects(f.service.downloadProtocol(), (error: any) => error.getStatus() === 503);
  assert.deepEqual(await f.service.downloadSerial(), FACTORY_SERIAL_DEFAULT);
});

test('any single connection draft prevents seeding or silently completing the serial domain', async () => {
  const f = fixture();
  const definition = GATE_DEFINITIONS.find(item => item.id === 'baud-rate')!;
  const draft = structuredClone(definition.defaults); draft.values.baudRate = '9600';
  await f.gate.saveDraft('baud-rate', { expectedRevision: 0, draft }, actor);
  const original = structuredClone(f.rows().get(`${GATE_SETTING_PREFIX}baud-rate`));
  assert.deepEqual(await f.service.initializeDefaults(), { protocol: 'initialized', serial: 'preserved' });
  assert.deepEqual(f.rows().get(`${GATE_SETTING_PREFIX}baud-rate`), original);
  assert.equal([...f.rows().keys()].filter(key => key.startsWith(GATE_SETTING_PREFIX)).length, 1);
  await assert.rejects(f.service.downloadSerial(), (error: any) => error.getStatus() === 503);
  assert.ok(f.locks.filter(key => key === 'factory-qc:serial').length >= 2);
});

test('orphaned history, empty management records and unexpected categories are preserved rather than repaired', async () => {
  for (const key of ['factory-qc.protocol.history.old', 'factory-qc.protocol.management']) {
    const f = fixture(); f.put(key, { custom: 'existing data' }, 'legacy-category');
    const prior = structuredClone(f.rows().get(key));
    assert.equal((await f.service.initializeDefaults()).protocol, 'preserved');
    assert.deepEqual(f.rows().get(key), prior);
    assert.equal([...f.rows().keys()].filter(key => key.startsWith('factory-qc.protocol.')).length, 1);
  }
  for (const key of ['factory-qc.serial.history.old', 'factory-qc.serial.management', `${GATE_SETTING_PREFIX}serial-rts`]) {
    const f = fixture(); f.put(key, { custom: 'existing data' }, 'legacy-category');
    const prior = structuredClone(f.rows().get(key));
    assert.equal((await f.service.initializeDefaults()).serial, 'preserved');
    assert.deepEqual(f.rows().get(key), prior);
    assert.equal([...f.rows().keys()].filter(candidate => candidate.startsWith('factory-qc.serial.') || candidate.startsWith(GATE_SETTING_PREFIX)).length, 1);
  }
});

test('unrelated QC drafts are preserved and do not prevent initial communication defaults', async () => {
  const f = fixture();
  const draft = structuredClone(GATE_DEFINITIONS.find(item => item.id === 'default-sensitivity')!.defaults);
  await f.gate.saveDraft('default-sensitivity', { expectedRevision: 0, draft }, actor);
  const prior = structuredClone(f.rows().get(`${GATE_SETTING_PREFIX}default-sensitivity`));
  assert.deepEqual(await f.service.initializeDefaults(), { protocol: 'initialized', serial: 'initialized' });
  assert.deepEqual(f.rows().get(`${GATE_SETTING_PREFIX}default-sensitivity`), prior);
});

test('a failed protocol snapshot leaves no protocol rows and initialization can retry', async () => {
  const f = fixture(); f.fail('factory-qc.protocol.history.');
  await assert.rejects(f.service.initializeDefaults(), /Injected initialization/);
  assert.equal(f.rows().size, 0);
  f.fail(null); await f.service.initializeDefaults();
  assert.deepEqual(await f.service.downloadProtocol(), FACTORY_PROTOCOL_DEFAULT);
});

test('a failed serial snapshot rolls back all 12 items without rewriting the already committed protocol', async () => {
  const f = fixture(); f.fail('factory-qc.serial.history.');
  await assert.rejects(f.service.initializeDefaults(), /Injected initialization/);
  assert.equal(f.rows().size, 2);
  const protocol = structuredClone(f.rows().get('factory-qc.protocol.management'));
  assert.equal([...f.rows().keys()].some(key => key.startsWith(GATE_SETTING_PREFIX)), false);
  f.fail(null);
  assert.deepEqual(await f.service.initializeDefaults(), { protocol: 'preserved', serial: 'initialized' });
  assert.deepEqual(f.rows().get('factory-qc.protocol.management'), protocol);
});

test('initialized defaults support normal item editing, immutable history and serial rollback with private drafts preserved', async () => {
  const f = fixture(); await f.service.initializeDefaults();
  const item = (await f.gate.list()).items.find(item => item.id === 'baud-rate')!;
  const draft = structuredClone(item.active!); draft.values.baudRate = '9600';
  const saved = await f.gate.saveDraft(item.id, { expectedRevision: item.revision, draft }, actor);
  await f.gate.publish(item.id, { expectedRevision: saved.revision }, actor);
  assert.equal((await f.service.downloadSerial()).baudRate, 9600);
  const current = (await f.gate.list()).items.find(item => item.id === 'baud-rate')!;
  const privateDraft = structuredClone(current.active!); privateDraft.values.baudRate = '19200';
  await f.gate.saveDraft(item.id, { expectedRevision: current.revision, draft: privateDraft }, actor);
  const state = await f.service.getState();
  await f.service.rollback({ kind: 'serial', version: FACTORY_SERIAL_DEFAULT.version, expectedRevision: state.serial.revision }, actor);
  assert.deepEqual(await f.service.downloadSerial(), FACTORY_SERIAL_DEFAULT);
  const restored = (await f.gate.list()).items.find(item => item.id === 'baud-rate')!;
  assert.equal(restored.active!.values.baudRate, '115200');
  assert.equal(restored.draft!.values.baudRate, '19200');
  const prior = structuredClone(f.rows());
  await f.service.initializeDefaults();
  assert.deepEqual(f.rows(), prior);
});

test('example and public reads return isolated values and do not silently initialize empty storage', async () => {
  const f = fixture();
  const example = f.service.example(); example.version = 'caller-mutated';
  assert.equal(f.service.example().version, FACTORY_PROTOCOL_DEFAULT.version);
  await assert.rejects(f.service.downloadProtocol(), (error: any) => error.getStatus() === 503);
  assert.equal(f.rows().size, 0);
  await f.service.initializeDefaults();
  const catalog = await f.service.downloadProtocol(); catalog.profiles[0].name = 'caller-mutated';
  assert.deepEqual(await f.service.downloadProtocol(), FACTORY_PROTOCOL_DEFAULT);
  assert.equal(FACTORY_SERIAL_ITEM_IDS.length, 12);
});
