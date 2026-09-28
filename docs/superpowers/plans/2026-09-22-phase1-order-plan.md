# 订单物料核对与旧库存入口收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 订单库存判断只基于明确物料身份和统一库存；废弃接口不能继续写旧账。

**Architecture:** 给订单明细增加核对证据，读取时叠加即时库存参考，不修改历史发票。订单模块仅依赖 B 的共享库存模块，不能导入整个采购模块造成循环依赖。

**Tech Stack:** NestJS、Prisma、React、node:test；复用现有权限、版本冲突及审计能力。

**Spec:** `docs/superpowers/specs/2026-09-22-business-closure-phase1-design.md` §4.3、§5–6。

## Global Constraints

继承总计划。不得以历史 SKU/名称模糊匹配自动确认物料，原始订单与历史发票保持不变。新权限不自动授予普通角色；库存参考不是库存预留或订单履约承诺。

## Review Focus

总计划第 4、5 项；另测商品来自两个不同客户但同 SKU、被删或变更编码的物料、旧接口任意 payload、发票生成不因新增 unknown 状态被无意禁止。

## 文件与接口

- 新建 `apps/api/src/modules/order-processing/order-material-mapping.ts`（纯匹配/来源指纹）和 `order-stock.service.ts`（明细核对、即时库存视图）。
- 修改 `apps/api/prisma/schema.prisma`；新增 `apps/api/prisma/migrations/202609220002_order_material_mapping/migration.sql`，仅准备。
- 修改 `apps/api/src/modules/order-processing/` 下的 `order-processing.module.ts`、`order-processing.service.ts`、`order-processing.controller.ts`、`order-processing.types.ts`。
- 修改 `src/app/lib/orderProcessingApi.ts`、`src/app/order-processing/pages/Workbench.tsx`、`src/app/order-processing/components/StatusBadge.tsx`、`src/app/lib/i18n.ts`；新增 `src/app/order-processing/components/OrderMaterialMappingDialog.tsx`。
- 修改权限目录 `apps/api/src/modules/permission-catalog/permission-catalog.defaults.ts`。
- 新增测试 `apps/api/test/order-material-mapping.spec.ts`、`order-stock.service.spec.ts`、`order-processing-retired-inventory.spec.ts`；回归 `order-processing-invoice-safety.spec.ts`。

```ts
export type MaterialIdentity = { id: string; code: string; unit: string; active: boolean };
export type SourceOrderLine = { id: string; orderId: string; sku: string;
  name: string; spec: string; unit: string; orderQty: number };
export type MappingEvidence = { fingerprint: string; code: string; unit: string;
  actorId: string; actorName: string; at: string; reason: string };
export type OrderStockCheck = { lineId: string; materialId: string | null;
  mappingState: 'exact' | 'confirmed' | 'unmatched' | 'stale';
  stockState: 'known' | 'unknown'; availableQty: number | null;
  sufficient: boolean | null; issues: string[]; checkedAt: string;
  scope: import('../inventory-stock/inventory-stock.model').StockScope };
// exactMaterial(line: SourceOrderLine, candidates: MaterialIdentity[]): MaterialIdentity | null
// mappingFingerprint(line: SourceOrderLine, material: MaterialIdentity): string
// OrderStockService.check(lines: SourceOrderLine[], scope: StockScope): Promise<OrderStockCheck[]>
// OrderStockService.confirm(orderId, lineId, { materialId, expectedUpdatedAt,
//   expectedSourceFingerprint, requestId, reason }, actor): Promise<OrderStockCheck>
```

check 内批量加载已保存的 materialId/mappingEvidence；签名不接受客户端提供的旧库存。无明确可出货仓库范围时返回 unknown，不能擅自把量产原料仓当成成品可交付仓。首版在订单查询/核对面板提供仓库多选，选项来自真实镜像；范围影响即时参考，不改客户订单原文、不建立库存占用。

## C1：明确物料身份与可失效的核对证据

