# V1.1 总览与研发 G00 / R00 / R01 只读核对

审查日期：2026-09-20。本次逐张查看 G00、R00、R01 高保真 PNG，核对 `page_map.json`、开发说明对应章节，以及正式前端与 API 源码。仅新增本报告；未改产品代码，未访问真实数据库，未进行业务写入或浏览器操作。浏览器实测由主审查代理单独记录。

原型目录：`C:/Users/Administrator/Documents/xwechat_files/zjw19920831_8887/msg/file/2026-09/INOGI_AI驾驶舱_V1.1全套开发资料_33页高保真/INOGI_AI驾驶舱_V1.1开发资料`。下文“说明 L…”均指其中 `INOGI_AI驾驶舱_V1.1开发说明.md`；三张图片在 `高保真页面/总览与研发/`。

采用当前 Horizon 视觉为基线，不把原型蓝色、演示数字、称谓差异视为缺陷。允许功能合并进 Tab、抽屉或弹窗；不要求每张图对应独立菜单。空技术资料、尚未转采购、没有样品记录，只能说明该记录尚无数据，不能证明功能不存在。

## 逐页映射

| 原型 / 图片观察 | 正式入口与实现 | 确认偏差 | 尚需现场验证 |
| --- | --- | --- | --- |
| **G00 公司管理总览**：全局月份/出货目标，研发—采购—生产—检验链路，部门风险、经办人/期限、原问题入口 | `/` → `Dashboard`，注册于 [App.tsx:513](E:/workCoding/inogi-ai-office/src/app/App.tsx:513)。真实首页是研发、问题、费用、订单的个人聚合；有待办、动态、权限裁剪、各源失败反馈、原模块入口。模块构建 [Dashboard.tsx:247](E:/workCoding/inogi-ai-office/src/app/Dashboard.tsx:247)，页面明确说明四类数据范围 [Dashboard.tsx:508](E:/workCoding/inogi-ai-office/src/app/Dashboard.tsx:508)。 | 说明 L151“交付风险汇总到同一入口”、L153“整机完工、出货与质量指标分列”尚未由此页承接。数据源只有 `health/rd/issues/expenses/orders`，未包含月度交付目标、齐套、生产、质量原异常聚合；不是隐藏卡片或空数据。见 OR01。 | 管理账号与普通账号范围；单源失败是否保留其余数据；公司级交付总览是否另有产品决策指定的新入口。 |
| **R00 研发任务首页**：人员筛选、任务卡片、图纸缩略图，当前版本和相关采购/样品/生产提示 | `/rd-task-management` → `RDTaskManagementPage`，注册于 [App.tsx:522](E:/workCoding/inogi-ai-office/src/app/App.tsx:522)。真实任务数据/人员筛选、名称/状态、主责/期限、摘要、附件集合、进度、风险均存在。当前主卡片是 `renderTaskCard` [RDTaskManagementPage.tsx:7742](E:/workCoding/inogi-ai-office/src/app/RDTaskManagementPage.tsx:7742)，不是文件早期的另一 `TaskCard`。卡片主责/期限 [L7988](E:/workCoding/inogi-ai-office/src/app/RDTaskManagementPage.tsx:7988)，附件缩略条 [L8039](E:/workCoding/inogi-ai-office/src/app/RDTaskManagementPage.tsx:8039)，进度/工作项依据 [L8062](E:/workCoding/inogi-ai-office/src/app/RDTaskManagementPage.tsx:8062)、[L8109](E:/workCoding/inogi-ai-office/src/app/RDTaskManagementPage.tsx:8109)。 | 说明 L169 的 S02/S18 关联入口及 PNG 的当前确认版本/采购样品记录快捷信息未出现在主卡片。进入详情后可以转采购与看样品，故属列表发现性和信息缺口，不是采购流程未实现。“更多”已有按权限同步到生产/撤销同步 [L7958](E:/workCoding/inogi-ai-office/src/app/RDTaskManagementPage.tsx:7958)，不能说完全没有生产操作。见 OR03/OR04。 | 普通研发人员/主管切换范围；跨月未完成任务；附件过期后续签与大文件预览；卡片资料版本与真实任务版本的对应性。 |
| **R01 研发任务与资料详情**：任务、技术资料和版本历史，采购/样品/生产原问题/适用 ECN 关联 | `/rd-task/:taskId` → `RDTaskDetailPage`，注册于 [App.tsx:545](E:/workCoding/inogi-ai-office/src/app/App.tsx:545)。任务更新、负责人/协作者、技术资料预览与登记、历史版本、转采购、采购与样品 Tab、生成问题、同步生产均已有。技术资料接入 [RDTaskDetailPage.tsx:2383](E:/workCoding/inogi-ai-office/src/app/RDTaskDetailPage.tsx:2383)，采购摘要和 Tab 入口 [L1928](E:/workCoding/inogi-ai-office/src/app/RDTaskDetailPage.tsx:1928)、[L2487](E:/workCoding/inogi-ai-office/src/app/RDTaskDetailPage.tsx:2487)。 | 说明 L183“查看生产转研发问题 P04；查看适用 ECN”：详情未读取或展示原生产质量异常、适用批次 ECN 的关联。生成问题会新建 issue-ai 记录；同步生产是只读任务镜像，均不等于打开原异常/适用变更。见 OR02。资料版本和采购交付快照则已实现，见下节。 | 生产原问题分派给研发后的通知与返回路径；普通研发权限下样品本人结论动作；并发登记版本与历史附件实际存储；生产批次历史依据的完整端到端复验。 |

