import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import express = require('express');
import { Reflector } from '@nestjs/core';
import { FactoryQcService, FACTORY_SERIAL_ITEM_IDS, serialConfigFromActiveItems } from '../src/modules/electronic-gate/factory-qc.service';
import { FactoryQcManagementController, FactoryQcPublicController } from '../src/modules/electronic-gate/factory-qc.controller';
import { FACTORY_PROTOCOL_EXAMPLE } from '../src/modules/electronic-gate/factory-qc.example';
import { buildFactoryQcR5Draft, buildHistoricalFactoryQcCandidate } from '../src/modules/electronic-gate/factory-qc.r5';
import { serialFromItems, serialToItemValues } from '../src/modules/electronic-gate/factory-qc.serial';
import { IS_PUBLIC_KEY } from '../src/modules/auth/decorators/public.decorator';
import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { GATE_SETTING_CATEGORY, GATE_SETTING_PREFIX, type GateConfig } from '../src/modules/electronic-gate/electronic-gate.catalog';

const actor = { id: 'factory-test', name: 'Factory test operator' };
const status = (code: number) => (error: any) => error?.getStatus?.() === code;
type Row = { key: string; category: string; value: any; description?: string; updatedAt: Date };

/** Transaction snapshots and a mutex model committed DB state; no .env or database is read. */
function fixture() {
  let rows = new Map<string, Row>();
  let queue = Promise.resolve();
  let failSnapshot = false;
  let advisoryLocks = 0;
  const model = (getRows: () => Map<string, Row>) => ({
    async findUnique({ where }: any) { return structuredClone(getRows().get(where.key) ?? null); },
    async findMany({ where }: any) { return structuredClone([...getRows().values()].filter(row => (!where.category || row.category === where.category) && (!where.key?.startsWith || row.key.startsWith(where.key.startsWith)))); },
    async create({ data }: any) {
      if (failSnapshot && data.key.includes('.history.')) throw new Error('Injected snapshot write failure');
      if (getRows().has(data.key)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
      const row = { updatedAt: new Date(), ...structuredClone(data) };
      getRows().set(data.key, row); return structuredClone(row);
    },
    async upsert({ where, create, update }: any) {
      const row = { ...(getRows().get(where.key) ?? create), ...update, updatedAt: new Date() };
      getRows().set(where.key, structuredClone(row)); return structuredClone(row);
    },
    async updateMany({ where, data }: any) {
      const row = getRows().get(where.key);
      if (!row || row.value.revision !== where.value.equals) return { count: 0 };
      getRows().set(where.key, { ...row, ...structuredClone(data), updatedAt: new Date() }); return { count: 1 };
    },
  });
  const db: any = {
    systemSetting: model(() => rows),
    async $transaction(operation: (tx: any) => Promise<unknown>) {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const working = structuredClone(rows);
      const tx = { systemSetting: model(() => working), async $executeRaw(strings: TemplateStringsArray, lock: string) {
        assert.match(strings.join(''), /pg_advisory_xact_lock/);
        assert.match(lock, /^factory-qc:(serial|protocol)$/);
        advisoryLocks++; return 1;
      } };
      try { const result = await operation(tx); rows = working; return result; }
      finally { release(); }
    },
  };
  return { service: new FactoryQcService(db), db, getRows: () => rows, failNextSnapshots: () => { failSnapshot = true; }, getLocks: () => advisoryLocks };
}

async function firstProtocol(service: FactoryQcService) {
  const draft = await service.saveCatalogDraft({ expectedRevision: 0, catalog: structuredClone(FACTORY_PROTOCOL_EXAMPLE) });
  return service.publishCatalog({ expectedRevision: draft.protocol.revision }, actor);
}
function serialItems(): Record<string, GateConfig> {
  const values: Record<string, Record<string, string>> = {
    'serial-port': { mode: 'auto', port: '' }, 'baud-rate': { baudRate: '115200' },
    'response-timeout': { timeoutMs: '1500' }, 'retry-delay': { retrySeconds: '5' },
    'data-bits': { dataBits: '8' }, 'serial-parity': { parity: 'none' }, 'stop-bits': { stopBits: '1' },
    'auto-connect': { autoConnect: 'true' }, 'serial-handshake': { handshake: 'None' },
    'serial-dtr': { dtrEnable: 'true' }, 'serial-rts': { rtsEnable: 'false' }, 'scan-interval': { scanIntervalMs: '1000' },
  };
  return Object.fromEntries(FACTORY_SERIAL_ITEM_IDS.map(id => [id, { enabled: true, model: 'PRIVATE-MODEL', market: 'PRIVATE-MARKET', displayName: 'PRIVATE-DISPLAY', helpText: 'PRIVATE-HELP', failureAction: 'block', values: values[id] }]));
}
async function commitSerial(testFixture: ReturnType<typeof fixture>, items: Record<string, GateConfig>) {
  return testFixture.db.$transaction(async (tx: any) => {
    await testFixture.service.lockSerial(tx);
    for (const [id, active] of Object.entries(items)) {
      const key = `${GATE_SETTING_PREFIX}${id}`;
      const prior = await tx.systemSetting.findUnique({ where: { key } });
      const value = { schemaVersion: 1, revision: (prior?.value.revision ?? 0) + 1, draft: prior?.value.draft ?? null, active, updatedBy: actor.name, publishedAt: new Date().toISOString() };
      await tx.systemSetting.upsert({ where: { key }, create: { key, category: GATE_SETTING_CATEGORY, value }, update: { value } });
    }
    return testFixture.service.publishSerialFromActiveItems(tx, items, actor);
  });
}

test('unpublished downloads return 503 and reading examples does not publish or store anything', async () => {
  const { service, getRows } = fixture();
  assert.equal(service.example().profiles.length, 2);
  await assert.rejects(service.downloadProtocol(), status(503));
  await assert.rejects(service.downloadSerial(), status(503));
  await assert.rejects(service.publishCatalog({ expectedRevision: 0 }, actor), status(400));
  assert.equal(getRows().size, 0);
});

test('sample assertions and duplicate JSON keys fail before any draft is persisted', async () => {
  const { service, getRows } = fixture();
  const catalog = structuredClone(FACTORY_PROTOCOL_EXAMPLE);
  catalog.profiles[0].commands[0].samples[0].expected.value = 'WRONG';
  await assert.rejects(service.saveCatalogDraft({ expectedRevision: 0, catalog }), status(400));
  await assert.rejects(service.saveCatalogDraft({ expectedRevision: 0, json: '{"version":"a","version":"b"}' }), status(400));
  assert.equal(getRows().size, 0);
});

test('full draft remains private and first publication returns the exact complete contract', async () => {
  const { service } = fixture();
  const saved = await service.saveCatalogDraft({ expectedRevision: 0, catalog: FACTORY_PROTOCOL_EXAMPLE });
  await assert.rejects(service.downloadProtocol(), status(503));
  const published = await service.publishCatalog({ expectedRevision: saved.protocol.revision }, actor);
  assert.deepEqual(await service.downloadProtocol(), FACTORY_PROTOCOL_EXAMPLE);
  assert.equal(published.protocol.draft, null);
  const changed = structuredClone(FACTORY_PROTOCOL_EXAMPLE);
  changed.version = 'private-next'; changed.profiles[0].name = 'PRIVATE-DRAFT';
  await service.saveCatalogDraft({ expectedRevision: published.protocol.revision, catalog: changed });
  assert.equal(JSON.stringify(await service.downloadProtocol()).includes('PRIVATE'), false);
});

test('initial catalog supports independent structured command drafts without publishing a baseline', async () => {
  const { service } = fixture();
  const initial = await service.saveCatalogDraft({ expectedRevision: 0, catalog: buildFactoryQcR5Draft() });
  const [a, b] = initial.protocol.commands.filter(item => item.profileId === 'v4-20260908').slice(0, 2);
  assert.equal(a.active, null);
  await Promise.all([
    service.saveCommandDraft(a.profileId, a.commandId, { expectedRevision: a.revision, command: { ...a.draft!, name: 'Initial A draft' } }),
    service.saveCommandDraft(b.profileId, b.commandId, { expectedRevision: b.revision, command: { ...b.draft!, name: 'Initial B draft' } }),
  ]);
  const result = await service.getState();
  assert.deepEqual(result.protocol.draft!.profiles[1].commands.slice(0, 2).map(command => command.name), ['Initial A draft', 'Initial B draft']);
  assert.equal(result.protocol.active, null);
  assert.equal(result.protocol.history.length, 0);
  await assert.rejects(service.downloadProtocol(), status(503));
  await assert.rejects(service.publishCommand(a.profileId, a.commandId, { expectedRevision: a.revision + 1 }, actor), status(400));
  await assert.rejects(service.saveCommandDraft(a.profileId, a.commandId, { expectedRevision: a.revision, command: a.draft }), status(409));
});

test('publishing the first complete catalog uses latest saved per-command changes and clears initial drafts', async () => {
  const { service } = fixture();
  const initial = await service.saveCatalogDraft({ expectedRevision: 0, catalog: FACTORY_PROTOCOL_EXAMPLE });
  const a = initial.protocol.commands[0];
  const edited = await service.saveCommandDraft(a.profileId, a.commandId, { expectedRevision: a.revision, command: { ...a.draft!, name: 'Updated before first publication' } });
  await assert.rejects(service.publishCatalog({ expectedRevision: initial.protocol.revision }, actor), status(409));
  const result = await service.publishCatalog({ expectedRevision: edited.protocol.revision }, actor);
  assert.equal(result.protocol.active!.profiles[0].commands[0].name, 'Updated before first publication');
  assert.equal(result.protocol.draft, null);
  assert.ok(result.protocol.commands.every(command => command.active && !command.draft));
});

test('complete initial import invalidates old editors including a removed and re-added command', async () => {
  const { service } = fixture();
  let state = await service.saveCatalogDraft({ expectedRevision: 0, catalog: FACTORY_PROTOCOL_EXAMPLE });
  const old = state.protocol.commands.find(item => item.profileId === 'legacy-v1' && item.commandId === 'valve')!;
  const removed = structuredClone(FACTORY_PROTOCOL_EXAMPLE);
  removed.profiles[0].commands = removed.profiles[0].commands.filter(command => command.id !== old.commandId);
  state = await service.saveCatalogDraft({ expectedRevision: state.protocol.revision, catalog: removed });
  await assert.rejects(service.saveCommandDraft(old.profileId, old.commandId, { expectedRevision: old.revision, command: old.draft }), status(404));
  state = await service.saveCatalogDraft({ expectedRevision: state.protocol.revision, catalog: FACTORY_PROTOCOL_EXAMPLE });
  const current = state.protocol.commands.find(item => item.profileId === old.profileId && item.commandId === old.commandId)!;
  assert.ok(current.revision > old.revision);
  await assert.rejects(service.saveCommandDraft(old.profileId, old.commandId, { expectedRevision: old.revision, command: old.draft }), status(409));
});

test('existing unpublished catalogs without command rows remain editable without a storage migration', async () => {
  const { service, getRows } = fixture();
  await service.saveCatalogDraft({ expectedRevision: 0, catalog: FACTORY_PROTOCOL_EXAMPLE });
  getRows().get('factory-qc.protocol.management')!.value.commands = [];
  const view = await service.getState();
  const command = view.protocol.commands[0];
  assert.equal(command.revision, 0);
  const saved = await service.saveCommandDraft(command.profileId, command.commandId, { expectedRevision: command.revision, command: { ...command.draft!, name: 'Migrated draft edit' } });
  assert.equal(saved.protocol.draft!.profiles[0].commands[0].name, 'Migrated draft edit');
  assert.equal(saved.protocol.active, null);
});

test('historical candidate and r5 review template are draft-only even when only their version is renamed', async () => {
  for (const build of [buildHistoricalFactoryQcCandidate, buildFactoryQcR5Draft]) {
    for (const renamed of [false, true]) {
      const { service } = fixture();
      const catalog = build();
      if (renamed) catalog.version = 'release-name-only';
      const state = await service.saveCatalogDraft({ expectedRevision: 0, catalog });
      await assert.rejects(service.publishCatalog({ expectedRevision: state.protocol.revision }, actor), status(400));
      assert.equal((await service.getState()).protocol.revision, state.protocol.revision);
      assert.deepEqual((await service.getState()).protocol.draft, catalog);
      await assert.rejects(service.downloadProtocol(), status(503));
    }
  }
});

test('r5 draft generation and import preserve current published and historical v2 content', async () => {
  const { service } = fixture();
  const initial = await firstProtocol(service);
  const r5 = buildFactoryQcR5Draft();
  await service.saveCatalogDraft({ expectedRevision: initial.protocol.revision, catalog: r5 });
  assert.deepEqual(await service.downloadProtocol(), FACTORY_PROTOCOL_EXAMPLE);
  assert.deepEqual((await service.historyVersion('protocol', FACTORY_PROTOCOL_EXAMPLE.version)).content, FACTORY_PROTOCOL_EXAMPLE);
});

test('independent command saves and publications preserve other published values and private drafts', async () => {
  const { service, getLocks } = fixture();
  const initial = await firstProtocol(service);
  const [a, b] = initial.protocol.commands.filter(item => item.profileId === initial.protocol.active!.profiles[0].id).slice(0, 2);
  const draftA = { ...a.active!, name: 'A published change' }, draftB = { ...b.active!, name: 'PRIVATE-B' };
  await Promise.all([service.saveCommandDraft(a.profileId, a.commandId, { expectedRevision: a.revision, command: draftA }), service.saveCommandDraft(b.profileId, b.commandId, { expectedRevision: b.revision, command: draftB })]);
  const before = await service.getState();
  const savedA = before.protocol.commands.find(item => item.commandId === a.commandId && item.profileId === a.profileId)!;
  const savedB = before.protocol.commands.find(item => item.commandId === b.commandId && item.profileId === b.profileId)!;
  await service.publishCommand(a.profileId, a.commandId, { expectedRevision: savedA.revision }, actor);
  const publishedA = await service.downloadProtocol();
  assert.equal(publishedA.profiles[0].commands[0].name, draftA.name);
  assert.equal(publishedA.profiles[0].commands[1].name, b.active!.name);
  assert.equal((await service.getState()).protocol.commands.find(item => item.profileId === b.profileId && item.commandId === b.commandId)!.draft!.name, 'PRIVATE-B');
  await service.publishCommand(b.profileId, b.commandId, { expectedRevision: savedB.revision }, actor);
  const publishedB = await service.downloadProtocol();
  assert.equal(publishedB.profiles[0].commands[0].name, draftA.name);
  assert.equal(publishedB.profiles[0].commands[1].name, draftB.name);
  assert.notEqual(publishedA.version, publishedB.version);
  assert.ok(getLocks() >= 6);
});

test('same command races return 409 while distinct concurrent publications retain both changes', async () => {
  const { service } = fixture();
  const initial = await firstProtocol(service), [a, b] = initial.protocol.commands.slice(0, 2);
  const sameCommand = await Promise.allSettled([1, 2].map(i => service.saveCommandDraft(a.profileId, a.commandId, { expectedRevision: a.revision, command: { ...a.active, name: `race ${i}` } })));
  assert.equal(sameCommand.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((sameCommand.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.getStatus(), 409);
  await service.saveCommandDraft(b.profileId, b.commandId, { expectedRevision: b.revision, command: { ...b.active, name: 'second concurrent' } });
  const state = await service.getState();
  const targets = state.protocol.commands.slice(0, 2);
  await Promise.all(targets.map(item => service.publishCommand(item.profileId, item.commandId, { expectedRevision: item.revision }, actor)));
  const active = await service.downloadProtocol();
  assert.match(active.profiles[0].commands[0].name, /^race /);
  assert.equal(active.profiles[0].commands[1].name, 'second concurrent');
});

test('profile metadata and new firmware use a complete package; stale packages cannot overwrite command changes', async () => {
  const { service } = fixture();
  const state = await firstProtocol(service);
  const catalog = structuredClone(state.protocol.active!);
  catalog.version = 'metadata-next'; catalog.profiles[0].name = 'Profile metadata updated';
  const packageState = await service.saveCatalogDraft({ expectedRevision: state.protocol.revision, catalog });
  const a = packageState.protocol.commands[0];
  const saved = await service.saveCommandDraft(a.profileId, a.commandId, { expectedRevision: a.revision, command: { ...a.active, name: 'single change' } });
  const command = saved.protocol.commands[0];
  const published = await service.publishCommand(command.profileId, command.commandId, { expectedRevision: command.revision }, actor);
  await assert.rejects(service.publishCatalog({ expectedRevision: published.protocol.revision }, actor), status(409));
  assert.equal((await service.downloadProtocol()).profiles[0].commands[0].name, 'single change');
});

test('protocol history is immutable and rollback restores its original version and synchronizes management active', async () => {
  const { service } = fixture();
  const initial = await firstProtocol(service), a = initial.protocol.commands[0];
  const saved = await service.saveCommandDraft(a.profileId, a.commandId, { expectedRevision: a.revision, command: { ...a.active, name: 'changed' } });
  const updated = await service.publishCommand(a.profileId, a.commandId, { expectedRevision: saved.protocol.commands[0].revision }, actor);
  const original = await service.historyVersion('protocol', FACTORY_PROTOCOL_EXAMPLE.version);
  assert.deepEqual(original.content, FACTORY_PROTOCOL_EXAMPLE);
  await service.rollback({ kind: 'protocol', version: original.version, expectedRevision: updated.protocol.revision }, actor);
  assert.deepEqual(await service.downloadProtocol(), FACTORY_PROTOCOL_EXAMPLE);
  assert.deepEqual((await service.getState()).protocol.commands[0].active, FACTORY_PROTOCOL_EXAMPLE.profiles[0].commands[0]);
  assert.deepEqual((await service.historyVersion('protocol', original.version)).content, original.content);
});

test('partial serial publication stays unavailable; complete projection excludes every management field', async () => {
  const f = fixture(), items = serialItems();
  const partial = { ...items }; delete partial['serial-rts'];
  await commitSerial(f, partial);
  assert.equal((await f.service.getState()).serial.readyCount, 11);
  await assert.rejects(f.service.downloadSerial(), status(503));
  await commitSerial(f, items);
  const result = await f.service.downloadSerial();
  assert.equal(result.portName, 'auto'); assert.equal(result.retryDelayMs, 5000);
  assert.equal(Object.keys(result).length, 14);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal((await f.service.getState()).serial.readyCount, 12);
});

test('serial rollback restores individual active values, keeps drafts and invalidates stale item revisions', async () => {
  const f = fixture(), items = serialItems();
  await commitSerial(f, items);
  const original = await f.service.downloadSerial();
  items['baud-rate'].values.baudRate = '9600';
  await commitSerial(f, items);
  const key = `${GATE_SETTING_PREFIX}baud-rate`;
  const row = f.getRows().get(key)!;
  row.value.draft = { ...structuredClone(row.value.active), values: { baudRate: '19200' } };
  const revision = row.value.revision;
  await f.service.rollback({ kind: 'serial', version: original.version, expectedRevision: (await f.service.getState()).serial.revision }, actor);
  assert.deepEqual(await f.service.downloadSerial(), original);
  const restored = f.getRows().get(key)!.value;
  assert.equal(restored.active.values.baudRate, '115200');
  assert.equal(restored.draft.values.baudRate, '19200');
  assert.equal(restored.revision, revision + 1);
});

test('serial rollback accepts equivalent JSONB snapshot objects with reordered keys', async () => {
  const f = fixture(), items = serialItems();
  await commitSerial(f, items);
  const original = await f.service.downloadSerial();
  const historicalRow = [...f.getRows().values()].find(row => row.key.includes('.serial.history.') && row.value.version === original.version)!;
  historicalRow.value.content = Object.fromEntries(Object.entries(historicalRow.value.content).reverse());
  items['baud-rate'].values.baudRate = '9600';
  await commitSerial(f, items);
  await f.service.rollback({ kind: 'serial', version: original.version, expectedRevision: (await f.service.getState()).serial.revision }, actor);
  assert.deepEqual(await f.service.downloadSerial(), original);
  assert.equal(f.getRows().get(`${GATE_SETTING_PREFIX}baud-rate`)!.value.active.values.baudRate, '115200');
});

test('snapshot write failure rolls back serial active rows and download state together', async () => {
  const f = fixture(), items = serialItems();
  await commitSerial(f, items);
  const before = structuredClone(f.getRows());
  f.failNextSnapshots(); items['baud-rate'].values.baudRate = '9600';
  await assert.rejects(commitSerial(f, items), /Injected snapshot/);
  assert.deepEqual(f.getRows(), before);
});

test('public endpoints allow anonymous reads, management endpoints require their own page permission', () => {
  const reflector = new Reflector(), guard = new RolesGuard(reflector);
  const context = (controller: any, method: string) => ({ getHandler: () => controller.prototype[method], getClass: () => controller, switchToHttp: () => ({ getRequest: () => ({}) }) } as any);
  for (const method of ['serial', 'protocol', 'rules']) {
    assert.equal(reflector.getAllAndOverride(IS_PUBLIC_KEY, [FactoryQcPublicController.prototype[method as 'serial'], FactoryQcPublicController]), true);
    assert.equal(guard.canActivate(context(FactoryQcPublicController, method)), true);
  }
  assert.deepEqual(reflector.get(PERMISSIONS_KEY, FactoryQcManagementController), ['page:electronic-gate']);
  assert.equal(guard.canActivate(context(FactoryQcManagementController, 'state')), false);
});

test('conditional requests still receive unwrapped 200 JSON with no caching or ETag', async () => {
  const f = fixture(); await firstProtocol(f.service);
  const controller = new FactoryQcPublicController(f.service, {} as any);
  const app = express();
  app.get('/protocol', (_request, response, next) => { void controller.protocol(response).catch(next); });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/protocol`, { headers: { 'If-None-Match': '*', 'If-Modified-Since': 'Wed, 09 Sep 2099 00:00:00 GMT' } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type')!, /^application\/json/);
    assert.match(response.headers.get('cache-control')!, /no-store/);
    assert.equal(response.headers.get('etag'), null);
    assert.deepEqual(await response.json(), FACTORY_PROTOCOL_EXAMPLE);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('disabled legacy serial rows remain unready and are never completed with reference defaults', () => {
  const items = serialItems(); items['auto-connect'].enabled = false;
  assert.equal(serialConfigFromActiveItems(items, 'test'), null);
});

test('serial forward and reverse projections round-trip fixed ports, booleans and fractional retry seconds', () => {
  const items = serialItems();
  items['serial-port'].values = { mode: 'fixed', port: 'COM7' };
  items['retry-delay'].values.retrySeconds = '1.125';
  items['auto-connect'].values.autoConnect = 'false';
  items['stop-bits'].values.stopBits = '1.5';
  const serial = serialFromItems(items, 'roundtrip')!;
  assert.equal(serial.retryDelayMs, 1125);
  const restoredValues = serialToItemValues(serial);
  const restored = Object.fromEntries(Object.entries(items).map(([id, item]) => [id, { ...item, values: restoredValues[id] }]));
  assert.deepEqual(serialFromItems(restored, serial.version), serial);
  assert.throws(() => serialToItemValues({ schemaVersion: 1, version: 'missing' }), /缺少/);
});

test('explicit complete catalog publication supports profile metadata and a new distinguishable firmware', async () => {
  const { service } = fixture();
  const state = await firstProtocol(service);
  const catalog = structuredClone(state.protocol.active!);
  catalog.version = 'profile-added'; catalog.profiles[0].name = 'Updated profile metadata';
  const firmware = structuredClone(catalog.profiles[0].commands[0]);
  firmware.payloadLength = 5; firmware.fields[0].length = 5;
  firmware.samples = [{ frameHex: 'F5 09 F6 72 01 02 03 04 05', expected: { value: 'V0102030405' } }];
  catalog.profiles.push({ id: 'new-firmware', name: 'New firmware profile', commands: [firmware] });
  const draft = await service.saveCatalogDraft({ expectedRevision: state.protocol.revision, catalog });
  assert.equal((await service.downloadProtocol()).profiles.length, 2);
  await service.publishCatalog({ expectedRevision: draft.protocol.revision }, actor);
  assert.deepEqual(await service.downloadProtocol(), catalog);
});