- [ ] 先写失败纯函数测试：精确 ERP 编码且单位一致可命中；同名称/近似名称/不同客户 SKU 不自动确认；两候选同编码但冲突不得取第一个。

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { exactMaterial, mappingFingerprint } from '../src/modules/order-processing/order-material-mapping';
test('不同 SKU 同名称不能自动匹配；单位变更使证据失效', () => {
  const line = { id: 'l', orderId: 'o', sku: 'CUSTOMER-X', name: '阀体', spec: '', unit: '件', orderQty: 10 };
  const material = { id: 'm', code: 'ERP-V1', unit: '件', active: true };
  assert.equal(exactMaterial(line, [material]), null);
  assert.notEqual(mappingFingerprint(line, material), mappingFingerprint({ ...line, unit: '箱' }, material));
});
```

- [ ] 运行 `test/order-material-mapping.spec.ts` 确认失败。实现精确匹配仅做 trim，不通过大小写/连字符替换合并不同正式编码。fingerprint 使用固定字段顺序 JSON+SHA256，包含原订单/明细 ID、SKU、名称、规格、单位及物料 ID/编码/单位/有效性；数量变化不改变物料身份，但库存校验必须重新算数量。
- [ ] 为 `OrderProcessingOrderProduct` 增加 `materialId String?`（ProcMaterial FK，SetNull）、`mappingEvidence Json?`，补反向关系，写增量 SQL；不迁移历史 stockQty，不自动批量关联。`MaterialIdentity.active` 由物料存在且 `reviewStatus === 'approved'` 推导；pending/rejected 不证明可用，返回待核对原因，不引用不存在的数据库 active 字段。
- [ ] confirm 服务先验证 `page:order-workbench` AND `order-processing:material-map`。事务内读取订单/明细所属关系、updatedAt 与源指纹；读取目标物料实际编码/单位，校验一致后保存证据、请求签名、审计。request key 用 `order-processing:material-map:v1:request:`，同键不同人/内容冲突。
- [ ] 路由 `POST order-processing/orders/:orderId/lines/:lineId/material-mapping`；查候选 `GET order-processing/material-options` 返回最小字段且需页面权限，后端限制查询长度与页大小，不从无权限物料接口泄露全表。DTO 参数客户端操作人一律不采纳。
- [ ] 内存服务测试断言同 ID 跨订单禁止、过期来源拒绝、重复请求幂等、物料编码变更证据失效、服务层无权限无写。重导入替换明细时不复制旧 evidence；原核对审计保留。运行新增测试与 API 构建后检查 diff。

## C2：订单读取统一库存、处理 unknown 与提供核对入口

**Consumes:** B 的 `InventoryStockService.read` 和 C1 匹配函数；**Produces:** `OrderStockCheck` 作为订单明细新增字段，原 stockQty 为历史快照，不再驱动当前库存警告。

- [ ] 先写隔离服务测试：旧 stockQty=999，但共享 read 可用量=2、需求=3，结果必须 sufficient=false；缺映射/空范围/缺快照时 availableQty=null，不能为 0 或 true。查询函数用会对任何 create/update/delete 抛错的 Prisma 替身验证纯读。

```ts
// order-stock.service.spec.ts 中的写入哨兵；注入 getWorkbench/check 的 DB 替身。
const failWrite = async () => { throw new Error('READ_PATH_WROTE_DATABASE'); };
const writeTrap = { create: failWrite, createMany: failWrite, update: failWrite,
  updateMany: failWrite, upsert: failWrite, delete: failWrite, deleteMany: failWrite };
