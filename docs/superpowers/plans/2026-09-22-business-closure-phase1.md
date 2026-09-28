# 第一阶段业务闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 保留用户默认单代理方式，不擅自委派；不提交、不部署、不写真实业务数据。

**Goal:** 阻止设备/BOM 错配、统一库存依据，并关闭旧库存写路径，同时给历史问题提供可办理的核对入口。

**Architecture:** 保留业务模块与现有页面。BOM 工作稿加不可变发布版本；共享库存模块只读 ERP 与现有业务记录；订单消费共享库存，不反向依赖采购服务。每个子计划独立测试，整体完成才宣称第一阶段交付。

**Tech Stack:** React、TypeScript、NestJS、Prisma/PostgreSQL；沿用 node:test、ts-node、现有组件及权限系统，不增加第三方依赖。

**Spec:** `docs/superpowers/specs/2026-09-22-business-closure-phase1-design.md`

## Global Constraints

- “不在本阶段：采购完成口径调整、自动补采、已有计划的工程变更执行、订单交付数量回写、客户退货、多工序半成品、自动排产、财务模块。”
- “不创建额外库存余额表。”
- “不把工作稿当正式版本，不覆盖已执行计划，不因治理阻塞必要退料/质检。”
- “旧库存表与历史流水保留只读，不合并其余额进 ERP。”
- “本设计不授权提交、创建 PR、部署、执行生产迁移或修改真实库存。”
- 当前工作树有既有改动；只按实际文件差异编辑，不恢复、覆盖或清理无关文件。不使用新 worktree 丢弃本任务依赖的未提交代码。
- Node 版本遵循项目 `>=22.19.0`；使用 Windows PowerShell。命令中的环境变量必须使用 PowerShell 语法。

## Review Focus

1. BOM 发布与编辑/停用并发：只允许完整一致快照，重试不得重复版本。归属 A2、A3。
2. 未映射旧计划已经有实物流转：阻止扩大执行但允许签收、质检及退料收尾。归属 A3。
3. 分仓不同同步时间、空单位、负数和小数：不得用聚合最新时间或 0 掩盖未知。归属 B1、B2。
4. 订单识别重导入更换明细 ID：不得把旧人工映射误用到新商品；历史发票不变。归属 C1、C2。
5. 旧接口进入服务前自动初始化：410 路径不得先调用初始化/清理逻辑，回退不能重开漏洞。归属 C3。

## 子计划、依赖与执行方式

| 顺序 | 子计划 | 可独立验收的结果 |
|---|---|---|
| A | [设备与 BOM 执行依据](2026-09-22-phase1-bom-plan.md) | 发布、引用、旧计划核对和必要界面形成完整办理链 |
| B | [共享库存口径](2026-09-22-phase1-stock-plan.md) | 基础数量一致且正式齐套不重复扣减 |
| C | [订单核对与旧入口收口](2026-09-22-phase1-order-plan.md) | 订单读取真实库存，旧账不再写入 |

A、B 不依赖彼此的新服务，可分别审查；C 消费 B 的接口。实施按 A → B → C 顺序，单代理执行，不同时改相同业务文件。子计划不单独改变本阶段范围。

按先失败测试、最小实现、测试转绿、检查实际差异的循环实施；实现后补充的测试在验收记录中单独说明。未获授权不执行技能模板中的 commit 步骤。下列未选复选框表示整项尚未完成验收，不代表其中的功能均未实施；实际完成情况以末尾状态及验收记录为准。

## 开工与命令

- [ ] 记录目标文件当前差异，读取对应子计划及所需实现/测试技能，不复用上一轮“41 通过”作为新版本通过。
- [ ] 验证 Node、依赖和数据库测试环境；不得读取或打印连接密钥。

在 `apps/api` 目录运行指定隔离测试：

```powershell
$env:TS_NODE_TRANSPILE_ONLY='1'
node --test --test-concurrency=1 -r ts-node/register -r tsconfig-paths/register test/production-execution.service.spec.ts test/production-v11.spec.ts test/warehouse-stock-ledger.spec.ts
```

新增子计划测试按相同命令替换文件清单。先查看所执行测试的钩子/数据库连接；带 `.postgres.spec.ts` 的测试不可混入默认隔离命令。准备迁移 SQL 不等于授权执行迁移。

## 最终验收

- [ ] A/B/C 的全部任务完成，spec 的 B1–B6、I1–I5、O1–O3、P1–P3 均有对应结果，不存在只加拦截没有核对入口的状态。
- [ ] 根目录运行下列命令；测试失败须区分既有失败与本次回归，保留证据而非扩大修改范围。

```powershell
npm run typecheck
npm run build:api
npm run build
node --test scripts/bom-model.test.mjs scripts/bom-page.test.mjs scripts/inventory-readiness-page.test.mjs scripts/inventory-readiness-export.test.mjs scripts/production-readiness-allocation-ui.test.mjs scripts/order-processing-horizon-ui.test.mjs
```

- [ ] 使用浏览器检查 1440×900 与 390×844：BOM 未绑定/工作稿/已发布/停用、创建计划、历史核对、订单待核对/已核对、库存未知/冲突、普通角色无权限。仅在隔离测试数据中办理写动作；当前真实环境仅只读查看。
- [ ] 在明确隔离数据库中验证外键、唯一约束、并发事务、重复请求与无权限路由。若没有隔离数据库，报告验证受阻，不使用线上库代替。
- [ ] 交付实际修改清单、通过/失败/未运行检查、迁移及真实 ERP 联调待办。不自动提交、部署或授权角色。

## 回退与上线门槛

应用回退保留新增记录和历史审计；不自动执行 down migration。旧写接口的停用保护必须保留。新版本计划已被创建后，不允许不认识该版本的旧代码继续新建/扩大业务。

部署须先核实真实备份、迁移目标、权限配置和人工归属核对安排。缺少这些条件只交付本地代码与迁移文件，不声称上线完成。

## 计划自检映射

| Spec 部分 | 负责子任务 |
|---|---|
| §3 身份、发布、引用、旧计划 | A1–A3 |
| §4.1–4.2 基础库存及范围差异 | B1–B2 |
| §4.3 订单映射和即时校验 | C1–C2 |
| §5 旧入口与权限 | C3 |
| §6 所有核对入口 | A2–A3、B2、C2 |
| §7–8 验收、迁移、回退 | 各任务末尾及本计划最终验收 |

状态（2026-09-23）：A/B/C 功能实现及本地回归收尾完成，根目录全量 2473 通过 / 0 失败 / 0 跳过；旧 BOM 编辑器测试已迁移至现行独立页面，数量变化与证据见 [本地实施与验收记录](../2026-09-22-phase1-progress.md)。用户确认暂无专用测试库，先完成本地代码与测试。隔离数据库、真实 ERP 及完整成功 E2E 未完成，Prisma generate 仍有 Windows 引擎文件 EPERM，因此外部最终验收仍保留未勾选；不将本地代码完成视为上线闭环。
