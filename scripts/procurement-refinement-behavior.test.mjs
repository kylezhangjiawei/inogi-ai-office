import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

import {
  createLatestRequestGate,
  lowestActiveTierByCurrency,
  resolveProcurementOwner,
  selectFailedQuoteImportEntries,
  uniqueRosterUserIdsByName,
} from "../src/app/procurement/procurementLogic.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function procurementStoreFixture() {
  const source = readFileSync(new URL("../src/app/procurement/data.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let user = { id: 'A', name: '同名采购员', roleId: 'buyer', departmentCode: 'PROC', permissions: ['page:procurement'] };
  let clearListener;
  const requests = [];
  const effects = [];
  const exports = {};
  const dependencies = {
    react: {
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
      useEffect: (fn) => effects.push(fn),
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    },
    '../auth': { useAuth: () => ({ user }) },
    '../lib/authSession': { getStoredUser: () => user, addAuthClearedListener: (fn) => { clearListener = fn; } },
    '../lib/procurementApi': {
      listProcTasks: () => {
        const request = deferred();
        requests.push({ ...request, userId: user?.id });
        return request.promise;
      },
      listMaterials: async () => [],
    },
    '../lib/rdApi': {},
  };
  new Function('exports', 'require', 'window', code)(exports, (name) => {
    assert.ok(dependencies[name], `unexpected dependency: ${name}`);
    return dependencies[name];
  }, undefined);
  return {
    api: exports, requests,
    render() { const snapshot = exports.useProcurementData(); while (effects.length) effects.shift()(); return snapshot; },
    switchUser(next) { user = next ? { ...user, ...next } : null; },
    logout() { user = null; clearListener(); },
  };
}

test('采购共享缓存退出后清空，切换账号首屏不显示上一账号数据并重新加载', async () => {
  const store = procurementStoreFixture();
  const first = store.api.refreshProcurement();
  store.requests[0].resolve([{ id: 'A-task' }]);
  await first;
  assert.equal(store.render().tasks[0].id, 'A-task');
  store.logout();
  assert.deepEqual(store.render().tasks, []);
  store.switchUser({ id: 'B', name: '同名采购员', roleId: 'buyer', permissions: ['page:procurement'] });
  assert.deepEqual(store.render().tasks, []);
  assert.equal(store.requests.length, 2);
  assert.equal(store.requests[1].userId, 'B');
  store.requests[1].resolve([{ id: 'B-task' }]);
  await new Promise(setImmediate);
  assert.equal(store.render().tasks[0].id, 'B-task');
});

test('旧账号在途读取、排队刷新和写结果不能回填新账号的同 ID 任务', async () => {
  const store = procurementStoreFixture();
  const oldRead = store.api.refreshProcurement();
  const oldQueue = store.api.refreshProcurement();
  const oldWriteScope = store.api.captureProcurementScope();
  store.switchUser({ id: 'B' });
  const nextRead = store.api.refreshProcurement();
  store.requests[1].resolve([{ id: 'shared-task', status: 'pending_confirm', owner: 'B' }]);
  await nextRead;
  store.requests[0].resolve([{ id: 'shared-task', status: 'completed', owner: 'A' }]);
  await Promise.all([oldRead, oldQueue]);
  store.api.applyProcTaskUpdate({ id: 'shared-task', status: 'completed', owner: 'A' }, oldWriteScope);
  assert.equal(store.requests.length, 2, '旧账号排队刷新不得启动新请求');
  assert.deepEqual(store.render().tasks, [{ id: 'shared-task', status: 'pending_confirm', owner: 'B' }]);
});

test('同账号权限变化使缓存失效，同作用域共享加载和写后排队刷新仍有效', async () => {
  const store = procurementStoreFixture();
  store.render();
  store.render();
  assert.equal(store.requests.length, 1, '多个消费者仅首次加载一次');
  const queued = store.api.refreshProcurement();
  store.requests[0].resolve([{ id: 'old-snapshot' }]);
  await new Promise(setImmediate);
  assert.equal(store.requests.length, 2, '写后刷新必须读取晚于写入的快照');
  store.requests[1].resolve([{ id: 'latest-snapshot' }]);
  await queued;
  assert.equal(store.render().tasks[0].id, 'latest-snapshot');
  store.switchUser({ permissions: ['page:proc-my-workspace'] });
  assert.deepEqual(store.render().tasks, []);
  assert.equal(store.requests.length, 3);
  store.requests[2].resolve([{ id: 'allowed-task' }]);
  await new Promise(setImmediate);
  const scope = store.api.captureProcurementScope();
  store.api.applyProcTaskUpdate({ id: 'allowed-task', status: 'completed' }, scope);
  assert.equal(store.render().tasks[0].status, 'completed');
});

test('采购个人工作台有负责人 ID 时不得用同名匹配其他账号', () => {
  const source = readFileSync(new URL('../src/app/procurement/ProcMyWorkspacePage.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('workspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'mine') initializer = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(initializer);
  const body = ts.transpileModule(`return ${initializer}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const mine = new Function('tasks', 'user', 'useMemo', body)([
    { id: 'A-task', buyerUserId: 'A', buyer: '李明' },
    { id: 'B-task', buyerUserId: 'B', buyer: '李明' },
    { id: 'legacy', buyer: '李明' },
  ], { id: 'B', name: '李明' }, (fn) => fn());
  assert.deepEqual(mine.map((task) => task.id), ['B-task', 'legacy']);
});

test("乱序采购请求只允许最后一次结果提交", async () => {
  const gate = createLatestRequestGate();
  const older = deferred();
  const latest = deferred();
  const committed = [];

  const run = async (pending) => {
    const token = gate.begin();
    const value = await pending;
    if (gate.isCurrent(token)) committed.push(value);
  };

  const olderRun = run(older.promise);
  const latestRun = run(latest.promise);
  latest.resolve("最新报价");
  await latestRun;
  older.resolve("旧报价");
  await olderRun;

  assert.deepEqual(committed, ["最新报价"]);
  const tokenBeforeUnmount = gate.begin();
  gate.invalidate();
  assert.equal(gate.isCurrent(tokenBeforeUnmount), false, "卸载后在途请求必须失效");
});

test("多币种最低价独立计算并排除过期报价", () => {
  const quotes = [
    { id: "cny-a", currency: "CNY", validUntil: "2026-12-31", tiers: [{ minQty: 0, unitPrice: 12 }, { minQty: 100, unitPrice: 9 }] },
    { id: "cny-expired", currency: "CNY", validUntil: "2026-01-01", tiers: [{ minQty: 0, unitPrice: 1 }] },
    { id: "usd-a", currency: "USD", validUntil: null, tiers: [{ minQty: 0, unitPrice: 2.5 }] },
    { id: "usd-b", currency: "USD", validUntil: "2026-12-31", tiers: [{ minQty: 500, unitPrice: 2.1 }] },
  ];

  const result = lowestActiveTierByCurrency(quotes, "2026-09-01");

  assert.deepEqual(result.map((item) => ({ currency: item.quote.currency, id: item.quote.id, price: item.price, minQty: item.minQty })), [
    { currency: "CNY", id: "cny-a", price: 9, minQty: 100 },
    { currency: "USD", id: "usd-b", price: 2.1, minQty: 500 },
  ]);
});

test("部分导入失败只保留失败报价及其对应图片", () => {
  const items = [
    { materialName: "电机", supplierName: "甲厂", payload: 1 },
    { materialName: "电机", supplierName: "乙厂", payload: 2 },
    { materialName: "减震垫", supplierName: "丙厂", payload: 3 },
  ];
  const images = ["甲图", "乙图", "丙图"];
  const retry = selectFailedQuoteImportEntries(items, images, [
    { materialName: "电机", supplierName: "乙厂" },
  ]);

  assert.deepEqual(retry.items, [items[1]]);
  assert.deepEqual(retry.attachments, ["乙图"]);

  const unknownFailure = selectFailedQuoteImportEntries(items, images, [
    { materialName: "服务端未知项", supplierName: "未知厂家" },
  ]);
  assert.deepEqual(unknownFailure.items, items, "无法定位失败项时应安全保留全部数据供重试");
});

test("同名采购成员按用户 ID 隔离，离册负责人和历史姓名任务仍可见", () => {
  const uniqueNames = uniqueRosterUserIdsByName([
    { id: "u-1", name: "李明" },
    { id: "u-2", name: "李明" },
    { id: "u-3", name: "王芳" },
  ]);
  const key = (userId) => `user:${userId}`;

  assert.equal(uniqueNames.get("李明"), null, "同名成员不得靠姓名猜测用户 ID");
  assert.deepEqual(resolveProcurementOwner({ buyerUserId: "u-1", buyer: "李明" }, uniqueNames, "unassigned", key), { key: "user:u-1", userId: "u-1" });
  assert.deepEqual(resolveProcurementOwner({ buyerUserId: "u-2", buyer: "李明" }, uniqueNames, "unassigned", key), { key: "user:u-2", userId: "u-2" });
  assert.deepEqual(resolveProcurementOwner({ buyerUserId: "former-9", buyer: "已离册人员" }, uniqueNames, "unassigned", key), { key: "user:former-9", userId: "former-9" });
  assert.deepEqual(resolveProcurementOwner({ buyer: "李明" }, uniqueNames, "unassigned", key), { key: "name:李明", userId: undefined });
  assert.deepEqual(resolveProcurementOwner({}, uniqueNames, "unassigned", key), { key: "unassigned", userId: undefined });
});
