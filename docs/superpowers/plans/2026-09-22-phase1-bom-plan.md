# 设备与 BOM 执行依据 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每个正式计划只能使用本设备已发布 BOM，历史计划可核对且原记录不被覆盖。

**Architecture:** 保留 `ProcBomNode` 工作稿，在设备根记录产品归属；新增 `ProcBomRevision` 保存不可变快照。集中在独立的 BOM 发布服务完成绑定/发布/停用，生产与备货使用同一验证入口。

**Tech Stack:** NestJS、Prisma、PostgreSQL、React、node:test。

**Spec:** `docs/superpowers/specs/2026-09-22-business-closure-phase1-design.md` §3、§6。

## Global Constraints

继承总计划全部约束。不得给历史树自动补产品归属或发布版本；不得因历史待核对阻止原实物退料/检验。新增权限只注册目录，不默认授予普通角色。

## Review Focus

采用总计划第 1、2 项；另在 A1 覆盖同编码不同单位、跨设备父节点和草稿循环，在 A3 覆盖换版本绕过月计划唯一性。

## 文件职责

- 数据：修改 `apps/api/prisma/schema.prisma`；新增 `apps/api/prisma/migrations/202609220001_bom_revisions/migration.sql`（仅准备，不执行）。
- 新建 `apps/api/src/modules/procurement/bom-revisions.model.ts`、`bom-revisions.service.ts`、`bom-revisions.controller.ts`；分别负责快照纯校验、事务和路由。
- 修改现有 `procurement.service.ts`、`procurement.controller.ts`、`procurement.module.ts`、`dto/procurement.dto.ts`、`production-execution.service.ts`、`production-execution.model.ts`、`production-execution.controller.ts`；不拆无关逻辑。
- UI：修改 `src/app/procurement/BomListPage.tsx`、`src/app/lib/procurementApi.ts`、`src/app/lib/productionExecutionApi.ts`、`src/app/production/execution/ProductionExecutionPage.tsx`、`src/app/procurement/components/StockPlanPanel.tsx`，新增 `src/app/procurement/components/BomRevisionControls.tsx`。
- 权限：`apps/api/src/modules/permission-catalog/permission-catalog.defaults.ts`；文案：`src/app/lib/i18n.ts`。
- 测试：新增 `apps/api/test/bom-revisions.model.spec.ts`、`bom-revisions.service.spec.ts`、`production-bom-basis.spec.ts`；扩展现有 `production-execution.service.spec.ts` 与 `scripts/bom-page.test.mjs`。

## A1：工作稿快照校验与版本存储

**Interfaces:** 新 model 定义并导出如下契约，后续任务不得另起同义类型。

```ts
export type BomLeaf = { nodeId: string; parentId: string | null; deviceId: string;
  materialId: string; code: string; name: string; unit: string; qtyPer: number };
export type BomSnapshot = { deviceId: string; productRootId: string;
  structure: { id: string; parentId: string | null; name: string }[];
  leaves: BomLeaf[];
  items: { id: string; code: string; name: string; unit: string; qtyPer: number }[];
  fingerprint: string };
// buildBomSnapshot(input: Omit<BomSnapshot, 'items' | 'fingerprint'>): BomSnapshot
// assertBomSelection(productRootId: string, deviceId: string,
//   revision: { productRootId: string; deviceId: string; retiredAt: Date | null }): void
```