## 优先处理的偏差

### OR01 · 高：G00 的实际职责与原型不同，缺公司交付风险总入口

需求依据：说明 L151、L153、L155、L157。原型要求部门交付风险、当前经办/期限、原任务跳转；同一异常跨部门只计一次，各指标保留单位和分母。

实际证据：[dashboardApi.ts:10](E:/workCoding/inogi-ai-office/src/app/lib/dashboardApi.ts:10) 限定数据源；[L75](E:/workCoding/inogi-ai-office/src/app/lib/dashboardApi.ts:75) 只按权限加载研发个人工作台、issue-ai、费用、订单，没有月份/产品条件和生产、齐套、质量数据。首页指标为今日待办、已闭环记录、模块加载数 [Dashboard.tsx:526](E:/workCoding/inogi-ai-office/src/app/Dashboard.tsx:526)，业务状态图来自问题或订单 [L368](E:/workCoding/inogi-ai-office/src/app/Dashboard.tsx:368)。这些是有效办公聚合，但不能作为 G00 交付总览已实现的证据。

影响：管理层不能在统一月份/产品范围回答“哪个原问题影响本月交付、现在由谁处理、何时到期”；同号质量异常与跨部门协同的去重汇总也没有在这里实现。不是已确认发生重复计数，而是缺该汇总及其去重链路。

建议验收：保留现有个人聚合的价值，在明确的管理入口按月份/产品汇总正式来源。用一个跨部门原异常和两个不同单位的业务指标验证：异常计一次；每个指标可追到来源和分母；点击进入原记录；切月保留跨月未闭环风险；无权限不泄露，无来源显示待接入/待确认。无需增加多份并行问题记录。

### OR02 · 高：R01 缺“原生产问题 / 适用 ECN”的结构化关联与导航

需求依据：说明 L179“统一…生产协同的关联入口”、L183“查看生产转研发问题 P04；查看适用 ECN”。PNG 也直接展示原生产问题编号及关联操作。

