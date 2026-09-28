# 生产 F05 / F06 第二轮实现

日期：2026-09-20。范围是检验分类与统计、已开工作业调整、生产日程；没有写数据库、部署或新建线上数据。

## F05：检验类型、SIP 与首次终检

- 新检验必须明确选择过程检或终检，并填写工序；旧无类型记录读取为“历史未分类初检”，不替旧数据补造终检身份。
- 同一次报工的同工序过程检分别限制累计数量。终检与历史未分类记录共用原报工数量上限，防止重新登记终检重复计算。复验继续在原质量异常办理，首次合格数量与分母保持原值。
- 整机完成量仅计算终检及历史未分类记录的首次合格与复验认可合格；过程检即使全部合格也不算整机完成。明确拆出 legacyCompletedQty / finalCompletedQty。
- 首次终检统计只含明确标记的整机终检，按首次合格数 / 首次检验数计算。组件单位不与整机相加，过程检、历史记录、复验均不进入这个分母。
- SIP 优先从服务端派工快照冻结，包含真实受控文档版本引用；客户端不能替换该引用。旧作业没有 SIP 快照时须填写实际文字依据，显示人工来源，不能伪装受控版本。
- 生产检验 Tab 提供日期、类型、搜索及分页；显示当日整机首次终检合格率，并可进入独立记录详情。详情保留 SIP 来源、真实固定版本预览、原异常和复验入口。日统计不随文本或类型过滤改变口径，只随日期和授权计划范围变化。
- 共用服务 helper：completionInspections(task) 返回 final + legacy，executionInspectionKind(row) 将未标类型归为 legacy。readiness/lifecycle 消费方已通知使用该 helper。

## F06：调整与日程

- 计划员可在原作业详情调整日期、产线、负责人和数量；取消作业不可调整。保留原编号、名称、批次、BOM 每件用量、派工依据、全部报工和检验。
- 数量不能小于累计已报工，同批有效整机作业合计不能超批次目标；整机数量为整数。新领料需求按原每件用量计算，不能小于原累计已发或已签收数量。
- 当前日期边界为计划月初至批次交期；跨月延期需后续独立的批次交期调整能力，本轮没有静默更改批次承诺。
- 原领料需求同步更新需料日、接收人、目标数量。已发、已签收、来源、核对与领退料历史保留。计划与领料均 CAS，位于同一 Serializable 事务；冲突全部回滚，重复请求不重复生效。
- 负责人或日期变化时重新校验适用 ECN 确认及未处理反馈，仅作门禁，不覆盖已经执行使用的派工依据快照。
- 留痕保存操作者、原因、前后日期/线/负责人/数量、累计报工、领料前后版本和数量影响；详情渐进展开显示。
- 日程是系统 Table 的日期列 / 产线行矩阵，支持 3 天、10 天、自定义最多 31 天；按负责人 ID、产线、批次过滤，8 条产线分页。窄屏横向滚动，无拖拽隐式写入；点击作业进入详情再显式调整。
- 领退料边界采用累计已发/已签收的保守约束，不因历史退料直接回写或清零原数量。本轮不自动重分配库存占用。

## 验收入口和返回

沿现有 production-execution 路由：
- ?month=2026-09&plan=<id>&view=schedule
- ?month=2026-09&plan=<id>&view=inspections&qualityDate=2026-09-20
- 日程参数：scheduleStart / scheduleSpan / scheduleEnd / scheduleLine / scheduleOwner / scheduleBatch / schedulePage。
- 检验参数：qualityDate（all 表示全部日期）/ qualityKind / qualityQ / qualityPage。
- 作业详情保存 taskFrom=schedule 或 inspections；顶部返回恢复来源 Tab，保留各自过滤分页。检验详情内部返回当前作业检验列表也保留原条件。

## 验证

1. 前端行为：27 / 27 通过。
   node --test scripts/production-workspace-navigation.test.mjs scripts/production-execution-page.test.mjs scripts/production-schedule.test.mjs
2. 后端执行与仓库回归：35 / 35 通过，其中执行服务 23 项、仓库 12 项。
   在 apps/api：TS_NODE_TRANSPILE_ONLY=1 node --test --test-concurrency=2 -r ts-node/register -r tsconfig-paths/register test/production-execution.service.spec.ts test/warehouse-flow.service.spec.ts
3. 前后端 TypeScript 无输出通过。
   根目录 node node_modules/typescript/bin/tsc --noEmit
   apps/api 目录 node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json

覆盖新增过程/终检独立容量、历史兼容、47/50 首次 94% 经复验仍保持、SIP 不能客户端覆盖、原号调整/幂等/权限/数量边界、领料 CAS 回滚、新负责人 ECN 确认、真实表单提交、日程筛选日期边界与深链。

浏览器视觉由主代理统一验收。本子任务没有运行浏览器或最终 build。

