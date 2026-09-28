# 共享库存口径 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一来源与仓库范围使用一致的基础业务可用量；未知数据显式阻断确定性结论。

**Architecture:** 共享只读模块依赖 Prisma 和现有台账纯函数，不依赖采购/订单业务服务。正式计划在基础量上继续算计划分配、线边和在途，不创建第二套余额账。

**Tech Stack:** NestJS、Prisma.Decimal、node:test、现有 React 表格。

**Spec:** `docs/superpowers/specs/2026-09-22-business-closure-phase1-design.md` §4.1–4.2。

## Global Constraints

继承总计划；ERP 原始量不回写，本地收货/退料/盘盈不提前加库存。缺数据返回 unknown/null，不用 0 降级。只移动需要复用的逻辑，不重构整个采购模块。

## Review Focus

总计划第 3 项。加测小数精度、两个仓库相同物料不同单位、已发与已签重复事件、覆盖确认后但 ERP 同步尚未更新，以及查询不到余额但已有本地限制记录。

## 文件职责与固定接口

新增 `apps/api/src/modules/inventory-stock/inventory-stock.model.ts`、`inventory-stock.service.ts`、`inventory-stock.module.ts`。模块导出 InventoryStockService，注入现有全局 `apps/api/src/prisma/prisma.module.ts` 提供的 PrismaService，不重复注册数据库客户端。

```ts
export type StockScope = { kind: 'all' } | { kind: 'production' }
  | { kind: 'selected'; warehouses: string[] };
export type StockQuery = { codes: string[]; scope: StockScope };
export type StockRow = { code: string; warehouse: string; unit: string;
  bookQty: number | null; erpAvailable: number | null; available: number | null;
  pendingIssue: number; restriction: number; countReduction: number;
  qualifiedPending: number; defectivePending: number; inspectionPending: number;
  syncedAt: string | null; state: 'known' | 'unknown'; issues: string[] };
export type StockSnapshot = { readAt: string; sourceToken: string;
  scope: StockScope; rows: StockRow[]; missingCodes: string[] };
// calculateStockRow({ balance, records, issues }): StockRow
// balance: { tpInventoryCode: string; warehouse: string; unit: string;
//   stockQty: Prisma.Decimal; availableQty: Prisma.Decimal; syncedAt: Date | null }
// records: StockLedgerRecord[]; issues: StockIssueSource[] (现有模型导出类型)
// InventoryStockService.read(query: StockQuery, db?: Prisma.TransactionClient): Promise<StockSnapshot>
```

消费方使用 `missingCodes` 区分不存在与数量确实为 0，不能只对返回行求和后当作查询完整。空 codes 代表无目标，返回空快照；全量库存页先取得实际编码集合再批量读取，不通过分页截断编码。

## B1：共享计算与一致读取

**Files:** 新增上述三个文件；测试新增 `apps/api/test/inventory-stock.model.spec.ts` 和 `inventory-stock.service.spec.ts`。复用 `procurement/warehouse-stock-ledger.model.ts`、`warehouse-batches.model.ts`、`inventory-readiness.ts` 中已有仓库范围判定。

- [ ] 先添加失败模型测试。以下输入不依赖数据库，可直接运行。

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { calculateStockRow } from '../src/modules/inventory-stock/inventory-stock.model';
test('冻结只扣一次且未同步收货不加库存', () => {
  const row = calculateStockRow({ balance: { tpInventoryCode: 'V1', warehouse: '量产仓',
    unit: '件', stockQty: new Prisma.Decimal(100), availableQty: new Prisma.Decimal(80),
    syncedAt: new Date('2026-09-01') }, records: [
    { id: 'f', kind: 'freeze', status: 'confirmed', code: 'V1', warehouse: '量产仓', unit: '件', quantity: 5 },
    { id: 'r', kind: 'receipt', status: 'confirmed', code: 'V1', warehouse: '量产仓', unit: '件', quantity: 20, qualifiedQty: 20 },
  ], issues: [] });
  assert.equal(row.available, 75); assert.equal(row.qualifiedPending, 20);
});
test('缺同步依据不伪装成零库存', () => {
  const row = calculateStockRow({ balance: { tpInventoryCode: 'V1', warehouse: '量产仓',
    unit: '件', stockQty: new Prisma.Decimal(0), availableQty: new Prisma.Decimal(0),
    syncedAt: null }, records: [], issues: [] });
  assert.equal(row.state, 'unknown'); assert.equal(row.available, null);
});
```

- [ ] 运行 `test/inventory-stock.model.spec.ts` 确认失败；实现中只调用现有 `warehouseStockExposure` 与 `pendingWarehouseIssues` 一次，数量全程 Decimal。

```ts
const exposure = warehouseStockExposure(records, code, warehouse, unit, syncedAt);
const pending = pendingWarehouseIssues(issues, code, warehouse, unit, syncedAt);
const quantity = balance.availableQty.minus(exposure.frozenAndScrappedPending)
  .minus(exposure.countReduction).minus(pending.quantity);