实际证据：R01 操作区提供同步、转采购、生成问题；`handleGenerateIssue` 调用 `issueService.create` 后跳 `/issue-ai?issue=…` [RDTaskDetailPage.tsx:1146](E:/workCoding/inogi-ai-office/src/app/RDTaskDetailPage.tsx:1146)，属于新建记录。同步数据是 `source_task_id/root_source_task_id/read_only: true` 镜像 [production-task-sync.ts:6](E:/workCoding/inogi-ai-office/apps/api/src/modules/research-development/production-task-sync.ts:6)、[L46](E:/workCoding/inogi-ai-office/apps/api/src/modules/research-development/production-task-sync.ts:46)。生产质量协同使用原 `qualityId` 保存经办与回复 [production-execution.service.ts:170](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-execution.service.ts:170)，ECN 使用 `packageId/batchIds/effectiveDate` [production-lifecycle.service.ts:14](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-lifecycle.service.ts:14)、[L109](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-lifecycle.service.ts:109)。以上结构未提供 R01 按研发任务解析原生产异常或适用 ECN 的关联字段/查询，R01 也没有读取它们。

影响：研发人员能接收一般任务与新建问题，但无法从该任务确认自己正在处理哪张生产原异常、哪批适用哪项 ECN；容易依赖手工文字查找，不能闭合原型的跨部门回路。

建议验收：在详情关联区复用原异常/ECN 的真实 ID 与权限范围，显示原编号、经办/截止、关联批次和状态，点击返回原记录。同一异常回复后保持原编号且不新增不良量；无关联是明确空态，不凭物料同名推测。ECN 应按实际关联批次/生效条件筛选，不把最新变更自动套到所有历史任务。对应生产 P04/P07 的缺口见 [production-p00-p10.md](E:/workCoding/inogi-ai-office/docs/ux-audit/2026-09-20-v11-review/production-p00-p10.md)。

### OR03 · 中：R00 缺卡片级确认版本与关联采购/样品记录提示

需求依据：R00 PNG 的当前资料版本、关联业务提示；说明 L167 的资料与进度依据、L169 的采购需求入口。当前卡片的标题/状态、主责/期限、附件/摘要和进度都是真实实现，不能整体判为缺卡片信息。

实际证据：卡片附件来自普通附件预览 [RDTaskManagementPage.tsx:7754](E:/workCoding/inogi-ai-office/src/app/RDTaskManagementPage.tsx:7754)；内容与操作结束于 [L8142](E:/workCoding/inogi-ai-office/src/app/RDTaskManagementPage.tsx:8142)，没有技术资料当前版本标识或已关联采购/样品入口。更多菜单已有查看任务、全部附件、生产镜像同步、转派/删除。采购与样品能力在 R01 已接通，不应再次开发一套流程。

边界：新个人工作台 `/rd-my-workspace` 已有 `RdProcurementProgressEntry` [RDMyWorkspacePage.tsx:4082](E:/workCoding/inogi-ai-office/src/app/RDMyWorkspacePage.tsx:4082) 与原地采购进度弹窗 [L5689](E:/workCoding/inogi-ai-office/src/app/RDMyWorkspacePage.tsx:5689)。这是另一个正式入口，不能据此把 R00 任务驾驶舱的卡片关联缺口划为完成。

建议验收：批量读取卡片所需的确认版本和关联采购摘要，区分“未登记版本”“无关联”“读取失败”；按权限在卡片进入现有详情 Tab/只读进度弹窗。未转采购任务由现有流程显式提交；不拿最新附件名猜版本，不把生产镜像同步误称为生产执行状态。

### OR04 · 中：G00 / R00 没有保留业务范围的“全部关键物件”入口

需求依据：说明 L155、L169 明确从两页进入 S18，并“沿用当前月份、产品与权限范围”。

实际证据：正式 S18 路由已存在，`/proc-key-materials` → `KeyMaterialsPage` [App.tsx:583](E:/workCoding/inogi-ai-office/src/app/App.tsx:583)。但 G00 的快捷入口集合 [Dashboard.tsx:98](E:/workCoding/inogi-ai-office/src/app/Dashboard.tsx:98) 与研发主卡片/工具入口未引用该页面；本次按路径、名称和组件查找未找到两页携带月份/产品上下文进入 S18 的动作。侧栏全局入口不等于上下文衔接。

影响及验收：用户需重新定位产品/月份才能判断关键物件对当前任务的影响。补充一处轻量关联动作即可；有产品/月条件时保留，当前页没有该条件时应明确默认值；沿用权限裁剪，目录中无当前需求的物件仍可通过全量视图查看。S18 自身的数据语义由供应链分报告评价。