- [ ] 先写失败测试，完整最小测试如下；再补同编码同单位汇总、不同单位拒绝、空结构/缺编码/空单位/非正用量/循环/跨设备节点案例。

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { assertBomSelection } from '../src/modules/procurement/bom-revisions.model';
test('禁止产品 A 使用设备 B 的发布版本', () => {
  assert.throws(() => assertBomSelection('root-A', 'device-B', {
    productRootId: 'root-B', deviceId: 'device-B', retiredAt: null,
  }), /不属于/);
});
test('停用版本不得创建新计划', () => {
  assert.throws(() => assertBomSelection('root-A', 'device-A', {
    productRootId: 'root-A', deviceId: 'device-A', retiredAt: new Date(),
  }), /停用/);
});
```

- [ ] 用总计划测试命令仅运行 `test/bom-revisions.model.spec.ts`，确认因缺失函数/校验而失败。
- [ ] 实现校验：父链必须到当前设备根，无孤儿/环；物料身份来自数据库而非客户端。用 `Prisma.Decimal` 按编码和单位汇总；稳定排序后 `createHash('sha256')` 生成指纹，指纹包含结构、物料身份、单位、用量。用量限制沿用 BOM 编辑已有四位小数规则，生产执行的三位数约束不能通过静默舍入绕过，发布时额外校验执行兼容性并说明原因。

```ts
export function assertBomSelection(productRootId: string, deviceId: string,
  revision: { productRootId: string; deviceId: string; retiredAt: Date | null }) {
  if (revision.productRootId !== productRootId || revision.deviceId !== deviceId)
    throw new BadRequestException('发布版本不属于当前产品和设备');
  if (revision.retiredAt) throw new BadRequestException('版本已停用');
}
```

- [ ] 添加存储：`ProcBomNode.productRootId String?`、到 `ProcTaskTreeNode` 的命名关系 `BomDeviceProduct`（Restrict）；后者加反向数组。新 `ProcBomRevision` 包含 `id`、`deviceId`、`productRootId`（两者 FK Restrict）、`version Int`、`snapshot Json`、`fingerprint String`、`requestId String @unique`、`requestHash String`、`publishedById/name`、`publishedAt`、`reason`、`retiredAt/ById/ByName/Reason` 可空；`@@unique([deviceId, version])`。两端补反向关系。
- [ ] 手工编写对应增量 SQL（ALTER 加可空字段、CREATE TABLE、FK Restrict、唯一索引），不得 reset/db push/backfill；生成 Prisma 客户端后运行模型测试与 API 构建。隔离数据库验证 FK 和设备内版本唯一性，缺测试环境时明确记为未验证。

## A2：绑定、发布、停用与完整办理入口

**Interfaces:** `BomRevisionsService` 注入 Prisma，公开 `read(deviceId, actor)`、`bind(deviceId, { productRootId, expectedFingerprint, requestId, reason }, actor)`、`publish(deviceId, { expectedFingerprint, requestId, reason }, actor)`、`retire(revisionId, { requestId, reason }, actor)`；`requireRevision(db, { productRootId, deviceId, revisionId })` 返回服务器校验后的发布行及 `BomSnapshot`。

- [ ] 新建服务测试，用内存 Prisma 替身断言：只有动作权限没有页面权限仍拒绝；非根产品拒绝；发布后重新绑定拒绝；旧指纹拒绝；重复 requestId 同 actor/内容只产生一个版本，不同内容冲突；发布与草稿写冲突无半个版本。

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { BomRevisionsService } from '../src/modules/procurement/bom-revisions.service';
test('仅有动作权限不能发布且不访问数据库', async () => {
  const db = new Proxy({}, { get() { throw Error('unexpected database access'); } });
  const service = new BomRevisionsService(db as never);
  await assert.rejects(service.publish('device-A', {
    expectedFingerprint: 'stale', requestId: 'bom-publish-test-0001', reason: '核对发布',
  }, { id: 'u', name: '核对人', permissions: ['bom:publish'] }), /权限/);
});
```

- [ ] 运行 `test/bom-revisions.service.spec.ts` 确認失败，然后实现串行化事务。重试签名包括 actor、动作、设备、请求内容；绑定/停用幂等记录复用 RuntimeState，前缀 `procurement:bom-revisions:v1:request:`。发布锁设备根、事务内重读工作稿/物料/归属并比较指纹，写版本与 auditLog。既有树编辑和导入也使用同一设备根锁或共享 BOM 写锁，不能只锁发布路径。
- [ ] 路由新建在 `procurement/bom-devices`：`GET :id/revisions`、`POST :id/bind`、`POST :id/publish`、`POST revisions/:revisionId/retire`。DTO 限长、UUID/请求 ID 格式沿用现有约定；controller 从登录请求构造 actor。RolesGuard 是 OR，服务层必须额外验证页面 AND 动作。
- [ ] 删除设备/产品根、全量 BOM 导入时先查引用；引用存在则拒绝删除根身份。工作稿叶子仍可编辑删除，但不影响快照。设备停用以其有效版本全部停用表现，新建正确设备使用新的稳定 ID。
- [ ] BOM 页复用已有编辑布局，顶部显示归属、草稿变更、发布版本、停用状态。`BomRevisionControls` 提供产品根选择、核对依据、发布/停用确认、版本只读查看；请求冲突保留输入并要求刷新，不静默重发。新增 `bom:publish` 权限，不对普通角色补授权。
- [ ] 运行模型/服务测试、`scripts/bom-page.test.mjs`、类型检查；在隔离数据中验证完整“未绑定→绑定→发布→编辑新草稿→旧版本不变→停用”及普通角色只读。任务结束前检查实际 diff，不提交。

## A3：计划引用、历史核对和备货入口约束