// 将来源/单位/负数问题加入 problems；已确认零值仍为 known。
const available = problems.length ? null : quantity.toNumber();
```

- [ ] 固定异常规则：stock/available 非有限、负数、stock 小于 ERP available、扣后负数、缺单位、缺同步都 unknown。把每类原因和相关原单 ID 保留在 issues；现有问题不能被聚合吞掉。
- [ ] 实现 read：校验 codes 为非空合法编码数组、去重；selected 仓库不能为空。无外部 db 时 RepeatableRead 事务同时读取目标余额、仓库记录与发料；传入 db 则复用事务，不嵌套事务。production 使用原 isProductionWarehouse。返回范围内的 missingCodes、逐仓时间和来源指纹；不缓存、不回写。
- [ ] 服务测试用会在两次独立查询之间切换数据版本的替身，断言 read 的查询使用同一个事务上下文；测试 selected 范围、空范围、空编码、同编码不同单位、仅本地有事件但无余额时缺失仍保留。运行两份新增测试及 `warehouse-stock-ledger.spec.ts` 转绿。

## B2：统一消费者，移除重复扣减并展示未知

**Files:** 修改 `procurement/procurement.module.ts`、`tplus-operations.service.ts`、`procurement.service.ts`、`production-readiness.service.ts`、`inventory-readiness.ts`；前端 `src/app/lib/procurementApi.ts`、`orderProcessingApi.ts`、`src/app/order-processing/pages/Inventory.tsx`、`src/app/procurement/components/MaterialTable.tsx`、`MaterialDetailDrawer.tsx`、`InventoryReadinessPage.tsx`、`src/app/production/execution/ReadinessPanel.tsx`。新增 `apps/api/test/inventory-stock-consumers.spec.ts`。

**Interfaces:** 消费 B1 `read`；涉及库存数字的 API 保留字段名但允许 null，附加 `stockState/issues/scope/readAt`。没有从代码核实到的旧客户端不能静默收到伪造数值，前端类型必须同步。

- [ ] 先用同一组内存 ERP/仓库数据调用库存列表、物料查询、普通齐套和正式计划齐套：ERP available=80、待覆盖发料=10、冻结=5，前三者基础可用量必须=65；正式计划再有其他计划占用=20时该计划基础扣占用后=45。当前重复/遗漏限制时应测试失败。
- [ ] 订单消费者另在 C2 接入；本任务先将采购模块导入共享模块。`TplusOperationsService` 保留列表协议/流水来源，但基础量来自共享结果；移除原同类限制运算。物料批量读取而不是每行查库；safeStock 与 stock 的现有业务语义保持，不能擅自将所有预警阈值换成另一个数量。
- [ ] `getInventoryReadiness/stockPlanReadiness` 使用共享量产仓基础结果；普通版本依据遵循 A3。`ProductionReadinessService` 删除原 warehousePending 的二次减法，保留展示明细；其他计划占用、批次分配、线边确认、在途分配沿用原函数。

```ts
// stockRows 为同一编码、正确单位和仓库范围的 StockRow[]。
const unknown = stockRows.length === 0 || stockRows.some(row => row.available === null);
const base = unknown ? null : stockRows.reduce(
  (sum, row) => sum.plus(row.available!), new Prisma.Decimal(0));
// 后续 current/projected 仅在 base 非 null 时参与确定性计算；否则延续问题原因。
```

- [ ] 相关类型/序列化/导出改为明确 unknown。页面显示“— / 待核对＋原因”，不再 `value ?? 0`、`Number(null)` 或绿色正常兜底。实际为零显示 0。逐仓时间保留；范围标签显示全部仓库、量产仓或指定仓库，不能只显示聚合最新时间。
- [ ] 扩展消费者测试：小数 0.1/0.2 不累计误差；错单位不相加；ERP 核对与后续同步之间仍扣限制；覆盖后去掉本地扣减；发料+签收只扣一次；共享采购分配仍有效。
- [ ] 运行 `test/inventory-stock-consumers.spec.ts test/inventory-stock.model.spec.ts test/inventory-stock.service.spec.ts test/tplus-operations.service.spec.ts test/inventory-readiness.service.spec.ts test/readiness-purchase-allocation.spec.ts test/production-v11.spec.ts test/warehouse-stock-ledger.spec.ts`；类型/构建和总计划前端检查。浏览器检查零值、未知值、两仓不同时间、已有计划差异解释。

## 完成标准

I1–I5 通过。共享服务不改变任何 ERP 余额；正式齐套的计划占用仍只算一次。真实 ERP 的凭证/同步覆盖尚需指定环境联调，不以模型测试代替。