## 已实现，不能因样例无数据而判缺

1. **R01 技术资料不是纯附件占位。** 图纸/规格/BOM/验证/其他分类、选中原件预览、版本标识、变更原因、版本历史与历史原文件均已实现 [TechnicalDocumentsPanel.tsx:260](E:/workCoding/inogi-ai-office/src/app/rd/TechnicalDocumentsPanel.tsx:260)、[L280](E:/workCoding/inogi-ai-office/src/app/rd/TechnicalDocumentsPanel.tsx:280)。上传仅新增留痕附件，还要求用户确认类别/版本/说明 [L210](E:/workCoding/inogi-ai-office/src/app/rd/TechnicalDocumentsPanel.tsx:210)、[L300](E:/workCoding/inogi-ai-office/src/app/rd/TechnicalDocumentsPanel.tsx:300)，不会因上传自动完成任务。
2. **后端有真实版本与并发保护。** 读取按任务权限；确认按写权限和附件来源校验；保存新版本、前版本 ID 和变更原因，条件更新当前版本指针并写审计 [rd-technical-documents.service.ts:83](E:/workCoding/inogi-ai-office/apps/api/src/modules/research-development/rd-technical-documents.service.ts:83)、[L145](E:/workCoding/inogi-ai-office/apps/api/src/modules/research-development/rd-technical-documents.service.ts:145)。这不是只在 UI 上展示一个“版本”字段。
3. **采购交付保留明确选择的研发版本。** 后端按任务解析版本 ID [rd-technical-documents.service.ts:178](E:/workCoding/inogi-ai-office/apps/api/src/modules/research-development/rd-technical-documents.service.ts:178)，采购端解析原版本并建立交付快照 [procurement.service.ts:1155](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/procurement.service.ts:1155)。详情说明并展示本次/历史交付文件与版本 [rdInsertion.tsx:184](E:/workCoding/inogi-ai-office/src/app/procurement/components/rdInsertion.tsx:184)，不能把研发后续换版覆盖旧交付的风险当成已确认缺陷。生产批次受控资料的缺口另见生产报告，不能外推为研发资料历史未做。
4. **样品本人确认入口已接入。** 详情采购 Tab 复用 `ProcurementActivitySection`，真实显示样品测试人、状态、备注、本人确认日期；指定测试人和相关权限决定“填写测试结论 / 查看样品记录”入口 [rdInsertion.tsx:149](E:/workCoding/inogi-ai-office/src/app/procurement/components/rdInsertion.tsx:149)、[L177](E:/workCoding/inogi-ai-office/src/app/procurement/components/rdInsertion.tsx:177)。不因用户在某条任务看不到按钮而直接判缺，应先核对样品关联和身份。

## 验证范围与建议浏览器路径

本次是源码/原型复核。已阅读现有技术资料、采购版本交付和转采购弹窗保护测试，覆盖旧版本冻结、明确确认、冲突、读取失败、取消旧响应、本人样品动作等；本次尝试重跑三组测试时 `C:/nvm4w/nodejs/node.exe` 被环境拒绝启动，因此**不记为本轮测试通过**。未运行数据库集成测试。由于未修改产品代码，没有为报告重跑全量构建。

建议主审查按以下顺序只读浏览，不以空资料判缺：

- `/`：核对实际模块来源及是否有公司交付月份/目标/风险原单汇总。
- `/rd-task-management`：有附件任务的卡片、人员范围、“更多”中的生产同步；进入详情后对比卡片缺的版本与采购摘要。
- `/rd-task/{已有任务 ID}`：技术资料各分类、历史版本、采购与样品 Tab、任务操作；禁止为了验收而提交新采购/同步/新问题。
- `/rd-my-workspace`：仅作为“个人工作台已实现采购进度”的对照，不替代 R00 验收。
- 已存在的生产协同异常及 ECN：核对研发收到的真实入口能否回原记录；没有合适已存在记录时记为待验证，不制造数据或推断链路已通。