**Interfaces:** 扩展 `ExecutionPlan`：`deviceId?: string; bomRevisionId?: string; legacyBasisReview?: { deviceId: string; productRootId: string; sourceFingerprint: string; actorId: string; actorName: string; at: string; reason: string }`。新建计划 DTO 必须有 `deviceId/bomRevisionId`；服务端从 productId 找正式根并调用 A2 `requireRevision`。旧 `productLine` 仅展示，不信任客户端传值。

- [ ] 扩展现有生产服务 fixture，用两个产品/设备版本建立失败测试：跨产品、草稿、停用、版本伪造全部拒绝；相同设备同月换版本仍重复；旧计划核对后不产生第二份计划；新建保存服务器快照而非客户端 BOM。
- [ ] 新建 `production-bom-basis.spec.ts` 验证纯函数 `legacyBasisAllows(plan, action, data): boolean`（定义在 `production-execution.model.ts`）：无有效核对时拒绝 `task/dispatch`、增加 targetQty 或增加作业 quantity；原已派发 `report/inspect` 及数量减少允许，其他已有业务权限和数量校验不因此跳过。

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { legacyBasisAllows } from '../src/modules/procurement/production-execution.model';
test('待核对历史计划能安全收尾，不能新增派工', () => {
  const plan = { targetQty: 10, bom: [], tasks: [], productId: 'A' } as never;
  assert.equal(legacyBasisAllows(plan, 'task', {}), false);
  assert.equal(legacyBasisAllows(plan, 'report', {}), true);
  assert.equal(legacyBasisAllows(plan, 'targets', { targetQty: 11 }), false);
});
```

- [ ] 运行新增测试确认失败。计划创建事务内对版本和设备归属加共享锁再验证、保存引用；停用和归属写操作使用对应排他锁，防止校验通过后停用竞态。按月+设备锁并检查所有已映射老计划，保留原计划 ID。存在可能冲突但未核对的旧型号计划时返回需先核对，不放行创建重复计划。
- [ ] 增加 command `review-basis`：需 `production:plan` AND `bom:publish` AND 页面权限，提交设备、原快照指纹、理由；版本 CAS 内保存 review 和原历史事件，不修改 bom。`legacyBasisAllows` 每次重算原快照及产品/设备身份指纹，不能用只看 review 存在的布尔值。
- [ ] 计划 options 返回按产品归属组织的设备/版本；表单选择上游后清空失效下游选择。计划详情增加待核对区、原快照查看和核对动作。已停用版本历史仅提示，不自动覆盖。
- [ ] `ProcStockPlan` 新增可空 `bomRevisionId`（FK Restrict）和 `bomBasis Json?`（增量 SQL 并入 A1 migration）；新整机备货选择已发布版本，`stockPlanReadiness/generateStockPlanTasks` 读取冻结版本而不是当前树。Create/UpdateProcStockPlanDto 增加对应版本参数，客户端不能直接提交 bomBasis 内容。
- [ ] 历史备货没有完整原 BOM 快照，不能套用生产旧计划的“核对原快照”文案。新增 `POST procurement/stock-plans/:id/confirm-bom-basis`，服务 `confirmStockPlanBomBasis(id, { revisionId, expectedUpdatedAt, requestId, reason }, actor)`：现有备货写权限加 `bom:publish`、计划锁、所属产品校验后，保存当前选定版本及 `bomBasis={origin:'confirmed-current', revisionId, fingerprint, actorId, actorName, at, reason}` 并审计，明确是从此次确认起采用，不伪造历史。StockPlanPanel 显示新依据与历史已生成任务分区；已存在采购任务仍沿用现有“不重复生成”规则并保留履约，差量追加属于第二阶段。未确认的旧备货禁止首次生成采购任务。
- [ ] 普通齐套显示工作稿/发布版本依据；`getInventoryReadiness` 新增可选 revisionId，有版本时读取快照，无版本时明确草稿。`production.bom` 预览不能再成为绕过 create 校验的执行路径。修正所有生成正式需求的调用方，不能只改生产页面。
- [ ] 运行 `test/bom-revisions.model.spec.ts test/bom-revisions.service.spec.ts test/production-bom-basis.spec.ts test/production-execution.service.spec.ts test/production-v11.spec.ts` 及对应前端脚本、类型/构建。通过 B1–B6；没有隔离数据库时不伪称并发/FK 通过。

## 自检与边界

本计划完成后具备归属核对→发布→正式引用→历史核对的实际入口。不得停在“后端拒绝所有旧型号”却没有 UI 解决路径。存量工单物料版本切换仍属于第二阶段，不自动办理。