// 将各模型写方法全部绑定 writeTrap，再按测试明细返回只读 find 方法。
```

- [ ] 运行 `test/order-stock.service.spec.ts` 确认失败。实现 check：按已确认 materialId 或精确身份批量取 codes，传入用户明确仓库范围；同单位合计已知基础量，有缺失/冲突则 unknown，sufficient 仅在已知时比较需求。不使用历史订单、buildCatalog 的 stock 或已识别文件库存数字作为兜底。
- [ ] getWorkbench/订单详情/导出提供实时 stockCheck；新识别流程的目录使用正式物料身份，模糊匹配结果放候选不写确认为通过。价格检查与库存检查拆开，保持现有价格依据，不能拿新增 unknown 改写历史发票金额或生成状态。
- [ ] 去掉读取路径的 `ensureInitialized()` 副作用：空模板/设置读取采用只读默认值，首次确实需要写设置的动作才显式创建。历史演示数据清理从请求初始化中移除自动执行，不在本次运行清理程序。确认上传/识别路径也不会借用旧初始化自动清理历史。
- [ ] Workbench 明细增加“待核对/已明确映射”、库存范围及 checkedAt；原商品旁可打开 MappingDialog，候选显示名称、编码、规格、单位。冲突保留草稿；无权限只显示处理角色，不能点击无效按钮。明确“不构成库存预留”。零与未知视觉区分。
- [ ] 修改所有 stockCheck 消费类型，`availableQty` 为 null 时不得进入 `Number`、`?? 0` 兜底。当前库存导出显示待核对及原因；历史发票导出仍读原始快照，不为展示库存重新生成发票。
- [ ] 运行 `test/order-material-mapping.spec.ts test/order-stock.service.spec.ts test/order-processing-invoice-safety.spec.ts`、`scripts/order-processing-horizon-ui.test.mjs`、前端类型/API 构建。隔离浏览器验证明确映射→数量不足、空范围→选择仓库、无权限、变更来源后失效。O1–O3 通过。

## C3：旧库存写接口永久收口，旧读接口有权限且共用来源

**Files:** 修改 `order-processing.controller.ts/service.ts`、前端 `orderProcessingApi.ts`；新增 `apps/api/src/modules/order-processing/retired-inventory.ts` 作为唯一停用函数和 `apps/api/test/order-processing-retired-inventory.spec.ts`。

- [ ] 先写失败测试，返回状态必须 410；再扩展到真实 service 的三个旧写方法，使用 DB 全写/读哨兵断言根本不执行初始化或查询。controller 路由元数据与未登录/普通角色访问通过隔离应用测试验证。

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { retiredInventoryWrite } from '../src/modules/order-processing/retired-inventory';
test('旧写入口明确停用', () => {
  assert.throws(() => retiredInventoryWrite(), (error: any) => error.getStatus() === 410);
});
```

- [ ] 运行新增测试确认失败，再添加唯一函数，controller 旧入口与 service 旧方法直接调用，早于任何初始化/数据库访问。

```ts
import { GoneException } from '@nestjs/common';
export function retiredInventoryWrite(): never {
  throw new GoneException('该库存写入入口已停用，请到仓库工作台按原单办理');
}
```

- [ ] 对 `inventory/stock-in`、`inventory/:itemId/stock-out`、`inventory/:itemId/adjust` 保留兼容拒绝，不将旧参数转发新接口。全局 JWT 继续生效；已登录无论管理员还是普通人均不能再写旧账。
- [ ] 旧库存 GET/详情/export 改用共享库存并要求 `page:inventory-management`；用本地只读适配组装既有响应，不能依赖 ProcurementModule/TplusOperationsService 形成循环。库存详情原流水用已有仓库记录来源，不查询旧库存余额充当新来源。
- [ ] 全局搜索前端 `createStockIn/createStockOut/adjustInventory/recognizeStockIn`，移除无消费者 API 和遗留按钮；若旧 AI 入库识别无实际消费者则同样停用该路由，不挂文件上传解析后才拒绝。旧采购订单导入仍维持原语义，不能偷偷写 ERP。
- [ ] 运行新停用测试、订单核对测试与发票安全测试；静态确认 service 中原旧库存增减路径不可再达；隔离路由测试确认 401/410/403 分别符合认证、停用、只读权限语义。记录回退必须保留停用保护。

## 完成标准

订单库存参考读统一来源、核对有实际入口、旧写路径不可达；历史发票和旧流水仍可追溯。不得将订单识别成功等同采购入库或订单履约完成。执行总计划最终验收后交付。
