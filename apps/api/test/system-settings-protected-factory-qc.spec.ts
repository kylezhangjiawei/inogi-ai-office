import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { SystemSettingsService } from '../src/modules/system-settings/system-settings.service';

type Row = { id: string; key: string; category: string; value: Record<string, unknown>; description?: string };
const forbidden = (error: any) => error?.getStatus?.() === 403;
const protectedRows: Row[] = [
  { id: 'gate-item', key: 'electronic-gate.item.baud-rate', category: 'electronic-gate', value: { active: 'gate-active', draft: 'private' } },
  { id: 'factory-history', key: 'factory-qc.protocol.history.version-1', category: 'factory-qc', value: { immutable: true } },
  { id: 'gate-category-only', key: 'legacy-gate-config', category: 'electronic-gate', value: { private: true } },
  { id: 'factory-category-only', key: 'legacy-factory-config', category: 'factory-qc', value: { private: true } },
  { id: 'gate-prefix-only', key: 'electronic-gate.future.setting', category: 'legacy', value: { private: true } },
  { id: 'factory-prefix-only', key: 'factory-qc.serial.management', category: 'legacy', value: { private: true } },
];

function fixture() {
  const rows = structuredClone([...protectedRows,
    { id: 'ordinary', key: 'ordinary.setting', category: 'ordinary', value: { enabled: true } },
    { id: 'similar', key: 'factory-qcx.setting', category: 'factory-qcx', value: { ordinary: true } },
  ]);
  let writes = 0;
  const matches = (row: Row, where: any): boolean => {
    if (where.NOT) return !matches(row, where.NOT);
    if (where.OR) return where.OR.some((part: any) => matches(row, part));
    if (where.category?.in) return where.category.in.includes(row.category);
    if (where.key?.startsWith) return row.key.startsWith(where.key.startsWith);
    throw new Error('Unexpected query predicate');
  };
  const db = { systemSetting: {
    async findMany({ where, orderBy }: any) {
      assert.deepEqual(orderBy, [{ category: 'asc' }, { key: 'asc' }]);
      return structuredClone(rows.filter(row => !where || matches(row, where)).sort((a, b) => a.category.localeCompare(b.category) || a.key.localeCompare(b.key)));
    },
    async findUnique({ where }: any) { return structuredClone(rows.find(row => where.id ? row.id === where.id : row.key === where.key) ?? null); },
    async update({ where, data }: any) {
      const row = rows.find(row => row.id === where.id);
      if (!row) throw new Error('Missing setting');
      writes++; Object.assign(row, structuredClone(data)); return structuredClone(row);
    },
    async upsert({ where, create, update }: any) {
      writes++;
      const row = rows.find(row => row.key === where.key);
      if (row) { Object.assign(row, structuredClone(update)); return structuredClone(row); }
      const created = { id: `new-${writes}`, ...structuredClone(create) }; rows.push(created); return structuredClone(created);
    },
  } };
  return { service: new SystemSettingsService(db as any), rows, writes: () => writes };
}

test('generic list excludes protected categories and namespaces while keeping ordinary settings', async () => {
  const { service, writes } = fixture();
  const listed = await service.list();
  assert.deepEqual(listed.map(row => row.id), ['similar', 'ordinary']);
  assert.equal(writes(), 0);
});

test('generic creation cannot enter either protected category', async () => {
  const { service, writes } = fixture();
  for (const category of ['electronic-gate', 'factory-qc']) {
    await assert.rejects(service.save({ category, key: 'ordinary-new-key', value: { bypass: true } }), forbidden);
  }
  assert.equal(writes(), 0);
});

test('disguising the category cannot write either protected key namespace', async () => {
  const { service, writes } = fixture();
  for (const key of ['electronic-gate.item.new', 'electronic-gate.future.new', 'factory-qc.protocol.history.version-2', 'factory-qc.serial.management']) {
    await assert.rejects(service.save({ category: 'ordinary', key, value: { bypass: true } }), forbidden);
  }
  assert.equal(writes(), 0);
});

test('protected records cannot be renamed by id into an ordinary category and key', async () => {
  const { service, rows, writes } = fixture();
  const before = structuredClone(rows);
  for (const row of protectedRows) {
    await assert.rejects(service.save({ id: row.id, category: 'ordinary', key: `renamed-${row.id}`, value: { bypass: true } }), forbidden);
  }
  assert.deepEqual(rows, before);
  assert.equal(writes(), 0);
});

test('upsert checks an existing protected category even when its legacy key looks ordinary', async () => {
  const { service, rows, writes } = fixture();
  const before = structuredClone(rows);
  for (const key of ['legacy-gate-config', 'legacy-factory-config']) {
    await assert.rejects(service.save({ category: 'ordinary', key, value: { overwrite: true } }), forbidden);
  }
  assert.deepEqual(rows, before);
  assert.equal(writes(), 0);
});

test('id updates also check the destination key owner and cannot move ordinary rows into protected storage', async () => {
  const { service, rows, writes } = fixture();
  const before = structuredClone(rows);
  await assert.rejects(service.save({ id: 'ordinary', category: 'ordinary', key: 'legacy-factory-config', value: { overwrite: true } }), forbidden);
  await assert.rejects(service.save({ id: 'ordinary', category: 'factory-qc', key: 'ordinary.setting', value: { overwrite: true } }), forbidden);
  assert.deepEqual(rows, before);
  assert.equal(writes(), 0);
});

test('ordinary settings keep create, key upsert, id rename and list behavior', async () => {
  const { service, rows, writes } = fixture();
  const beforeProtected = structuredClone(rows.filter(row => protectedRows.some(item => item.id === row.id)));
  const created = await service.save({ category: 'ordinary', key: 'new.setting', value: { stage: 1 }, description: 'created' });
  const updated = await service.save({ category: 'changed-category', key: 'new.setting', value: { stage: 2 }, description: 'upserted' });
  assert.equal(updated.id, created.id);
  const renamed = await service.save({ id: created.id, category: 'ordinary', key: 'renamed.setting', value: { stage: 3 }, description: 'renamed' });
  assert.deepEqual([renamed.key, renamed.value, renamed.description], ['renamed.setting', { stage: 3 }, 'renamed']);
  assert.ok((await service.list()).some(row => row.id === created.id && row.key === 'renamed.setting'));
  assert.deepEqual(rows.filter(row => protectedRows.some(item => item.id === row.id)), beforeProtected);
  assert.equal(writes(), 3);
});
