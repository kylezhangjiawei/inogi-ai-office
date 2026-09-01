import assert from "node:assert/strict";
import test from "node:test";

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
