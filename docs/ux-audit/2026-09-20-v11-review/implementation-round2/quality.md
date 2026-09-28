# 正式质量闭环与现场不良（F04 / F07）

2026-09-20，本轮在正式采购/生产入口实现。未写入数据库、未部署、未运行浏览器。

## 正式入口

- 供应链子系统详情 → 生产与质量 → 质量异常：原“采购与生产不良”表替换为统一四来源列表；登记入口支持采购、生产、仓库、售后。
- 生产计划详情 → 质量闭环（view=quality）：合并本授权范围的现场和质检异常，按 qualityId 去重。
- 作业详情 → 登记现场不良；作业的“原质量异常与现场证据”也可打开同一详情。
- 深链：?plan=<planId>&view=quality&quality=<qualityId>。只有传入授权记录中的 ID 才打开，越界明确空态；关闭仅删除 quality，保留计划、月份等参数。
- 未改变开发预览页，也未以预览替代正式能力。

## F04 数据与权限

- 原 ProcQualityRecord 是唯一不良数量主体。分析扩展存于 RuntimeState：procurement:quality-analysis:v1:<qualityId>；不创建第二份不良数量，不迁移或伪造历史原因。
- 主因有待分析/已授权确认；未知或未经确认的类别统一进入未知分组。分类包括工艺、包装、检验标准、版本、物料、其他。
- 现象明细单独记正整数发生次数：同一个 6 件不良可记录 6 次划痕 + 2 次偏位 = 8 次现象，不把 8 当不良件数。
- 责任认定独立于协同经办。内部责任人及供应商按实际 ID 校验，从服务端读取名称；其他主体须明确填写。确认需要现象、主因、原因说明、责任及依据，不能确认未知。
- 确认/修改使用既有 proc-quality:manage；协同权限不能冒充原因确认。读取复用正式质量权限，现场人员限原作业负责人或协同相关人。
- 分析与原异常双版本 CAS、Serializable 事务、请求幂等；任一 CAS 失败回滚分析、历史与请求。已关闭记录不能绕过重新打开直接改写。
- 一旦有受控来源或分析，原记录的来源/批次/检验与不良数量固定；原处置和独立复验规则继续保留。
- 四来源反馈以原异常上的来源、原单号、说明追加，不新建数量。来源文字引用不会被展示为已验证的外部系统链接。
- 列表包含来源/状态/主因/搜索、10 条分页、未知计数、高频现象 Top10。供应商比较严格按实际物料 ID、供应商 ID 和单位区分，仅统计当前已登记检验记录；未标物料/供应商不猜测归属，不冒充全量交付合格率。
- 新证据复用 uploadResourceFile 的 assets 真实上传；服务端验证 FileAsset active、实际上传人/类型。读取经原质量异常权限重新签 URL，不能猜他人 fileId 或依赖上传者个人链接。
- 主因分析仍是独立维度，历史异常不会因没有新增分析字段突然无法使用原复验流程。没有将原因“已确认”伪装成“已经验证关闭”。

## F07 原报工到 QC

- 从已派工作业的真实报工登记现场不良。只允许本作业负责人或具相应报工权限的计划员，仍需现有动作权限。
- 同次报工只建立一个现场不良主体，件数必须等于该次报工的实际产量减良品。多现象在该主体补次数；没有自动推断另一批实物。
- 现场记录保存原 reportId、qualityId、登记人/时间、现象、证据、真实附件、实领物料批号；计划 CAS 与异常/附件关联同事务，失败不遗留孤儿质量记录。
- QC 检验显式选择原 qualityId。服务端验证同一报工、未关联过检验、检验数和原不良件数一致。已有现场异常时禁止无关联地新建另一份不良；检验沿原 ID 衔接。
- 尚未 QC 衔接的现场记录不能直接跳到独立复验关闭。衔接后原处置、协同回复、剩余数量复验规则不变。
- 实领批号只来自同作业 WarehouseIssue.lines[].signedBatches。生产 batchId 不能冒充来料批号；缺码保存 null 并标记待补。
- 质量分析可对已有现场物料行补齐实际批号，仍校验当前已签收记录并保留分析历史。原现场快照保留，最新补录优先展示。
- 数量核对不一致时拒绝 QC 自动覆盖；需要先核对真实报工/原异常，不通过重复登记来掩盖差异。当前未新增跨原报工分拆/合并实物功能。

## 协调补充

- F09：原 assign-quality 增加 dueDate / requiredInfo / verificationPlan，新转派必须明确期限、待补资料与验证安排；历史缺项显示待确认。经办在原详情回复原异常，继续回原发起人，未创建新的独立任务。
- execution.list 允许 ECN 当前反馈经办/提报人读取相关批次上下文，仅相关批次，scope 仍为 assigned，未扩展写权限。未解决的相关反馈保留跨月可达性。
- F17：已按 root 的组件接入草稿情景试算入口与返回正式计划，canReadReadiness 门禁，不修改情景组件本身。
- 无新 provider。OperationsService 使用现有全局 OssService（可选注入），quality-analysis.ts 为普通共享函数。

## 验证结果

- 后端 71/71：procurement-operations.service.spec.ts 29 项；production-execution.service.spec.ts 28 项；warehouse-flow.service.spec.ts 14 项。
- 前端 38/38：quality-records-workflow、production-execution-page、production-workspace-navigation、production-schedule、quality-production-horizon-ui。
- 前后端 TypeScript 检查均通过。
- 覆盖 6 件/8 次、四来源、未知确认门禁、责任账号、附件伪造/越权、双 CAS 回滚、请求幂等、现场-QC同号、缺码待补、错误批号/跨作业拒绝、提前复验拒绝、质量深链范围、真实表单文件 ID、失败草稿/重试、协同期限及 ECN 有界上下文。

命令：
- apps/api：TS_NODE_TRANSPILE_ONLY=1 node --test --test-concurrency=2 -r ts-node/register -r tsconfig-paths/register test/procurement-operations.service.spec.ts test/production-execution.service.spec.ts test/warehouse-flow.service.spec.ts
- 根目录：node --test scripts/quality-records-workflow.test.mjs scripts/production-execution-page.test.mjs scripts/production-workspace-navigation.test.mjs scripts/production-schedule.test.mjs scripts/quality-production-horizon-ui.test.mjs
- 根目录：node node_modules/typescript/bin/tsc --noEmit
- apps/api：node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json

浏览器验收由主代理统一进行。未执行最终 build。

