import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { protocolPublicationIssues } from '../src/modules/electronic-gate/factory-qc.release';
import { buildFactoryQcR5Draft, buildHistoricalFactoryQcCandidate, R5_SOURCE } from '../src/modules/electronic-gate/factory-qc.r5';
import { FACTORY_PROTOCOL_EXAMPLE } from '../src/modules/electronic-gate/factory-qc.example';
import { FactoryQcService } from '../src/modules/electronic-gate/factory-qc.service';
import type { FactoryProtocolCatalog } from '../src/modules/electronic-gate/factory-qc.contract';

function reorder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorder);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)]));
  return value;
}

test('来源护栏不依赖JSONB键序，历史候选与审核模板仅改版本仍受限', () => {
  for (const build of [buildHistoricalFactoryQcCandidate, buildFactoryQcR5Draft]) {
    const catalog = build();
    catalog.version = 'new-name-only';
    const reordered = reorder(catalog) as FactoryProtocolCatalog;
    assert.ok(protocolPublicationIssues(catalog).length);
    assert.deepEqual(protocolPublicationIssues(reordered), protocolPublicationIssues(catalog));
  }
});

test('保留模板版本不能改装使用；读取来源护栏不修改输入与旧v2', () => {
  const original = structuredClone(FACTORY_PROTOCOL_EXAMPLE);
  assert.deepEqual(protocolPublicationIssues(FACTORY_PROTOCOL_EXAMPLE), []);
  for (const version of [R5_SOURCE.historicalCandidateVersion, R5_SOURCE.reviewVersion]) {
    const unrelated = { ...structuredClone(FACTORY_PROTOCOL_EXAMPLE), version };
    assert.ok(protocolPublicationIssues(unrelated).length);
  }
  const template = buildFactoryQcR5Draft();
  const before = structuredClone(template);
  protocolPublicationIssues(template);
  assert.deepEqual(template, before);
  assert.deepEqual(FACTORY_PROTOCOL_EXAMPLE, original);
});

/** Historical rows are seeded in memory to check guard placement, without any database or writes. */
function existingStore(active: FactoryProtocolCatalog, historical: FactoryProtocolCatalog) {
  const state = {
    schemaVersion: 1, revision: 8, active: structuredClone(active), draft: null, draftBaseVersion: null,
    commands: [], history: [{ version: historical.version, revision: 2, publishedAt: '2026-09-09T00:00:00.000Z', publishedBy: 'fixture', reason: 'existing history' }],
  };
  const rows = new Map<string, { value: unknown }>([
    ['factory-qc.protocol.management', { value: state }],
    [`factory-qc.protocol.history.${encodeURIComponent(historical.version)}`, { value: { ...state.history[0], kind: 'protocol', content: historical } }],
  ]);
  let writes = 0;
  const model = {
    async findUnique({ where }: any) { return structuredClone(rows.get(where.key) ?? null); },
    async findMany() { return []; },
    async upsert() { writes++; throw new Error('Unexpected storage write'); },
  };
  const db: any = {
    systemSetting: model,
    async $transaction(operation: (tx: any) => Promise<unknown>) {
      return operation({ systemSetting: model, async $executeRaw() { return 1; } });
    },
  };
  return { service: new FactoryQcService(db), state, writes: () => writes };
}

test('历史原始模板不能通过回滚重新发布，失败保留当前active及版本', async () => {
  for (const build of [buildHistoricalFactoryQcCandidate, buildFactoryQcR5Draft]) {
    for (const renameVersion of [false, true]) {
      const historical = build();
      if (renameVersion) historical.version = 'old-renamed-template';
      const fixture = existingStore(FACTORY_PROTOCOL_EXAMPLE, historical);
      const before = structuredClone(fixture.state);
      await assert.rejects(
        fixture.service.rollback({ kind: 'protocol', version: historical.version, expectedRevision: 8 }, { name: 'test' }),
        (error: any) => error?.getStatus?.() === 400,
      );
      assert.deepEqual(await fixture.service.downloadProtocol(), FACTORY_PROTOCOL_EXAMPLE);
      assert.deepEqual(fixture.state, before);
      assert.equal(fixture.writes(), 0);
    }
  }
});

test('新增护栏不自动改写或撤下此前已经生效的候选内容', async () => {
  const oldActive = buildHistoricalFactoryQcCandidate();
  const fixture = existingStore(oldActive, FACTORY_PROTOCOL_EXAMPLE);
  const before = structuredClone(fixture.state);
  assert.deepEqual(await fixture.service.downloadProtocol(), oldActive);
  assert.deepEqual((await fixture.service.getState()).protocol.active, oldActive);
  assert.deepEqual(fixture.state, before);
  assert.equal(fixture.writes(), 0);
});
